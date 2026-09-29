import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const API_KEY_LENGTH = 106;
const API_KEY_PATTERN = /^(agt_live_[a-f0-9]{32})_[a-f0-9]{64}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface GeneratedAgentKey {
  readonly apiKey: string;
  readonly keyPrefix: string;
  readonly keyHash: string;
}

@Injectable()
export class AgentKeyService {
  generate(): GeneratedAgentKey {
    const publicId = randomBytes(16).toString('hex');
    const secret = randomBytes(32).toString('hex');

    const keyPrefix = `agt_live_${publicId}`;
    const apiKey = `${keyPrefix}_${secret}`;

    return {
      apiKey,
      keyPrefix,
      keyHash: this.hash(apiKey),
    };
  }

  getPrefix(input: unknown): string | null {
    if (typeof input !== 'string' || input.length !== API_KEY_LENGTH) {
      return null;
    }

    const match = API_KEY_PATTERN.exec(input);

    return match?.[1] ?? null;
  }

  verify(input: unknown, storedHash: string): boolean {
    if (this.getPrefix(input) === null) {
      return false;
    }

    if (typeof input !== 'string') {
      return false;
    }

    if (storedHash.length !== 64 || !HASH_PATTERN.test(storedHash)) {
      return false;
    }

    const actualHash = Buffer.from(this.hash(input), 'hex');
    const expectedHash = Buffer.from(storedHash, 'hex');

    return timingSafeEqual(actualHash, expectedHash);
  }

  private hash(apiKey: string): string {
    return createHash('sha256').update(apiKey, 'utf8').digest('hex');
  }
}
