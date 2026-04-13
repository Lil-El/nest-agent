import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { NlsService } from "./nls.service";
import type { Response } from "express";
import fs from "fs";

import { Readable, PassThrough } from "stream";
import ffmpeg from "fluent-ffmpeg";
import { join } from "path";

@Controller("nls")
export class NlsController {
  @Inject(NlsService)
  private readonly nlsService: NlsService;

  constructor() {
    const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
    ffmpeg.setFfmpegPath(ffmpegPath);
  }

  // https://help.aliyun.com/zh/isi/developer-reference/sdk-for-node-js-1
  // 语音合成
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
  // 流式语音合成
  @Get("tts-stream")
  @Header("Content-Type", "audio/mpeg")
  @Header("Transfer-Encoding", "chunked")
  async ttsStream() {
    const textArr = [
      "这三天走了这么多的路，M先生会时时刻刻拉着我的手，然后严肃又玩笑着说",
      "“你这么小，把你弄丢了怎么办？”。",
      "去看兵马俑的时候，人潮拥挤，每个人都毫不吝啬地争抢着栏杆前的空位。",
      "M先生始终拉着我的左手，紧紧护在我身后，让我先走，让我先瞧。",
      "大唐不夜城的妆造是临时加入行程的。假期前预约了一家妆造店，到达现场后，店员说需要等一个多小时。",
      "我本来就是低精力人群，一路上的奔波让我累累的，我也不想过多浪费这些时间耽误我们一起去玩别的。",
      "我和M先生商量过后，索性转进了旁边的魏家凉皮，点了两份以前就想吃的汉堡，外带凉皮和沙棘汁。",
    ];

    /*
      // 将文本转为语音，写入文件
      const filePath = join(__dirname, "../../public/text.mp3");

      const stream = fs.createWriteStream(filePath, { flags: "a" });

      for (const text of textArr) {
        const buffer = await this.nlsService.textToSpeech(text);
        stream.write(buffer);
      }

      stream.end();
    */

    async function* generateAudio() {
      for (const text of textArr) {
        yield await this.nlsService.textToSpeech(text);
      }
    }

    const audioStream = Readable.from(generateAudio.bind(this)());

    return new StreamableFile(audioStream, {
      type: "audio/mpeg",
    });
  }

  // 语音识别
  @Get("asr")
  async asr(): Promise<string> {
    const audioPath = join(__dirname, "../../public/audio.mp3");
    // return this.nlsService.asrStream(audioPath);
    return this.nlsService.asrStream(await fs.readFileSync(audioPath), "mp3");
  }

  @Post("asr")
  @UseInterceptors(FileInterceptor("audio"))
  async recognize(@UploadedFile() file?: any) {
    // asr.html 采用的是 webm/opus 格式

    // 保存录音文件:
    // const savePath = join(__dirname, "../../public", file.originalname);
    // await fs.writeFileSync(savePath, file.buffer);

    // 模拟一个录音文件
    // const filePath = join(__dirname, "../../public", "record.webm");
    // const buffer = fs.readFileSync(filePath);

    const buffer = file.buffer;

    if (file?.buffer?.length) {
      try {
        // 将接口传过来的 webm 文件转换为 ogg
        const oggBuffer = await this.convertWebmToOgg(buffer);

        const text = await this.nlsService.asrStream(oggBuffer, "opus");
        return { text };
      } catch (error) {
        console.error("NLS Error:", error);
      }
    } else {
      throw new BadRequestException("请上传音频文件");
    }
  }

  async convertWebmToOgg(webmBuffer: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // 创建可读流
      const webmStream = new Readable();
      webmStream.push(webmBuffer);
      webmStream.push(null);

      // 创建转换流
      const outputStream = new PassThrough();
      const chunks: Buffer[] = [];

      // 收集数据
      outputStream.on("data", (chunk) => chunks.push(chunk));
      outputStream.on("end", () => {
        const oggBuffer = Buffer.concat(chunks);
        resolve(oggBuffer);
      });
      outputStream.on("error", reject);

      // 使用 fluent-ffmpeg 转换
      ffmpeg(webmStream)
        .inputFormat("webm")
        .toFormat("ogg")
        .audioCodec("libopus")
        .audioBitrate("128k")
        .on("start", (commandLine) => {
          console.log("开始转换:", commandLine);
        })
        .on("error", (err) => {
          reject(new Error(`音频转换失败: ${err.message}`));
        })
        .pipe(outputStream, { end: true });
    });
  }
}
