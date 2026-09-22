import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './infrastructure/config/environment.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { HealthController } from './infrastructure/health/health.controller.js';
import { HealthService } from './infrastructure/health/health.service.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }), DatabaseModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
