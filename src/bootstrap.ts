import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { validateEnvironment } from './infrastructure/config/environment.js';
import 'dotenv/config';

export async function createApplication(): Promise<NestFastifyApplication> {
  const config = validateEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({
    bodyLimit: 1_048_576,
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
      // Do not log raw URLs, headers, or bodies; URLs may contain secrets.
      serializers: { req: (req: { method: string }) => ({ method: req.method }) },
    },
  }), { logger: false });
  app.enableShutdownHooks();
  return app;
}
