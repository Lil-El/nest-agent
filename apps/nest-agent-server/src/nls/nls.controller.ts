import { Controller, Get, Inject, Query, Res } from "@nestjs/common";
import { NlsService } from "./nls.service";
import type { Response } from "express";

@Controller("nls")
export class NlsController {
  @Inject(NlsService)
  private readonly nlsService: NlsService;

  // https://help.aliyun.com/zh/isi/developer-reference/sdk-for-node-js-1
  @Get("tts")
  async textToSpeech(@Query("text") text: string, @Res() res: Response) {
    if (!text) {
      return res.status(400).json({ message: "请提供 text 参数" });
    }

    try {
      const audioBuffer = await this.nlsService.textToSpeech(text);

      // 设置响应头，返回音频文件
      res.set({
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `inline; filename="speech.mp3"`,
        "Content-Length": audioBuffer.length,
      });

      // 发送音频数据
      res.send(audioBuffer);
    } catch (error) {
      res.status(500).json({ message: "语音合成失败", error: error.message });
    }
  }

  // https://help.aliyun.com/zh/isi/developer-reference/stream-input-tts-sdk-quick-start
  @Get("tts-stream")
  async ttsStream(@Res() res: Response) {

  }
}
