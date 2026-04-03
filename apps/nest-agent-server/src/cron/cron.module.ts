import { Module } from "@nestjs/common";
import { CronService } from "./cron.service";
import { CronController } from "./cron.controller";
import { AiModule } from "src/ai/ai.module";
import { UserService } from "./user.service";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { MailerModule, MailerService } from "@nestjs-modules/mailer";
import { ConfigService } from "@nestjs/config";
import { AiService } from "src/ai/ai.service";
import { BookService } from "src/book/book.service";
import { BookModule } from "src/book/book.module";

const queryUserToolProvider = {
  provide: "QUERY_USER_TOOL",
  inject: [UserService],
  useFactory: (userService: UserService) => {
    const schema = z.object({
      userId: z.string().describe("用户ID，例如：001"),
    });

    return tool(
      async ({ userId }: { userId: string }) => {
        const user = userService.findOne(userId);
        if (!user) {
          return "用户不存在";
        }
        return `用户ID：${user.id}\n-- 用户名：${user.name}\n-- 邮箱：${user.email}\n-- 角色：${user.role}`;
      },
      {
        name: "query_user",
        description: "'查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。",
        schema,
      },
    );
  },
};

const sendEmailToolProvider = {
  provide: "SEND_EMAIL_TOOL",
  inject: [MailerService, ConfigService],
  useFactory: (mailerService: MailerService, configService: ConfigService) => {
    const schema = z.object({
      to: z.email().describe("收件人邮箱"),
      subject: z.string().describe("邮件主题"),
      text: z.string().optional().describe("邮件内容"),
      html: z.string().optional().optional().describe("邮件内容（HTML 格式）"),
    });

    return tool(
      async ({ to, subject, text, html }: { to: string; subject: string; text?: string; html?: string }) => {
        const fallbackFrom = configService.get("MAIL_FROM");

        await mailerService.sendMail({
          to,
          subject,
          text: text ?? "（无内容）",
          html: html ?? "（无内容）",
          from: fallbackFrom,
        });

        return `邮件已发送到 ${to}，主题为「${subject}」`;
      },
      {
        name: "send_email",
        description: "发送邮件。输入收件人邮箱、邮件主题、邮件内容（可选）和邮件内容（HTML 格式）",
        schema,
      },
    );
  },
};

const webSearchToolProvider = {
  provide: "WEB_SEARCH_TOOL",
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const schema = z.object({
      query: z.string().describe("搜索内容"),
      count: z.int().min(1).max(10).optional().describe("搜索数量"),
    });

    return tool(
      async ({ query, count }: { query: string; count: number }) => {
        const apiKey = configService.get("BOCHA_API_KEY");
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
          return `搜索 API 请求失败，状态码: ${response.status}, 错误信息: ${errorText}`;
        }

        let json: any;
        try {
          json = await response.json();
        } catch (e) {
          return `搜索 API 请求失败，原因是：搜索结果解析失败 ${(e as Error).message}`;
        }

        try {
          if (json.code !== 200 || !json.data) {
            return `搜索 API 请求失败，原因是: ${json.msg ?? "未知错误"}`;
          }

          const webpages = json.data.webPages?.value ?? [];
          if (!webpages.length) {
            return "未找到相关结果。";
          }

          const formatted = webpages
            .map(
              (page: any, idx: number) => `引用: ${idx + 1}
                标题: ${page.name}
                URL: ${page.url}
                摘要: ${page.summary}
                网站名称: ${page.siteName}
                网站图标: ${page.siteIcon}
                发布时间: ${page.dateLastCrawled}
              `,
            )
            .join("\n\n");

          return formatted;
        } catch (e) {
          return `搜索 API 请求失败，原因是：搜索结果解析失败 ${(e as Error).message}`;
        }
      },
      {
        name: "web_search",
        description: "使用 Web 搜索引擎进行搜索。输入搜索内容",
        schema,
      },
    );
  },
};

/**
 * queryUserToolProvider 中使用了 UserService；
 * UserService 是自定义 Service，NestJS 不知道它的存在，必须显式注册。所以 providers 中需要提供 UserService
 *
 * ConfigService 是 NestJS 提供的，NestJS 会自动注册它。
 *
 * sendEmailToolProvider 中使用了 MailerService 和 ConfigService；
 * MailerService 在 AppModule 中注册，所以不需要提供 MailerService；
 * 当然也可以在这里 import MailerModule 的配置；MailerModule.forRootAsync({...}),
 */

/**
 * 访问 /ai-see-test.html 测试：`查询未来一周西安的天气，并整理为精美html发送到邮箱 yxd99324@qq.com`
 * 博查 需要购买资源包才可以使用；
 */

@Module({
  imports: [AiModule], // 导入模块
  controllers: [CronController],
  providers: [CronService, UserService, queryUserToolProvider, sendEmailToolProvider, webSearchToolProvider],
})
export class CronModule {}
