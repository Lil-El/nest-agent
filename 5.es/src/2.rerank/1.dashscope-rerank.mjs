import "dotenv/config";
import { BaseDocumentCompressor } from "@langchain/core/retrievers/document_compressors";


/**
 * langchain 提供了 rerank 模型的基类 BaseDocumentCompressor，但是没有 qwen 重排模型对应的封装，我们自己封装下
 */
export class DashScopeRerank extends BaseDocumentCompressor {
  constructor({ apiKey, model, topN = 3, baseUrl }) {
    super();
    this.apiKey = apiKey;
    this.model = model;
    this.topN = topN;
    this.baseUrl = baseUrl;
  }

  async compressDocuments(documents, query) {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: {
          query,
          documents: documents.map((doc) => doc.pageContent),
        },
        parameters: {
          return_documents: false,
          top_n: this.topN,
        },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(`Error: ${data.message}`);
    }

    const result = data?.output?.results;
    console.log("Rerank Result:", result);

    if (!result || !Array.isArray(result)) {
      throw new Error("Invalid response format");
    }

    return result.map((i) => documents[i.index]);
  }
}
