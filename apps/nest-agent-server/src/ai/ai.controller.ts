import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Sse } from "@nestjs/common";
import { AiService } from "./ai.service";
import { CreateAiDto } from "./dto/create-ai.dto";
import { UpdateAiDto } from "./dto/update-ai.dto";
import { from, map, Observable } from "rxjs";

@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get("chat")
  async chat(@Query("query") query: string) {
    const answer = await this.aiService.invoke(query);
    return { answer };
  }

  @Sse("chat/stream")
  chatStream(@Query("query") query: string): Observable<{ data: string }> {
    return from(this.aiService.stream(query)).pipe(map((chunk) => ({ data: chunk })));
  }
}
