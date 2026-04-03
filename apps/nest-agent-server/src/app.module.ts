import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { BookModule } from "./book/book.module";
import { AiModule } from "./ai/ai.module";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { CronModule } from "./cron/cron.module";
import { MailerModule } from "@nestjs-modules/mailer";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "path";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "..", "public"),
    }),
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
