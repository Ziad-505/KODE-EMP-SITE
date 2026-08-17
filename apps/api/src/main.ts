import 'reflect-metadata';
import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import type { Env } from './config/env';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { LoggingInterceptor } from './common/logging.interceptor';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger: ['error', 'warn', 'log'],
  });

  const env = app.get<Env>(ENV);

  // Behind a reverse proxy, trust exactly one hop so req.ip is the real client
  // and rate limiting cannot be defeated by a spoofed X-Forwarded-For.
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: env.isProduction
        ? {
            directives: {
              defaultSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'none'"],
              formAction: ["'none'"],
            },
          }
        : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: env.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });

  app.setGlobalPrefix('api', { exclude: ['media/:shard/:name'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalFilters(new AllExceptionsFilter(env.isProduction));
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.enableShutdownHooks();

  await mkdir(resolve(env.UPLOAD_DIR), { recursive: true });

  if (env.ENABLE_SWAGGER) {
    const config = new DocumentBuilder()
      .setTitle('KODE Sports Club Portal API')
      .setDescription(
        'Employee portal and CMS. Authentication is cookie-based; state-changing requests require the X-CSRF-Token header.',
      )
      .setVersion('1.0')
      .addCookieAuth('kode_at')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config), {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`API documentation at ${env.API_PUBLIC_URL}/api/docs`);
  }

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`API listening on port ${env.PORT} in ${env.NODE_ENV} mode`);
  logger.log(`Microsoft Entra ID sign-in: ${env.ENTRA_ENABLED ? 'enabled' : 'disabled'}`);
}

void bootstrap().catch((error: unknown) => {
  console.error('Failed to start the API:', error);
  process.exit(1);
});
