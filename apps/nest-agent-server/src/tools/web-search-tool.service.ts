import { StructuredTool } from "@langchain/core/tools";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

@Injectable()
export class WebSearchToolService {
  @Inject(ConfigService)
  private readonly configService: ConfigService;

  readonly tool: StructuredTool;

  constructor() {
    const schema = z.object({
      query: z.string().describe("搜索内容"),
      count: z.int().min(1).max(10).optional().describe("搜索数量"),
    });

    //【TIP】：qwen 模型内置了web search tool，可以查看模型API启用 web 搜索功能；
    this.tool = tool(
      async ({ query, count }: { query: string; count: number }) => {
        const apiKey = this.configService.get("BOCHA_API_KEY");
        if (!apiKey) {
          return "请先配置 BOCHA_API_KEY";
        }

        const url = "https://api.bochaai.com/v1/web-search";
        const body = {
          query,
          freshness: "noLimit",
          summary: true,
          count: count ?? 10,
        };

        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          return `搜索 API 请求失败，状态码: ${response.status}, 错误信息: ${errorText}`;
        }

        let json: any;
        try {
          json = await response.json();
        } catch (e) {
          return `搜索 API 请求失败，原因是：搜索结果解析失败 ${(e as Error).message}`;
        }

        try {
          if (json.code !== 200 || !json.data) {
            return `搜索 API 请求失败，原因是: ${json.msg ?? "未知错误"}`;
          }

          const webpages = json.data.webPages?.value ?? [];
          if (!webpages.length) {
            return "未找到相关结果。";
          }

          const formatted = webpages
            .map(
              (page: any, idx: number) => `引用: ${idx + 1}
                标题: ${page.name}
                URL: ${page.url}
                摘要: ${page.summary}
                网站名称: ${page.siteName}
                网站图标: ${page.siteIcon}
                发布时间: ${page.dateLastCrawled}
              `,
            )
            .join("\n\n");

          return formatted;
        } catch (e) {
          return `搜索 API 请求失败，原因是：搜索结果解析失败 ${(e as Error).message}`;
        }
      },
      {
        name: "web_search",
        description: "使用 Web 搜索引擎进行搜索。输入搜索内容",
        schema,
      },
    );
  }
}
