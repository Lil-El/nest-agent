import { Module } from "@nestjs/common";
import { AiService } from "./ai.service";
import { AiController } from "./ai.controller";
import { ChatOpenAI } from "@langchain/openai";
import { ConfigService } from "@nestjs/config";
import { ToolModule } from "src/tools/tool.module";

const llmProvider = {
  provide: "CHAT_MODEL",
  inject: [ConfigService],
  useFactory(configService: ConfigService) {
    return new ChatOpenAI({
      model: configService.get("MODEL_NAME"),
      apiKey: configService.get("OPENAI_API_KEY"),
      configuration: {
        baseURL: configService.get("OPENAI_BASE_URL"),
      },
    });
  },
};

/**
 * @example
 * 访问 /index.html，测试流式请求
 */

@Module({
  imports: [ToolModule],
  controllers: [AiController],
  providers: [AiService /* , llmProvider */],
  // exports: [llmProvider], // 如果要在其他模块中使用 AiService，需要导出它
})
export class AiModule {}
