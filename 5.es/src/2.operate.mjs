import { Client } from "@elastic/elasticsearch";

const client = new Client({
  node: "http://localhost:9200",
});

const INDEX_NAME = "travel_journal";

async function createDocument() {
  const now = new Date();

  const res = await client.index({
    index: INDEX_NAME,
    document: {
      note_title: "夜跑复盘",
      note_body: "今天夜跑 5 公里，配速稳定，结束后做了拉伸。",
      tags: ["运动", "夜跑"],
      mood: "focused",
      priority: 2,
      created_at: now,
      updated_at: now,
    },
    refresh: true,
  });

  return res._id;
}

async function getDocument(docId) {
  const res = await client.get({
    index: INDEX_NAME,
    id: docId,
  });
  console.log("Retrieved Document:", res._source);
}

async function updateDocument(docId) {
  const res = await client.update({
    index: INDEX_NAME,
    id: docId,
    doc: {
      note_body: "今天夜跑 6 公里，状态不错，拉伸后恢复很快。",
      tags: ["运动", "夜跑", "训练"],
      updated_at: new Date(),
    },
    refresh: true,
  });
  console.log("Update Result:", res);
}

async function searchDocuments() {
  const res = await client.search({
    index: INDEX_NAME,
    query: {
      match: {
        note_body: {
          query: "夜跑",
          analyzer: "ik_smart",
        },
      },
    },
  });

  const rows = res.hits.hits.map((hit) => hit._source);
  console.log("Search Results:", rows);
}

async function deleteDocument(docId) {
  await client.delete({
    index: INDEX_NAME,
    id: docId,
    refresh: true,
  });
}

async function run() {
  const docId = await createDocument();
  await getDocument(docId);
  await updateDocument(docId);
  await searchDocuments();
  await deleteDocument(docId);
}

run().catch((err) => {
  console.error("❌ 操作阶段失败:", err);
  process.exit(1);
});
