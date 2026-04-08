import { Module } from "@nestjs/common";
import { Ai2Service } from "./ai2.service";
import { Ai2Controller } from "./ai2.controller";
import { MockUserService } from "./mock-user.service";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { MailerModule, MailerService } from "@nestjs-modules/mailer";
import { ConfigService } from "@nestjs/config";
import { AiService } from "src/ai/ai.service";
import { BookService } from "src/book/book.service";
import { BookModule } from "src/book/book.module";
import { UsersModule } from "src/users/users.module";
import { UsersService } from "src/users/users.service";
import { JobService } from "src/job/job.service";
import { JobModule } from "src/job/job.module";
import { ToolModule } from "src/tools/tool.module";

const queryUserToolProvider = {
  provide: "QUERY_USER_TOOL",
  inject: [MockUserService],
  useFactory: (userService: MockUserService) => {
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

        return `邮件已发送到 ${to}，主题为「${subject}」`;
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
  },
};

const dbUsersCrudToolProvider = {
  provide: "DB_USERS_CRUD_TOOL",
  inject: [UsersService],
  useFactory: (usersService: UsersService) => {
    const dbUsersCrudArgsSchema = z.object({
      action: z
        .enum(["create", "list", "get", "update", "delete"])
        .describe(
          "要执行的操作：create 创建用户，list 列出所有用户，get 获取用户信息，update 更新用户信息，delete 删除用户",
        ),
      id: z.number().int().positive().optional().describe("用户 ID（get / update / delete 时需要）"),
      name: z.string().min(1).max(50).optional().describe("用户名（create / update 时需要）"),
      email: z.email().max(50).optional().describe("邮箱（create / update 时需要）"),
    });

    return tool(
      async ({ action, id, name, email }) => {
        switch (action) {
          case "create": {
            if (!name || !email) return "请提供用户名、邮箱";
            const created = await usersService.create({ name, email });
            return `用户 ${created.name} 创建成功`;
          }
          case "list": {
            const users = await usersService.findAll();
            if (!users.length) {
              return "数据库中还没有任何用户记录。";
            }
            const lines = users
              .map(
                (u: any) =>
                  `ID=${u.id}，姓名=${u.name}，邮箱=${u.email}，创建时间=${u.createdAt?.toISOString?.() ?? ""}`,
              )
              .join("\n");
            return `当前数据库 users 表中的用户列表：\n${lines}`;
          }
          case "get": {
            if (!id) {
              return "查询单个用户需要提供 id。";
            }
            const user = await usersService.findOne(id);
            if (!user) {
              return `ID 为 ${id} 的用户在数据库中不存在。`;
            }
            const u: any = user;
            return `用户信息：ID=${u.id}，姓名=${u.name}，邮箱=${u.email}，创建时间=${u.createdAt?.toISOString?.() ?? ""}`;
          }
          case "update": {
            if (!id) {
              return "更新用户需要提供 id。";
            }
            const payload: any = {};
            if (name !== undefined) payload.name = name;
            if (email !== undefined) payload.email = email;
            if (!Object.keys(payload).length) {
              return "未提供需要更新的字段（name 或 email），本次不执行更新。";
            }
            const existing = await usersService.findOne(id);
            if (!existing) {
              return `ID 为 ${id} 的用户在数据库中不存在。`;
            }
            await usersService.update(id, payload);
            const updated: any = await usersService.findOne(id);
            return `已更新用户：ID=${id}，姓名=${updated?.name}，邮箱=${updated?.email}`;
          }
          case "delete": {
            if (!id) {
              return "删除用户需要提供 id。";
            }
            const existing: any = await usersService.findOne(id);
            if (!existing) {
              return `ID 为 ${id} 的用户在数据库中不存在，无需删除。`;
            }
            await usersService.remove(id);
            return `已删除用户：ID=${id}，姓名=${existing.name}，邮箱=${existing.email}`;
          }
          default:
            return `不支持的操作: ${action}`;
        }
      },
      {
        name: "db_users_crud",
        description:
          "对数据库 users 表执行增删改查操作。通过 action 字段选择 create/list/get/update/delete，并按需提供 id、name、email 等参数。",
        schema: dbUsersCrudArgsSchema,
      },
    );
  },
};

