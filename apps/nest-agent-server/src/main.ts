import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import fs from 'fs';

// openssl 生成临时证书
const httpsOptions = {
  key: fs.readFileSync('./secrets/server.key'),
  cert: fs.readFileSync('./secrets/server.cert'),
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
  httpsOptions,
});
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
