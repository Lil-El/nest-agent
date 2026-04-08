import { forwardRef, Module } from "@nestjs/common";
import { JobService } from "./job.service";
import { ToolModule } from "src/tools/tool.module";
import { JobAgentService } from "src/ai2/job-agent.service";

@Module({
  imports: [forwardRef(() => ToolModule)], // 避免循环引用
  providers: [JobService, JobAgentService],
  exports: [JobService],
})
export class JobModule {}
