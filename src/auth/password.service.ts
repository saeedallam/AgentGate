import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHashPromise: Promise<string> | undefined;

  async onModuleInit(): Promise<void> {
    await this.getDummyHash();
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return argon2.verify(passwordHash, password);
  }

  async verifyAgainstDummyHash(password: string): Promise<void> {
    const dummyHash = await this.getDummyHash();

    await this.verify(dummyHash, password);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.hash(
      randomBytes(32).toString('hex'),
    );

    return this.dummyHashPromise;
  }
}