import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Sse } from "@nestjs/common";
import { Ai2Service } from "./ai2.service";
import { from, Observable, map } from "rxjs";

@Controller("ai2")
export class Ai2Controller {
  constructor(private readonly aiService: Ai2Service) {}

  @Get()
  async chat(@Query("query") query: string) {
    const answer = await this.aiService.invoke(query);
    return { answer };
  }

  @Sse("/stream")
  stream(@Query("query") query: string): Observable<{ data: string }> {
    const stream = this.aiService.stream(query);

    return from(stream).pipe(map((chunk) => ({ data: chunk })));
  }
}
