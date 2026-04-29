/**
 * 基于 2. 升级，让模型可以处理需要多步检索的复杂问题，比如先查 A、再查 B 才能得出结论
 */
import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Milvus } from "@langchain/community/vectorstores/milvus";
import { EPubLoader } from "@langchain/community/document_loaders/fs/epub";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { PromptTemplate } from "@langchain/core/prompts";

import { z } from "zod";

import path, { parse } from "path";

const EPUB_PATH = path.join(process.cwd(), "/epub/第一性原理.epub");
const BOOK_NAME = parse(EPUB_PATH).name;
const COLLECTION_NAME = "book_collection";
const VECTOR_DIMENSION = 1024;

const model = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  temperature: 0,
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
  model: process.env.EMBEDDINGS_MODEL_NAME,
  dimensions: VECTOR_DIMENSION,
});

const vectorStore = new Milvus(embeddings, {
  url: "localhost:19530",
  collectionName: COLLECTION_NAME,
  textFieldMaxLength: 3000,
});

async function splitAndInsertDocuments() {
  const loader = new EPubLoader(EPUB_PATH, {
    splitChapters: true,
  });

  const documents = (await loader.load()).slice(2, 6);

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 50,
  });

  const promiseArr = documents.map((doc, chapterIndex) => {
    return textSplitter.splitText(doc.pageContent).then((chunks) => {
      const docs = chunks.map((chunk, chunkIndex) => {
        return {
          pageContent: chunk,
          metadata: {
            chapterIndex,
            chunkIndex,
            bookName: BOOK_NAME,
          },
        };
      });

      if (docs.length) {
        return vectorStore.addDocuments(docs);
      } else {
        return Promise.resolve();
      }
    });
  });

  return Promise.all(promiseArr);
}

