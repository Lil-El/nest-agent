import { Controller, Get, Query, Sse } from "@nestjs/common";
import { AiService } from "./ai.service";
import { from, map, Observable } from "rxjs";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { AI_TTS_STREAM_EVENT, AiTtsStreamEvent } from "src/common/stream-events";

@Controller("ai")
export class AiController {
  private readonly eventEmitter: EventEmitter2;

  constructor(private readonly aiService: AiService) {}

  @Get("chat")
  async chat(@Query("query") query: string) {
    const answer = await this.aiService.invoke(query);
    return { answer };
  }

  @Sse("chat/stream")
  chatStream(
    @Query("query") query: string,
    @Query("sessionId") sessionId?: string,
    @Query("messageId") messageId?: string,
  ): Observable<{ data: string }> {
    const session = sessionId?.trim();
    if (session && messageId) {
      const event: AiTtsStreamEvent = { sessionId: session, type: "start", messageId };
      this.eventEmitter.emit(AI_TTS_STREAM_EVENT, event);
    }

    return from(this.aiService.stream(query, session)).pipe(map((chunk) => ({ data: chunk })));
  }
}
