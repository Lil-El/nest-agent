import { Inject, Injectable } from "@nestjs/common";
import { CreateAiDto } from "./dto/create-ai.dto";
import { UpdateAiDto } from "./dto/update-ai.dto";
import { ConfigService } from "@nestjs/config";

import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

import type { Runnable } from "@langchain/core/runnables";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { AiTtsStreamEvent, AI_TTS_STREAM_EVENT } from "src/common/stream-events";

@Injectable()
export class AiService {
  private readonly chain: Runnable;

  // 基于属性注入
  @Inject("CHAT_MODEL")
  private readonly chat_model: ChatOpenAI;

  // 基于构造函数注入
  constructor(
    @Inject("CHAT_MODEL") model: ChatOpenAI,
    private readonly eventEmitter: EventEmitter2,
  ) {
    const prompt = new PromptTemplate({
      template: "请回答以下问题：\n\n{query}",
      inputVariables: ["query"],
    });

    this.chain = prompt.pipe(model).pipe(new StringOutputParser());
  }

  // nest 是先执行构造函数，然后注入，最后执行 onModuleInit 函数；所以在构造函数中不可以使用属性注入的属性；
  // 可以在 onModuleInit 生命周期钩子中使用属性注入的属性，但此时链已经构建完成；
  onModuleInit() {
    // console.log("onModuleInit chat_model:", this.chat_model.model); // 正常输出模型名称
  }

  async invoke(query: string): Promise<string> {
    return this.chain.invoke({ query });
  }

  async *stream(query: string, sessionId?: string, messageId?: string): AsyncGenerator<string> {
    const stream = await this.chain.stream({ query });

    for await (const chunk of stream) {
      if (sessionId && messageId) {
        const event: AiTtsStreamEvent = { sessionId, chunk, messageId, type: "chunk" };
        this.eventEmitter.emit(AI_TTS_STREAM_EVENT, event);
      }

      yield chunk;
    }

    if (sessionId && messageId) {
      const event: AiTtsStreamEvent = { sessionId, messageId, type: "end" };
      this.eventEmitter.emit(AI_TTS_STREAM_EVENT, event);
    }
  }
}
