import { Inject, Injectable, Logger } from "@nestjs/common";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { Runnable } from "@langchain/core/runnables";
import { StructuredTool } from "@langchain/core/tools";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";

// 定时任务执行
@Injectable()
export class JobAgentService {
  private readonly logger = new Logger(JobAgentService.name);
  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;

  constructor(
    @Inject("CHAT_MODEL") model: ChatOpenAI,
    @Inject("SEND_EMAIL_TOOL") private readonly sendMailTool: StructuredTool,
    @Inject("WEB_SEARCH_TOOL") private readonly webSearchTool: StructuredTool,
    @Inject("DB_USERS_CRUD_TOOL") private readonly dbUsersCrudTool: StructuredTool,
    @Inject("TIME_NOW_TOOL") private readonly timeNowTool: StructuredTool,
  ) {
    this.modelWithTools = model.bindTools([
      this.sendMailTool,
      this.webSearchTool,
      this.dbUsersCrudTool,
      this.timeNowTool,
    ]);
  }

  async runJob(instruction: string): Promise<string> {
    const chatHistory = new InMemoryChatMessageHistory([
      new SystemMessage(
        "你是一个用于执行后台任务的智能代理。你会根据给定的任务指令，必要时调用工具（如 db_users_crud、send_mail、web_search、time_now 等）来查询或改写数据，然后给出清晰的步骤和结果说明。",
      ),
      new HumanMessage(instruction),
    ]);

    while (true) {
      const aiMessage = await this.modelWithTools.invoke(await chatHistory.getMessages());

      await chatHistory.addMessage(aiMessage);

      if (aiMessage.tool_calls?.length) {
        for (const toolCall of aiMessage.tool_calls) {
          let content: string;

          if (toolCall.name === "send_email") {
            content = await this.sendMailTool.invoke(toolCall.args);
          } else if (toolCall.name === "web_search") {
            content = await this.webSearchTool.invoke(toolCall.args);
          } else if (toolCall.name === "db_users_crud") {
            content = await this.dbUsersCrudTool.invoke(toolCall.args);
          } else if (toolCall.name === "time_now") {
            content = await this.timeNowTool.invoke(toolCall.args);
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
}
