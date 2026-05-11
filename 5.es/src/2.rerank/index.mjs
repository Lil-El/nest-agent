import "dotenv/config";
import { DashScopeRerank } from "./1.dashscope-rerank.mjs";
import { Document } from "@langchain/core/documents";

async function main() {
  const compressor = new DashScopeRerank({
    model: process.env.RERANK_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.RERANK_URL,
  });

  const query = "什么是文本排序模型？";

  const docs = [
    new Document({
      pageContent: "预训练语言模型的发展给文本排序模型带来了新的进展",
    }),
    new Document({
      pageContent: "量子计算是计算科学的一个前沿领域",
    }),
    new Document({
      pageContent: "文本排序模型广泛用于搜索引擎和推荐系统中…",
    }),
  ];

  const ranked = await compressor.compressDocuments(docs, query);
  console.log("Ranked Documents:");

  for (const doc of ranked) {
    console.log(`- ${doc.pageContent}`);
  }
}

main().catch(console.error);
