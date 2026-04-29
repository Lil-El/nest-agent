/**
 * 基于 3. 升级，对于知识库没有的内容，调用网络搜索进行兜底
 */
import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Milvus } from "@langchain/community/vectorstores/milvus";
import { EPubLoader } from "@langchain/community/document_loaders/fs/epub";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Annotation, START, END, StateGraph } from "@langchain/langgraph";

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

async function webSearch(query, count) {
  const apiKey = process.env.BOCHA_API_KEY;
  if (!apiKey) {
    throw new Error("Bocha Web Search 的 API Key 未配置（环境变量 BOCHA_API_KEY）。");
  }
  const url = "https://api.bochaai.com/v1/web-search";
  const body = {
    query,
    freshness: "noLimit",
    summary: true,
    count: count ?? 5,
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`搜索 API 请求失败（网络错误）：${error.message}`);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`搜索 API 请求失败，状态码: ${response.status}, 错误信息: ${errorText}`);
  }

  let json;
  try {
    json = await response.json();
  } catch (error) {
    throw new Error(`搜索结果解析失败：${error.message}`);
  }

  if (json?.code !== 200 || !json?.data) {
    throw new Error(`搜索 API 返回失败：${json?.msg ?? "未知错误"}`);
  }

  const webpages = json.data.webPages?.value ?? [];
  if (!webpages.length) {
    return "未找到相关结果。";
  }

  return webpages
    .map(
      (page, idx) => `引用: ${idx + 1}
标题: ${page.name}
URL: ${page.url}
摘要: ${page.summary}
网站名称: ${page.siteName}
网站图标: ${page.siteIcon}
发布时间: ${page.dateLastCrawled}`,
    )
    .join("\n\n");
}

const RouteSchema = z.object({
  strategy: z.enum(["simple", "complex"]),
  reason: z.string(),
});

const EvaluateSchema = z.object({
  enough: z.boolean(),
  missing: z.array(z.string()).max(6),
  reason: z.string(),
  web_query: z.string().optional(),
});

const GraphState = Annotation.Root({
  question: Annotation,
  generation: Annotation,
  strategy: Annotation,
  routeReason: Annotation,

  localContext: Annotation,
  webContext: Annotation,
  evaluation: Annotation,
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
  .addNode("retrieve", async (state) => {
    console.log(`---RETRIEVE---`);
    const contents = await retrieveContent(state.question);

    return {
      localContext: contents.join("\n\n"),
    };
  })
  .addNode("evaluateContext", async (state) => {
    const hasWeb = Boolean(state.webContext && String(state.webContext).trim());
    console.log(hasWeb ? "---EVALUATE_CONTEXT_WITH_WEB---" : "---EVALUATE_LOCAL_CONTEXT---");

    const evaluator = model.withStructuredOutput(EvaluateSchema);

    const evaluation = await evaluator.invoke(`
      你是上下文评估器。请评估以下提供的上下文信息是否足够回答问题，并说明缺失的关键信息是什么。

      问题：${state.question}

      已检索的本地上下文：${state.localContext}

      ${state.webContext ? `已检索的网络上下文：${state.webContext}` : ""}

      请以 JSON 格式返回：
        - enough: 是否足够回答（true/false）
        - missing: 若不够，列出缺失信息点（最多 5 条）
        - reason: 简短原因
        ${state.webContext ? "" : "- web_query: 如果需要网络检索，请给出具体的搜索查询语句（可选）"}
    `);

    console.log("评估结果:", evaluation);

    return {
      evaluation,
    };
  })
  .addNode("webRetrieve", async (state) => {
    console.log("---WEB_RETRIEVE---");
    const query = state.evaluation.web_query || state.question;
    const webContext = await webSearch(query, 3);
    return {
      webContext,
    };
  })
  .addNode("generate", async (state) => {
    console.log("---GENERATE---");
    const context = [state.localContext, state.webContext].filter(Boolean).join("\n\n===== 联网补充 =====\n\n");

    const answer = await model.invoke(`你是一个严谨的中文问答助手。优先依据上下文作答，不要编造。

      问题：${state.question}

      上下文（本地知识库 + 可选联网补充）：
      ${context || "（空）"}

      回答要求：
      1. 如果上下文足够，给出清晰、可核对的回答；需要时引用“引用: n / URL”或小说片段来支撑。
      2. 如果上下文仍不足以确定关键事实，明确说明“不确定/无法从上下文确认”，并说明缺失点。
      3. 不要输出表情符号。

      回答：
    `);

    return {
      ...state,
      generation: answer.content,
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
  .addEdge(START, "routeQuestion")
  .addConditionalEdges("routeQuestion", (state) => (state.strategy === "simple" ? "a" : "b"), {
    a: "simpleAnswer",
    b: "retrieve",
  })
  .addEdge("retrieve", "evaluateContext")
  .addConditionalEdges(
    "evaluateContext",
    (state) => {
      if (state.webContext && String(state.webContext).trim()) {
        return "generate";
      }

      return state.evaluation.enough === true ? "generate" : "web_search";
    },
    {
      web_search: "webRetrieve",
      generate: "generate",
    },
  )
  .addEdge("webRetrieve", "evaluateContext")
  .addEdge("simpleAnswer", END)
  .addEdge("generate", END)
  .compile();

async function main() {
  await ensureCollection();

  const drawable = await graph.getGraphAsync();
  const mermaid = drawable.drawMermaid({ withStyles: true });
  // console.log(mermaid);

  const questions = {
    Q: "潮汐现象的成因，被谁发现的？",
  };

  const result = await graph.invoke({
    question: questions.Q,
    generation: "",
    strategy: "",
    routeReason: "",

    localContext: "",
    webContext: "",
    evaluation: {
      enough: false,
      missing: [],
      reason: "",
      web_query: "",
    },
  });

  console.log("结果:", result);
}

main();
