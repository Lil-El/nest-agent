import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Sse } from "@nestjs/common";
import { CronService } from "./cron.service";
import { from, Observable, map } from "rxjs";

@Controller("cron")
export class CronController {
  constructor(private readonly cronService: CronService) {}

  @Get()
  async chat(@Query("query") query: string) {
    const answer = await this.cronService.invoke(query);
    return { answer };
  }

  @Sse("/stream")
  stream(@Query("query") query: string): Observable<{ data: string }> {
    const stream = this.cronService.stream(query);

    return from(stream).pipe(map((chunk) => ({ data: chunk })));
  }
}
