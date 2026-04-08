import { Inject, Injectable } from "@nestjs/common";
import { tool, StructuredTool } from "@langchain/core/tools";
import { MailerService } from "@nestjs-modules/mailer";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";

@Injectable()
export class SendMailToolService {
  readonly tool: StructuredTool;

  @Inject(MailerService)
  private readonly mailerService: MailerService;

  @Inject(ConfigService)
  private readonly configService: ConfigService;

  constructor() {
    const schema = z.object({
      to: z.email().describe("收件人邮箱"),
      subject: z.string().describe("邮件主题"),
      text: z.string().optional().describe("邮件内容"),
      html: z.string().optional().optional().describe("邮件内容（HTML 格式）"),
    });

    this.tool = tool(
      async ({ to, subject, text, html }: { to: string; subject: string; text?: string; html?: string }) => {
        const fallbackFrom = this.configService.get("MAIL_FROM");

        await this.mailerService.sendMail({
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
  }
}
