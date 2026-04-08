import { Injectable, Inject } from "@nestjs/common";
import { AliCloudService } from "src/cloud/cloud.service";

import { SpeechSynthesizer } from "alibabacloud-nls";

@Injectable()
export class NlsService {
  @Inject(AliCloudService)
  private readonly aliCloudService: AliCloudService;

  /**
   * 将文字转换为语音音频数据
   * @param text 要转换的文字
   * @returns 音频 Buffer
   */
  async textToSpeech(text: string): Promise<Buffer> {
    const appkey = await this.aliCloudService.getNlsKey();
    const token = await this.aliCloudService.getToken();

    const tts = new SpeechSynthesizer({
      url: "wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1",
      appkey,
      token,
    });

    const audioChunks: Buffer[] = [];

    tts.on("failed", (msg) => {
      console.log("Client recv failed:", msg);
    });

    // 监听音频数据
    tts.on("data", (audioData: Buffer) => {
      audioChunks.push(audioData);
    });

    tts.on("closed", () => {
      console.log("Client recv closed");
    });

    // 开始合成
    tts.start({
      text,
      format: "mp3", // 输出格式为 mp3
      sampleRate: 16000, // 采样率
      voice: "aixia", // 发音人
    });

    return new Promise((resolve, reject) => {
      // 监听合成完成
      tts.on("completed", () => {
        tts.shutdown();
        resolve(Buffer.concat(audioChunks));
      });
    });
  }
}
