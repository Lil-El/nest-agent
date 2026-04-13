import { Injectable, Inject } from "@nestjs/common";
import { AliCloudService } from "src/cloud/cloud.service";

import { SpeechSynthesizer, SpeechRecognition } from "alibabacloud-nls";
import { createReadStream, readFileSync } from "fs";
import { Socket } from "socket.io";
import { AI_TTS_STREAM_EVENT, type AiTtsStreamEvent } from "src/common/stream-events";
import { OnEvent } from "@nestjs/event-emitter";

@Injectable()
export class NlsService {
  @Inject(AliCloudService)
  private readonly aliCloudService: AliCloudService;

  private static readonly URL: string = "wss://nls-gateway.cn-shanghai.aliyuncs.com/ws/v1";

  private appkey: string;

  private token: string;

  private connectClients = new Map<string, Socket>();

  // 为每个 sessionId 维护一个串行任务队列
  private ttsQueues = new Map<string, Array<() => Promise<void>>>();
  private ttsProcessing = new Map<string, boolean>();

  addConnectClient(id, client: Socket) {
    this.connectClients.set(id, client);
  }

  removeConnectClient(id) {
    this.connectClients.delete(id);
    // 清理该会话的队列状态
    this.ttsQueues.delete(id);
    this.ttsProcessing.delete(id);
  }

  /**
   * 将文字转换为语音音频数据
   * @param text 要转换的文字
   * @returns 音频 Buffer
   */
  async textToSpeech(text: string): Promise<Buffer> {
    this.appkey = await this.aliCloudService.getNlsKey();
    this.token = await this.aliCloudService.getToken();

    // 过滤文本
    text = text.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "");
    if (text.length === 0) {
      return Buffer.from("");
    }

    const tts = new SpeechSynthesizer({
      url: NlsService.URL,
      appkey: this.appkey,
      token: this.token,
    });

    const audioChunks: Buffer[] = [];

    // 监听音频数据
    tts.on("data", (audioData: Buffer) => {
      audioChunks.push(audioData);
    });

    tts.on("closed", () => {
      console.log("Client recv closed ");
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

      tts.on("failed", (msg) => {
        reject(JSON.parse(msg).header.status_text);
      });
    });
  }

  /**
   * 流式语音识别 - 将音频文件转换为文字
   * @param filePathOrFileBuffer 音频文件路径或文件 buffer
   * @returns 识别结果文本
   */
  async asrStream(filePathOrFileBuffer: Buffer | string, format: string): Promise<string> {
    // 支持的输入格式：单声道（mono）、16 bit采样位数，包括PCM、PCM编码的WAV、OGG封装的OPUS、OGG封装的SPEEX、AMR、MP3、AAC。
    const fileBuffer =
      typeof filePathOrFileBuffer === "string" ? await readFileSync(filePathOrFileBuffer) : filePathOrFileBuffer;

    this.appkey = await this.aliCloudService.getNlsKey();
    this.token = await this.aliCloudService.getToken();

    const sr = new SpeechRecognition({
      url: NlsService.URL,
      appkey: this.appkey,
      token: this.token,
    });

    sr.on("started", (msg) => {});

    sr.on("changed", (msg) => {});

    sr.on("closed", () => {});

    return new Promise((resolve, reject) => {
      sr.on("completed", (res) => {
        const { payload } = JSON.parse(res);
        sr.shutdown();
        resolve(payload.result);
      });

      sr.on("failed", (msg) => {
        sr.shutdown();
        reject(JSON.parse(msg).header.status_text);
      });

      // 支持的音频格式，包括PCM、WAV、OPUS、SPEEX、AMR、MP3、AAC。
      const params = sr.defaultStartParams();
      params.format = format;

      // 启动语音识别
      sr.start(params, true, 6000)
        .then(() => {
          /* 分块发送音频数据
            const stream = createReadStream(filePath, {
              highWaterMark: 3200, // 每次读取 3200 字节（约 100ms 音频）
            });

            stream.on("data", (chunk: Buffer) => {
              sr.sendAudio(chunk);
            });

            stream.on("end", () => {
              sr.close();
            });

            stream.on("error", (error) => {
              console.error("File read error:", error);
              sr.shutdown();
              reject(error);
            });
          */

          // 手动拆分音频文件
          const chunkSize = 3200;
          const totalChunks = Math.ceil(fileBuffer.length / chunkSize);

          for (let i = 0; i < totalChunks; i++) {
            const chunk = fileBuffer.subarray(i * chunkSize, (i + 1) * chunkSize);
            sr.sendAudio(chunk);
          }

          sr.close();
        })
        .catch((error) => {
          // token 过期会在这里捕获
          console.error("Failed to start ASR session:", error);
          sr.shutdown();
          reject(error);
        });
    });
  }

  @OnEvent(AI_TTS_STREAM_EVENT)
  async handleAiStreamEvent(event: AiTtsStreamEvent) {
    const client = this.connectClients.get(event.sessionId);
    if (!client) return;

    switch (event.type) {
      case "start": {
        client.emit("tts-start", { messageId: event.messageId });
        break;
      }
      case "end": {
        client.emit("tts-end", { messageId: event.messageId });
        break;
      }
      case "chunk": {
        // 创建 TTS 任务
        const ttsTask = async () => {
          try {
            const buffer = await this.textToSpeech(event.chunk);
            const bufferArray = buffer;
            if (bufferArray.length === 0) return void 0;

            client.emit("speech_buffer", {
              type: "Buffer",
              data: bufferArray,
            });
          } catch (error) {
            console.error(`TTS failed for session ${event.sessionId}:`, error);
          } finally {
            // 处理队列中的下一个任务
            this.processNextTtsTask(event.sessionId);
          }
        };

        // 将任务加入队列
        if (!this.ttsQueues.has(event.sessionId)) {
          this.ttsQueues.set(event.sessionId, []);
        }
        this.ttsQueues.get(event.sessionId)!.push(ttsTask);

        // 如果当前没有正在处理的任务,则开始处理队列
        if (!this.ttsProcessing.get(event.sessionId)) {
          this.processNextTtsTask(event.sessionId);
        }

        break;
      }
      default: {
      }
    }
  }

  /**
   * 处理队列中的下一个 TTS 任务
   * @param sessionId 会话 ID
   */
  private async processNextTtsTask(sessionId: string) {
    const queue = this.ttsQueues.get(sessionId);

    // 如果队列为空或不存在,标记为未在处理
    if (!queue || queue.length === 0) {
      this.ttsProcessing.set(sessionId, false);
      return;
    }

    // 标记为正在处理
    this.ttsProcessing.set(sessionId, true);

    // 取出并执行第一个任务
    const task = queue.shift();
    if (task) {
      await task();
    }
  }
}
