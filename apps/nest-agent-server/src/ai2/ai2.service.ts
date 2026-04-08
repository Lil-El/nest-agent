import { Inject, Injectable } from "@nestjs/common";
import { StructuredTool, tool } from "@langchain/core/tools";
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { Runnable } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";

@Injectable()
export class Ai2Service {
  // Runnable 的第一个类型参数是输入，第二个类型参数是输出。
  // 与 const aiMessage = await this.modelWithTools.invoke(messages); 对应
  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;

  constructor(
    @Inject("CHAT_MODEL") private readonly model: ChatOpenAI,
    @Inject("QUERY_USER_TOOL") private readonly queryUserTool: StructuredTool,
    @Inject("SEND_EMAIL_TOOL") private readonly sendEmailTool: StructuredTool,
    @Inject("WEB_SEARCH_TOOL") private readonly webSearchTool: StructuredTool,
    @Inject("DB_USERS_CRUD_TOOL") private readonly dbUsersCrudTool: StructuredTool,
    @Inject("CRON_JOB_TOOL") private readonly cronJobTool: StructuredTool,
    @Inject("TIME_NOW_TOOL") private readonly getTimeTool: StructuredTool,
  ) {
    this.modelWithTools = this.model.bindTools([
      this.queryUserTool,
      this.sendEmailTool,
      this.webSearchTool,
      this.dbUsersCrudTool,
      this.cronJobTool,
      this.getTimeTool,
    ]);
  }

  async invoke(query: string): Promise<string> {
    const chatHistory = new InMemoryChatMessageHistory([
      new SystemMessage(
        `你是一个智能助手，可以在需要时调用工具（如 query_user）来查询用户信息，再用结果回答用户的问题。`,
      ),
      new HumanMessage(`请回答以下问题：${query}`),
    ]);

    while (true) {
      const messages = await chatHistory.getMessages();

      const aiMessage = await this.modelWithTools.invoke(messages);

      await chatHistory.addMessage(aiMessage);

      if (aiMessage.tool_calls?.length) {
        for (const toolCall of aiMessage.tool_calls) {
          let content: string;

          if (toolCall.name === "query_user") {
            content = await this.queryUserTool.invoke(toolCall.args);
          } else if (toolCall.name === "send_email") {
            content = await this.sendEmailTool.invoke(toolCall.args);
          } else if (toolCall.name === "web_search") {
            content = await this.webSearchTool.invoke(toolCall.args);
          } else if (toolCall.name === "db_users_crud") {
            content = await this.dbUsersCrudTool.invoke(toolCall.args);
          } else if (toolCall.name === "cron_job") {
            content = await this.cronJobTool.invoke(toolCall.args);
          }

          await chatHistory.addMessage(
            new ToolMessage({
              content: content!,
              tool_call_id: toolCall.id!,
            }),
          );
        }
      } else {
        return aiMessage.content as string;
      }
    }
  }

  async *stream(query: string): AsyncGenerator<string> {
    const chatHistory = new InMemoryChatMessageHistory([
      new SystemMessage(`你是一个通用任务助手，可以根据用户的目标规划步骤，并在需要时调用工具：\`time_now\` 查询当前时间、\`query_user\` 查询或校验用户信息、\`send_mail\` 发送邮件、\`web_search\` 进行互联网搜索、\`db_users_crud\` 读写数据库 users 表、\`cron_job\` 创建和管理定时/周期任务（\`list\`/\`add\`/\`toggle\`），从而实现提醒、定期任务、数据同步等各种自动化需求。

定时任务类型选择规则（非常重要）：
- 用户说“X分钟/小时/天后”“在某个时间点”“到点提醒”（一次性）=> 用 \`cron_job\` + \`type=at\`（执行一次后自动停用），\`at\`=当前时间+X 或解析出的时间点
- 用户说“每X分钟/每小时/每天”“定期/循环/一直”（重复执行）=> 用 \`cron_job\` + \`type=every\`（每次执行），\`everyMs\`=X换算成毫秒
- 用户给出 Cron 表达式或明确说“用 cron 表达式”（重复执行）=> 用 \`cron_job\` + \`type=cron\`

在调用 \`cron_job.add\` 创建任务时，需要把用户原始自然语言拆成两部分：一部分是“什么时候执行”（用来决定 type/at/everyMs/cron），另一部分是“要做什么任务本身”。\`instruction\` 字段只能填“要做什么”的那部分文本（保持原语言和原话），不能再改写、翻译或总结。

当用户请求“在未来某个时间点执行某个动作”（例如“1分钟后给我发一个笑话到邮箱”）时，本轮对话只需要使用 \`cron_job\` 设置/更新定时任务，不要在当前轮直接完成这个动作本身：不要直接调用 \`send_mail\` 给他发邮件，也不要在当前轮就真正“执行”指令，只需把要执行的动作写进 \`instruction\` 里，交给将来的定时任务去跑。

注意：像“\`1分钟后提醒我喝水\`”，时间相关信息用于计算下一次执行时间，而 \`instruction\` 应该是“喝水”；本轮不需要立刻提醒。`),
      new HumanMessage(`${query}`),
    ]);

    while (true) {
      const messages = await chatHistory.getMessages();

      const stream = await this.modelWithTools.stream(messages);

      let fullAIMessage: AIMessageChunk | null = null;

      for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
        fullAIMessage = fullAIMessage ? fullAIMessage.concat(chunk) : chunk;

        const hasToolCallChunk = fullAIMessage.tool_call_chunks!?.length > 0;

        // 只要当前轮次还没出现 tool 调用的 chunk，就可以把文本内容流式往外推
        if (!hasToolCallChunk && chunk.content) {
          yield chunk.content as string;
        }
      }

      if (!fullAIMessage) return void 0;

      await chatHistory.addMessage(fullAIMessage);

      if (fullAIMessage.tool_calls?.length) {
        for (const toolCall of fullAIMessage.tool_calls) {
          let content: string;

          if (toolCall.name === "query_user") {
            content = await this.queryUserTool.invoke(toolCall.args);
          } else if (toolCall.name === "send_email") {
            content = await this.sendEmailTool.invoke(toolCall.args);
          } else if (toolCall.name === "web_search") {
            content = await this.webSearchTool.invoke(toolCall.args);
          } else if (toolCall.name === "db_users_crud") {
            content = await this.dbUsersCrudTool.invoke(toolCall.args);
          } else if (toolCall.name === "cron_job") {
            content = await this.cronJobTool.invoke(toolCall.args);
          } else if (toolCall.name === "time_now") {
            content = await this.getTimeTool.invoke(toolCall.args);
          }

          await chatHistory.addMessage(
            new ToolMessage({
              name: toolCall.name,
              content: content!,
              tool_call_id: toolCall.id!,
            }),
          );
        }
      } else {
        return void 0; // 不加return 会导致死循环
      }
    }
  }
}
