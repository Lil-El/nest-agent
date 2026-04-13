import { Inject } from "@nestjs/common";
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { NlsService } from "./nls.service";

/**
 * SSE 用于文本推送，但是语音的推送，需要websocket
 * 因为SSE的二进制数据要转成base64，会导致体积过大
 * 所以使用ws推送流式语音
 */

@WebSocketGateway({
  // cors: {
  //   origin: "*",
  // },
  namespace: "nls",
})
export class NlsWsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @Inject(NlsService)
  private readonly nlsService: NlsService;

  @WebSocketServer()
  server: Server;

  afterInit(server: Server) {
    console.log("nls gateway init");
  }

  handleConnection(client: Socket, ...args: any[]) {
    console.log("nls gateway connection", client.id);
    this.nlsService.addConnectClient(client.id, client);
  }

  handleDisconnect(client: Socket) {
    console.log("nls gateway disconnect", client.id);
    this.nlsService.removeConnectClient(client.id);
  }

  @SubscribeMessage("speech_text")
  handleEvent(@MessageBody() data: any, @ConnectedSocket() client: Socket) {
    console.log("Received speech_text request:", data);

    const text = data?.text;
    const messageId = data?.messageId;

    this.nlsService.textToSpeech(text).then((buffer) => {
      const bufferArray = Array.from(buffer);

      // client.emit 只给当前client发送
      // client.broadcast.emit 给除了自己以外所有client发送

      // 广播给所有client
      this.server.emit("speech_buffer", {
        type: "Buffer",
        data: bufferArray,
        text: text,
        messageId: messageId,
      });
    });
  }
}
