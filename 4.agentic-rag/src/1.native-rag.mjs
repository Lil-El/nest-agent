import "dotenv/config";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { Milvus } from "@langchain/community/vectorstores/milvus";
import { EPubLoader } from "@langchain/community/document_loaders/fs/epub";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
// import { MilvusClient, MetricType } from "@zilliz/milvus2-sdk-node";

import path, { parse } from "path";

const EPUB_PATH = path.join(process.cwd(), "/epub/倾诉.epub");
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
});

async function splitDocuments(documents) {
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 50,
  });

  const t = await textSplitter.splitDocuments(documents)
  console.log(t)
}

async function ensureCollection() {
  const loader = new EPubLoader(EPUB_PATH, {
    splitChapters: true,
  });

  const documents = await loader.load();

  await splitDocuments(documents);

  // vectorStore.createCollection
  // vectorStore.addDocuments
  // vectorStore.addVectors
  // await vectorStore.ensureCollection();
  // console.log("Collection not found. Creating...");
}

async function main() {
  await ensureCollection();

  // await vectorStore.client.connectPromise;
}

main();
