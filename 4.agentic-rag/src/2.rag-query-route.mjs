/**
 * 基于 1. 升级，让模型根据问题类型选择检索策略，简单问题直接回答，复杂问题才走检索
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

      console.log(`Collection exists: ${has}, with ${response.data} vectors.`);
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

const GraphState = Annotation.Root({
  question: Annotation,
  documents: Annotation,
  generation: Annotation,
  strategy: Annotation,
  routeReason: Annotation,
});

const graph = new StateGraph(GraphState)
  .addNode("routeQuestion", async (state) => {
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
  .addNode("retrieve", async (state) => {
    const { question } = state;
    state.documents = await retrieveContent(question);
    return state;
  })
  .addNode("simpleAnswer", async (state) => {
    const answer = await model.invoke(`你是一个中文问答助手，请直接简洁回答问题。

      问题：${state.question}
    `);

    return {
      ...state,
      generation: answer,
    };
  })
  .addNode("ragAnswer", async (state) => {
    const { documents, question } = state;

    const prompt = PromptTemplate.fromTemplate(`请根据以下内容回答问题：\n\n{context}\n\n问题：{question}\n\n回答：`);

    const context = documents.map((doc, index) => `[片段${index + 1}内容]：${doc}`).join("\n\n━━━━━\n\n");

    const promptWithValues = await prompt.format({ context, question });

    const generation = await model.invoke(promptWithValues);

    state.generation = generation;

    return state;
  })
  .addEdge(START, "routeQuestion")
  .addConditionalEdges("routeQuestion", (state) => (state.strategy === "simple" ? "a" : "b"), {
    a: "simpleAnswer",
    b: "retrieve",
  })
  .addEdge("retrieve", "ragAnswer")
  .addEdge("simpleAnswer", END)
  .addEdge("ragAnswer", END)
  .compile();

async function main() {
  await ensureCollection();

  const drawable = await graph.getGraphAsync();
  const mermaid = drawable.drawMermaid({ withStyles: true });
  // console.log(mermaid);

  const result = await graph.invoke({
    question: "人们最早认为的引力是什么？", // 1+1
    documents: [],
    generation: "",
    strategy: "",
    routeReason: "",
  });

  console.log("结果:", result);
}

main();
