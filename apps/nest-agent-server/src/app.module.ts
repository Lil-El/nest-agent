import { Inject, Module, OnApplicationBootstrap } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { BookModule } from "./book/book.module";
import { AiModule } from "./ai/ai.module";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CronModule } from "./cron/cron.module";
import { MailerModule } from "@nestjs-modules/mailer";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UsersModule } from "./users/users.module";
import { User } from "./users/entities/user.entity";
import { CronExpression, ScheduleModule, SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { JobModule } from './job/job.module';
import { Job } from "./job/entities/job.entity";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "..", "public"),
    }),
    TypeOrmModule.forRoot({
      type: "mysql",
      host: "localhost",
      port: 3306,
      username: "root",
      password: "admin",
      database: "hello",
      connectorPackage: "mysql2",
      synchronize: true, // 自动同步数据库
      logging: !true, // 显示sql语句
      entities: [User, Job], // 告诉typeorm，实体的位置
      // entities: ["dist/**/*.entity{.ts,.js}"],
    }),
    ScheduleModule.forRoot(),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory(configService: ConfigService) {
        return {
          transport: {
            host: configService.get("MAIL_HOST"),
            port: Number(configService.get("MAIL_PORT")),
            secure: false,
            auth: {
              user: configService.get("MAIL_USER"),
              pass: configService.get("MAIL_PASS"),
            },
          },
          defaults: {
            from: `"No Reply" <${configService.get("MAIL_FROM")}>`,
          },
        };
      },
    }),
    BookModule,
    AiModule,
    CronModule,
    UsersModule,
    JobModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
// 实现 OnApplicationBootstrap，可以添加应用启动时的执行逻辑
export class AppModule implements OnApplicationBootstrap {
  @Inject(SchedulerRegistry)
  schedulerRegistry: SchedulerRegistry;

  async onApplicationBootstrap() {
    console.log("AppModule onApplicationBootstrap");
    // this.testScheduler();
  }

  // 调试 cron 定时任务
  testScheduler() {
    const job = new CronJob(CronExpression.EVERY_SECOND, () => {
      console.log("Cron job executed");
    });

    this.schedulerRegistry.addCronJob("my-cron-job", job);
    job.start();
    setTimeout(() => {
      this.schedulerRegistry.deleteCronJob("my-cron-job");
    }, 5000);

    const intervalRef = setInterval(() => {
      console.log("Interval job executed");
    }, 1000);
    this.schedulerRegistry.addInterval("my-interval-job", intervalRef);
    setTimeout(() => {
      this.schedulerRegistry.deleteInterval("my-interval-job");
    }, 5000);

    const timeoutRef = setTimeout(() => {
      console.log("Timeout job executed");
    }, 1000);
    this.schedulerRegistry.addTimeout("my-timeout-job", timeoutRef);
    setTimeout(() => {
      this.schedulerRegistry.deleteTimeout("my-timeout-job");
    }, 5000);
  }
}
