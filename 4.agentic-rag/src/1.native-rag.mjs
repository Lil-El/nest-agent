import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Milvus } from "@langchain/community/vectorstores/milvus";
import { EPubLoader } from "@langchain/community/document_loaders/fs/epub";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { PromptTemplate } from "@langchain/core/prompts";

// import { VectorStore } from "@langchain/core/vectorstores";
// import { MilvusClient, MetricType } from "@zilliz/milvus2-sdk-node";

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

  // 因为文本进行了一次手动切割，第一次调用addDocuments时，最大长度时100+
  // // 后续addDocuments时是1000左右，所以还是手动设置一下最大长度吧
  textFieldMaxLength: 3000, // UTF-8编码是字节为单位的，1个中文通常占3个字节

  // vectorField: "vector", // 自定义向量字段名称，默认为 "langchain_vector"
  // textField: "content", // 自定义文本字段名称，默认为 "langchain_text"
  // indexCreateOptions: {
  //   index_type: "IVF_FLAT",
  //   metric_type: "COSINE",
  //   params: { nlist: 1024 },
  // }
});

async function splitAndInsertDocuments() {
  const loader = new EPubLoader(EPUB_PATH, {
    splitChapters: true,
  });

  const documents = (await loader.load()).slice(2, 6);

  // 重要：textFieldMaxLength 限制的是 UTF-8 字节数，不是字符数
  // 中文字符在 UTF-8 中通常占 3 个字节
  // 如果 textFieldMaxLength=1200 字节，那么安全的字符数应该是 1200/3 = 400 字符左右
  // 为了更安全，我们设置 chunkSize=350，留出余量
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 350, // 按字符数计算，考虑 UTF-8 编码后不超过 1200 字节
    chunkOverlap: 50,
  });

  const promiseArr = documents.map((doc, chapterIndex) => {
    return textSplitter.splitText(doc.pageContent).then((chunks) => {
      const docs = chunks.map((chunk, chunkIndex) => {
        // 检查 UTF-8 编码后的字节长度
        const byteLength = Buffer.from(chunk, "utf-8").length;
        if (byteLength > 1100) {
          console.warn(
            `警告: chunk UTF-8 字节长度 ${byteLength} 接近限制 (字符数: ${chunk.length}), 章节 ${chapterIndex}, 块 ${chunkIndex}`,
          );
        }

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
        // addDocuments 内部会调用 embedDocuments 来获取向量，然后调用内部的 addVectors 方法将向量和文档一起插入 Milvus
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

const GraphState = Annotation.Root({
  question: Annotation,
  documents: Annotation,
  generation: Annotation,
});

const graph = new StateGraph(GraphState)
  .addNode("retrieve", async (state) => {
    const { question } = state;
    state.documents = await retrieveContent(question);
    return state;
  })
  .addNode("generate", async (state) => {
    const { documents, question } = state;

    const prompt = PromptTemplate.fromTemplate(`请根据以下内容回答问题：\n\n{context}\n\n问题：{question}\n\n回答：`);

    const context = documents.map((doc, index) => `[片段${index + 1}内容]：${doc}`).join("\n\n━━━━━\n\n");

    // LCEL: const chain = prompt.pipe(model);  chain.invoke({ context, question })

    const promptWithValues = await prompt.format({ context, question });

    const generation = await model.invoke(promptWithValues);

    state.generation = generation;

    return state;
  })
  .addEdge(START, "retrieve")
  .addEdge("retrieve", "generate")
  .addEdge("generate", END)
  .compile();

async function main() {
  await ensureCollection();

  const result = await graph.invoke({
    question: "谁发现了磁力？",
    documents: [],
    generation: "",
  });

  console.log("结果:", result);
}

main();
