import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  setupSwagger(app);

  const port = app.get(AppConfigService).get('PORT');
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`AsistControl API listening on :${port} — docs at /api/docs`);
}

void bootstrap();