async function ensureCollection() {
  try {
    await vectorStore.client.connectPromise;

    const has = await vectorStore.hasCollection();

    let count = 0;

    if (has) {
      const response = await vectorStore.client.count({ collection_name: COLLECTION_NAME });
      count = response.data;

      // console.log(`Collection exists: ${has}, with ${response.data} vectors.`);
    }

    if (!has || count === 0) {
      console.log("开始插入文档...");
      await splitAndInsertDocuments();
      console.log("插入文档完成");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

async function retrieveContent(query) {
  return await vectorStore.similaritySearchWithScore(query, 3).then((results) => {
    return results.map(([doc, score]) => {
      return doc.pageContent;
    });
  });
}

const RouteSchema = z.object({
  strategy: z.enum(["simple", "complex"]),
  reason: z.string(),
});

const DecomposeSchema = z.object({
  reason: z.string(),
  sub_questions: z.array(z.string()).min(1).max(5),
});

const NextStepSchema = z.object({
  reason: z.string(),
  next_action: z.enum(["retrieve", "generate"]),
});

const GraphState = Annotation.Root({
  question: Annotation,
  documents: Annotation,
  generation: Annotation,
  strategy: Annotation,
  routeReason: Annotation,

  /** 拆解得到的有序子问题，仅用于检索 */
  subQuestions: Annotation,
  /** 下一轮 retrieve 要用的下标（指向 subQuestions 中尚未检索的那一条） */
  nextSubIdx: Annotation,
  currentQuery: Annotation,
  retrievalCount: Annotation,
  maxRetrievals: Annotation,
  plannedNext: Annotation,
});

const graph = new StateGraph(GraphState)
  .addNode("routeQuestion", async (state) => {
    console.log(`---ROUTE QUESTION---`);
    const router = model.withStructuredOutput(RouteSchema);

    const route = await router.invoke(`
      你是问答路由器。请判断用户问题是否需要外部检索，并以 JSON 格式返回结果。

      规则：
      - simple: 常识问答、简单问题即可回答。
      - complex: 关于科学方面的问题需要外部检索。

      用户问题：${state.question}

      请以 JSON 格式返回，包含 strategy 和 reason 两个字段。
    `);
    console.log("路由结果:", route);

    return {
      ...state,
      strategy: route.strategy,
      routeReason: route.reason,
    };
  })
  .addNode("decomposeQuestion", async (state) => {
    const decomposer = model.withStructuredOutput(DecomposeSchema);

    console.log(`---DECOMPOSE QUESTION---`);
    const decomposed = await decomposer.invoke(`
      你是科学问题拆解器。请将问题拆解为有序的子问题，如果问题已经是一个明确、具体的单一问题，不需要进一步拆分了。

      问题：${state.question}

      任务：将问题拆成**有序**子问题列表 sub_questions，用于**依次向量检索**。要求：
      1. 链式推理、多层关系、因果先后的问题，必须拆成多条；单跳即可答的也可只输出 1 条。
      2. 每条子问题必须是**可独立检索**的完整中文问句，**禁止**使用「他/她/此人/上文」等指代；可写全人物名与事件名。
      3. 顺序必须符合推理链：先搞清前置实体/事实，再查后续结论。
      4. **不要**把整句原题原样复制成唯一一条（除非确实无法拆分）；不要拆成过碎的关键词列表。
      5. 输出 1～5 条即可。

      请以 JSON 格式返回，包含 reason 和 sub_questions 两个字段。
    `);
    console.log("拆解结果:", decomposed);

    const subQuestions = decomposed.sub_questions.map((q) => q.trim()).filter(Boolean);

    if (!subQuestions.length) {
      throw new Error("拆解结果为空");
    }

    return {
      subQuestions,
      nextSubIdx: 0,
      currentQuery: subQuestions[0],
    };
  })
  .addNode("retrieve", async (state) => {
    const subs = state.subQuestions ?? [];
    const idx = state.nextSubIdx ?? 0;
    state.nextSubIdx = idx + 1;
    state.currentQuery = subs[idx];
    state.retrievalCount = (state.retrievalCount ?? 0) + 1;

    console.log(`---RETRIEVE (第 ${state.retrievalCount} 轮，子问题 ${idx + 1}/${subs.length})---`);
    console.log(`检索: ${state.currentQuery}`);

    const contents = await retrieveContent(state.currentQuery);
    state.documents = [...new Set([...(state.documents ?? []), ...contents])];

    return state;
  })
  .addNode("decideNextStep", async (state) => {
    const subs = state.subQuestions ?? [];
    const nextIdx = state.nextSubIdx ?? 0;
    const remaining = subs.length - nextIdx;

    const subList = subs.map((s, i) => `${i + 1}. ${s}${i < nextIdx ? " （已检索）" : " （未检索）"}`).join("\n");

    console.log(`---DECIDE NEXT STEP---`);
    console.log("subList:", subList);

    const prompt = `你是多跳 RAG 规划器。

      用户问题：${state.question}

      子问题列表检索情况：
      ${subList}

      最大检索轮数上限：${state.maxRetrievals}

      请判断下一步：
      1) 全部检索完成时 → next_action=generate
      2) 存在未检索的子问题、且未超过轮数上限 → next_action=retrieve
      3) 存在未检索的子问题、且已超过轮数上限 → next_action=generate

      请以 JSON 格式返回, 包含 next_action 和 reason 两个字段， next_action 仅可选 "retrieve" 或 "generate"。
    `;

    const nextStep = model.withStructuredOutput(NextStepSchema);

    const result = await nextStep.invoke(prompt);

    console.log("决策结果:", result);

    const { next_action, reason } = result;

    console.log(`[决策] (模型建议=${next_action}) (${reason})`);

    return {
      plannedNext: next_action,
    };
  })
  .addNode("simpleAnswer", async (state) => {
    const answer = await model.invoke(`你是一个问答助手，请直接简洁回答问题。

      问题：${state.question}
    `);

    return {
      ...state,
      generation: answer.content,
    };
  })
  .addNode("ragAnswer", async (state) => {
    console.log(`---RAG ANSWER---`);

    const { documents, question } = state;

    const prompt = PromptTemplate.fromTemplate(`请根据以下内容回答问题：\n\n{context}\n\n问题：{question}\n\n回答：`);

    const context = documents.map((doc, index) => `[片段${index + 1}内容]：${doc}`).join("\n\n━━━━━\n\n");

    const promptWithValues = await prompt.format({ context, question });

    const generation = await model.invoke(promptWithValues);

    state.generation = generation.content;

    return state;
  })
  .addEdge(START, "routeQuestion")
  .addConditionalEdges("routeQuestion", (state) => (state.strategy === "simple" ? "a" : "b"), {
    a: "simpleAnswer",
    b: "decomposeQuestion",
  })
  .addEdge("decomposeQuestion", "retrieve")
  .addEdge("retrieve", "decideNextStep")
  .addConditionalEdges("decideNextStep", (state) => state.plannedNext, {
    retrieve: "retrieve",
    generate: "ragAnswer",
  })
  .addEdge("simpleAnswer", END)
  .addEdge("ragAnswer", END)
  .compile();

async function main() {
  await ensureCollection();

  const drawable = await graph.getGraphAsync();
  const mermaid = drawable.drawMermaid({ withStyles: true });
  // console.log(mermaid);

  const questions = {
    Q1: "1 + 1",
    Q2: "人们最早认为的引力是什么？",
    Q3: "潮汐现象是如何产生的，被谁发现的？",
  };

  const result = await graph.invoke({
    question: questions.Q3,
    documents: [],
    generation: "",
    strategy: "",
    routeReason: "",

    subQuestions: [],
    nextSubIdx: 0,
    currentQuery: "",
    retrievalCount: 0,
    maxRetrievals: 5,
    plannedNext: "",
  });

  console.log("结果:", result);
}

main();
