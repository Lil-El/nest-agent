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
export class CronService {
  // Runnable 的第一个类型参数是输入，第二个类型参数是输出。
  // 与 const aiMessage = await this.modelWithTools.invoke(messages); 对应
  private readonly modelWithTools: Runnable<BaseMessage[], AIMessage>;

  constructor(
    @Inject("CHAT_MODEL") private readonly model: ChatOpenAI,
    @Inject("QUERY_USER_TOOL") private readonly queryUserTool: StructuredTool,
    @Inject("SEND_EMAIL_TOOL") private readonly sendEmailTool: StructuredTool,
    @Inject("WEB_SEARCH_TOOL") private readonly webSearchTool: StructuredTool,
  ) {
    this.modelWithTools = this.model.bindTools([this.queryUserTool, this.sendEmailTool, this.webSearchTool]);
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
      new SystemMessage(
        `你是一个智能助手，可以在需要时调用工具（如 query_user）来查询用户信息，再用结果回答用户问题。`,
      ),
      new HumanMessage(`请回答以下问题：${query}`),
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
            console.log("调用tool->query_user");
            content = await this.queryUserTool.invoke(toolCall.args);
          } else if (toolCall.name === "send_email") {
            console.log("调用tool->send_email");
            content = await this.sendEmailTool.invoke(toolCall.args);
          } else if (toolCall.name === "web_search") {
            console.log("调用tool->web_search");
            content = await this.webSearchTool.invoke(toolCall.args);
          }

          await chatHistory.addMessage(
            new ToolMessage({
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
