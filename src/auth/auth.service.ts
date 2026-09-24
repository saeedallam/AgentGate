import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { registerSchema } from './dto/register.dto.js';
import { PasswordService } from './password.service.js';
import { loginSchema } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  async register(input: unknown) {
    const result = registerSchema.safeParse(input);

    if (!result.success) {
      throw new BadRequestException('Invalid registration data');
    }

    const { email, password } = result.data;
    const passwordHash = await this.passwords.hash(password);

    try {
      return await this.prisma.user.create({
        data: {
          email,
          passwordHash,
        },
        select: {
          id: true,
          email: true,
          createdAt: true,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Registration conflicts with an existing account');
      }

      throw error;
    }
  }

  async validateCredentials(input: unknown) {
  const result = loginSchema.safeParse(input);

  if (!result.success) {
    throw new BadRequestException('Invalid login data');
  }

  const { email, password } = result.data;

  const user = await this.prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
    },
  });

  if (!user) {
    await this.passwords.verifyAgainstDummyHash(password);

    throw new UnauthorizedException('Invalid email or password');
  }

  const matches = await this.passwords.verify(
    user.passwordHash,
    password,
  );

  if (!matches) {
    throw new UnauthorizedException('Invalid email or password');
  }

  return {
    id: user.id,
    email: user.email,
  };
}
}