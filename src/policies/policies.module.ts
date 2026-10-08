import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PolicyEngine } from './policy-engine.js';
import { PolicyStore } from './policy-store.js';

@Module({
  imports: [ConfigModule],
  providers: [
    PolicyEngine,
    {
      provide: PolicyStore,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new PolicyStore(config.get<string>('POLICY_RULES_JSON') ?? '[]'),
    },
  ],
  exports: [PolicyStore, PolicyEngine],
})
export class PoliciesModule {}
