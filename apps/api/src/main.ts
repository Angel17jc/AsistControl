import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  // "Every day at 07:00" follows the process clock, and a container's is UTC: the 07:00
  // notice would arrive at 02:00 in Ecuador. Run on the company's clock instead. It must be
  // set before Nest creates the scheduled jobs.
  if (process.env.APP_TIMEZONE) process.env.TZ = process.env.APP_TIMEZONE;

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const config = app.get(AppConfigService);
  if (config.get('SWAGGER_ENABLED')) setupSwagger(app);

  const port = config.get('PORT');
  await app.listen(port, '0.0.0.0');
  const logger = app.get(Logger);
  logger.log(
    `AsistControl API listening on :${port}` +
      (config.get('SWAGGER_ENABLED') ? ' — docs at /api/docs' : ' (API docs off)'),
  );

  const clock = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (clock === config.get('APP_TIMEZONE')) {
    logger.log(`Scheduled jobs run on ${clock} time`);
  } else {
    // Only when APP_TIMEZONE came from a .env file, read after the jobs were created.
    logger.warn(
      `Scheduled jobs run on ${clock} time, not ${config.get('APP_TIMEZONE')}: ` +
        'set APP_TIMEZONE (or TZ) in the environment',
    );
  }
}

void bootstrap();
