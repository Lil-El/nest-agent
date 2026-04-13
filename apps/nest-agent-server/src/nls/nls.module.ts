import { Module } from "@nestjs/common";
import { NlsService } from "./nls.service";
import { NlsController } from "./nls.controller";
import { AliCloudModule } from "src/cloud/cloud.module";
import { ConfigService } from "@nestjs/config";
import { NlsWsGateway } from "./nls.gateway";

/**
 * 访问 /ws-tts.html 可以多人对话，将文字转为语音，广播给其他人
 *
 * 访问 /asr.html 可以录音，识别文字
 *
 * 访问 /audio-mime-types.html 可以获取音频文件的 MIME 类型
 *
 * 访问 /ai-assistant.html AI 助手，可以语音提问，并获取语音回复
 */

@Module({
  imports: [
    AliCloudModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        return {
          accessKeyId: configService.getOrThrow("ALI_CLOUD_ACCESS_KEY_ID"),
          accessKeySecret: configService.getOrThrow("ALI_CLOUD_ACCESS_KEY_SECRET"),
          endPoint: configService.getOrThrow("ALI_CLOUD_END_POINT"),
          nlsKey: configService.getOrThrow("ALI_CLOUD_NLS_API_KEY"),
        };
      },
    })
  ],
  controllers: [NlsController],
  providers: [NlsService, NlsWsGateway],
})
export class NlsModule {}
