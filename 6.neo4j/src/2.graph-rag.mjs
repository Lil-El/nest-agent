import "dotenv/config";

import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, START, END } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";

const graph = new Neo4jGraph({
  url: "bolt://localhost:7687",
  username: "neo4j",
  password: "12345678",
});

const llm = new ChatOpenAI({
  model: process.env.MODEL_NAME,
  temperature: 0,
  configuration: { baseURL: process.env.OPENAI_BASE_URL },
});

const state = {
  messages: {
    value: (left, right) => left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  },
  query: null,
  cypher: null,
  context: null,
  answer: null,
};

async function parseQuestion(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  return { query: lastMessage.content };
}

async function generateCypher(state) {
  const prompt = `
      你是一个专业的 Neo4j Cypher 生成器。
      严格按照下面的结构生成正确语句，只返回纯 Cypher 代码，不要任何解释、不要标点、不要 markdown。

      节点：
      - Product: 奶茶产品
      - Ingredient: 配料
      - Type: 奶茶类型
      - Method: 制作工艺
      - People: 适合人群

      节点属性：
      - *: name

      关系方向（必须严格遵守）：
      - (Product)-[:属于]->(Type)
      - (Product)-[:包含]->(Ingredient)
      - (Product)-[:适合]->(People)
      - (Ingredient)-[:使用]->(Method)

      规则：
      1. 关系方向绝对不能反
      2. 多跳查询请使用多个 MATCH，不要连错路径
      3. 只返回最终可运行的 Cypher 语句

      用户问题：${state.query}
    `;

  const res = await llm.invoke([new HumanMessage(prompt)]);
  return { cypher: res.content };
}

async function executeCypher(state) {
  const res = await graph.query(state.cypher);
  return { context: JSON.stringify(res) };
}

async function generateAnswer(state) {
  const prompt = `
    你是奶茶专家，根据下方「检索结果」回答用户问题；检索结果为空或不足时简要说明无法从图谱得到答案，不要编造。
    回答要求：
    - 直接列出事实，不要推断图谱里未出现的配料（如水、冰、添加剂等）。

    检索结果：${state.context}
    用户问题：${state.query}
  `;

  const res = await llm.invoke([new HumanMessage(prompt)]);
  return { answer: res.content };
}

const workflow = new StateGraph({ channels: state })
  .addNode("parse", parseQuestion)
  .addNode("generateCypher", generateCypher)
  .addNode("executeCypher", executeCypher)
  .addNode("generateAnswer", generateAnswer)
  .addEdge(START, "parse")
  .addEdge("parse", "generateCypher")
  .addEdge("generateCypher", "executeCypher")
  .addEdge("executeCypher", "generateAnswer")
  .addEdge("generateAnswer", END);

const app = workflow.compile();

async function runGraphRAG(q) {
  const res = await app.invoke({ messages: [new HumanMessage(q)] });

  console.log("======================================");
  console.log("用户问题：", q);
  console.log("生成 Cypher：", res.cypher);
  console.log("检索结果：", res.context);
  console.log("最终回答：", res.answer);
  console.log("======================================");
}

await Promise.all([
  runGraphRAG("我们这款珍珠奶茶有哪些配料？"),
  runGraphRAG("台式奶茶的饮品都有哪些配料？"),
  runGraphRAG("珍珠奶茶适合哪些人群饮用？"),
]);

await graph.close();