const cronJobToolProvider = {
  provide: "CRON_JOB_TOOL",
  inject: [JobService],
  useFactory: (jobService: JobService) => {
    const cronJobArgsSchema = z.object({
      action: z
        .enum(["add", "list", "toggle"])
        .describe("要执行的操作：add 添加任务，list 列出所有任务，toggle 启用/禁用任务"),
      id: z.string().optional().describe("任务 ID（toggle 时需要）"),
      enabled: z.boolean().optional().describe("任务是否启用（toggle 可选；不传则自动取反）"),
      type: z.enum(["cron", "every", "at"]).optional().describe("任务类型：cron 定时执行，every 定时执行，at 定时执行"),
      instruction: z.string().optional().describe("任务执行说明"),
      cron: z.string().optional().describe("cron 表达式"),
      everyMs: z.number().int().positive().optional().describe("定时执行间隔（毫秒）"),
      at: z.string().optional().describe("定时执行时间"),
    });

    return tool(
      async ({ action, id, enabled, type, instruction, cron, everyMs, at }) => {
        switch (action) {
          case "list": {
            const jobs = await jobService.listJobs();
            if (jobs.length === 0) return "当前没有任务";

            const lines = jobs
              .map(
                (j) =>
                  `id=${j.id} type=${j.type} enabled=${j.isEnabled} running=${j.running} cron=${j.cron ?? ""} everyMs=${j.everyMs ?? ""} at=${j.at instanceof Date ? j.at.toISOString() : (j.at ?? "")} instruction=${j.instruction ?? ""}`,
              )
              .join("\n");

            return `当前定时任务列表\n ${lines}`;
          }
          case "add": {
            if (!type) return "新增任务需要指定任务类型 type 为 cron/every/at";
            if (!instruction) return "新增任务需要指定任务指令 instruction";

            if (type === "cron") {
              if (!cron) return "cron 任务需要指定 cron 指令 cron";
              const created = await jobService.addJob({
                type,
                instruction,
                cron,
                isEnabled: true,
              });
              return `任务 ${created.id} 已创建`;
            }

            if (type === "every") {
              if (typeof everyMs !== "number" || everyMs <= 0) {
                return "type=every 时需要提供 everyMs（正整数，单位毫秒）。";
              }
              const created = await jobService.addJob({
                type,
                instruction,
                everyMs,
                isEnabled: true,
              });
              return `已新增定时任务：id=${(created as any).id} type=every everyMs=${(created as any).everyMs} enabled=${(created as any).isEnabled}`;
            }

            if (type === "at") {
              if (!at) return "type=at 时需要提供 at（ISO 时间字符串）。";
              const date = new Date(at);
              if (Number.isNaN(date.getTime())) {
                return "type=at 的 at 不是合法的 ISO 时间字符串。";
              }
              const created = await jobService.addJob({
                type,
                instruction,
                at: date,
                isEnabled: true,
              });
              return `已新增定时任务：id=${(created as any).id} type=at at=${(created as any).at?.toISOString?.() ?? ""} enabled=${(created as any).isEnabled}`;
            }

            return `不支持的任务类型: ${type}`;
          }
          case "toggle": {
            if (!id) return "请指定任务id";
            const updated = await jobService.toggleJob(id, enabled);
            return updated ? `已${updated.isEnabled ? "启用" : "禁用"}任务：id=${id}` : `未找到任务：id=${id}`;
          }
          default:
            return "不支持的任务类型";
        }
      },
      {
        name: "cron_job",
        description: "定时任务管理",
        schema: cronJobArgsSchema,
      },
    );
  },
};

const getTimeToolProvider = {
  provide: "TIME_NOW_TOOL",
  useFactory: () => {
    return tool(() => `当前时间是${new Date().toLocaleString()}`, {
      name: "time_now",
      description: "获取当前时间",
      schema: z.object({}),
    });
  },
};

/**
 * queryUserToolProvider 中使用了 MockUserService；
 * MockUserService 是自定义 Service，NestJS 不知道它的存在，必须显式注册。所以 providers 中需要提供 MockUserService
 *
 * ConfigService 是 NestJS 提供的，NestJS 会自动注册它。
 *
 * sendEmailToolProvider 中使用了 MailerService 和 ConfigService；
 * MailerService 在 AppModule 中注册，所以不需要提供 MailerService；
 * 当然也可以在这里 import MailerModule 的配置；MailerModule.forRootAsync({...}),
 */

/**
 * @example
 * 访问 /ai-see-test.html 测试：`查询用户001的信息，并发送到邮箱 yxd99324@qq.com`
 * 测试 mockUser数据查询、email 发送
 *
 * @example
 * 访问 /ai-see-test.html 测试：`查询未来一周西安的天气，并整理为精美html发送到邮箱 yxd99324@qq.com`
 * 测试 网络搜索、email 发送
 *
 * @example
 * 访问 /ai-see-test.html 测试：`新增一个用户，用户名：张三，邮箱：zhangsan@qq.com`
 * 测试 数据库操作
 *
 * @example
 * 访问 /ai-see-test.html 测试：`修改李四的邮箱为lisi@360.com，再删除王五，把最终的用户列表用表格发给我`
 * 测试 数据库操作
 *
 * @example
 * 访问 /ai-see-test.html 测试：`查询西安所有985高校的信息，作为用户保存，名字是学校名，邮箱是学校邮箱。并生成精美的html发送至邮箱yxd99324@qq.com`
 * 测试 网络搜索、数据库操作、email 发送
 *
 * @example
 * 访问 /ai-see-test.html 测试：`提醒我10分钟后喝水`
 * 测试 定时任务
 *
 * @example
 * 访问 /ai-see-test.html 测试：`1分钟后发送邮件到yxd99324@qq.com提醒我喝水`
 * 测试 定时任务、job 执行（JobAgentService）
 *
 * @note
 * 博查 需要购买资源包才可以使用；
 */

@Module({
  imports: [ToolModule, UsersModule, JobModule], // 导入模块
  controllers: [Ai2Controller],
  providers: [
    Ai2Service,
    MockUserService,
    queryUserToolProvider,
    /* sendEmailToolProvider,
    webSearchToolProvider,
    dbUsersCrudToolProvider,
    cronJobToolProvider,
    getTimeToolProvider, */
  ],
})
export class Ai2Module {}
