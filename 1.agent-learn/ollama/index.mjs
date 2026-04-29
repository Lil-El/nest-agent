import { ChatOllama, OllamaEmbeddings } from "@langchain/ollama";
import chalk from "chalk";

const model = new ChatOllama({
  model: "qwen3",
  baseUrl: "http://127.0.0.1:11434",
  think: true,
});

const embeddings = new OllamaEmbeddings({
  model: "qwen3-embedding",
  baseUrl: "http://127.0.0.1:11434",
  dimensions: 1024
});

const response = await model.invoke("你好，你是谁？");

console.log(chalk.yellow("🤖️ 模型推理:\n"));

console.log(chalk.yellow(response.additional_kwargs.reasoning_content));

console.log(chalk.blue("🤖️ 模型输出:"));

console.log(chalk.blue(response.content));

const embeddingsResult = await embeddings.embedQuery("你好，你是谁？");

console.log(chalk.green("LLM embeddings:"));

console.log(chalk.green(embeddingsResult));