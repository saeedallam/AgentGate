import { ConfigService } from '@nestjs/config';
import { createApplication } from './bootstrap.js';
import type { Environment } from './infrastructure/config/environment.js';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const config = app.get(ConfigService<Environment, true>);
  await app.listen(config.get('PORT', { infer: true }), config.get('HOST', { infer: true }));
}

bootstrap().catch(() => {
  process.stderr.write('AgentGate startup failed. Check configuration and service availability.\n');
  process.exitCode = 1;
});
