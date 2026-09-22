import { type INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppConfigService } from './config/app-config.service';

/**
 * HTTP pipeline shared by main.ts and the e2e tests, so tests exercise exactly the same
 * prefix, validation, security headers and CORS as production.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(AppConfigService);

  // Behind the web container's reverse proxy: trust private-network proxies for req.ip.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.get('CORS_ORIGINS'), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('AsistControl API')
      .setDescription(
        'Control de asistencia, jornadas y sincronización con dispositivos biométricos.\n\n' +
          '**Autenticación:** `POST /api/auth/login` devuelve un access token (Bearer) de corta duración; ' +
          'el refresh token viaja en una cookie httpOnly y se rota con `POST /api/auth/refresh`.\n\n' +
          '**Errores:** todas las respuestas de error siguen el formato `{ statusCode, error, message, path, timestamp, requestId }`.\n\n' +
          '**Tiempo real:** Socket.IO en el namespace `/realtime` con `auth: { token }`.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}
