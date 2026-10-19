import { ApiLoginResponse } from "../openapi/api-responses.js";
import { ApiInput, ApiErrors } from "../openapi/api-contract.js";
import { loginSchema } from "./dto/login.dto.js";
import { registerSchema } from "./dto/register.dto.js";
import { ApiTags } from "@nestjs/swagger";
import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

import { AuthService } from "./auth.service.js";
import { LoginService } from "./login.service.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly loginService: LoginService,
  ) {}

  @ApiErrors("Register a user")
  @ApiInput(registerSchema, {
    email: "demo@example.test",
    password: "example-password-change-me",
  })
  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ThrottlerGuard)
  register(@Body() body: unknown) {
    return this.auth.register(body);
  }

  @ApiErrors("Log in and obtain a short-lived JWT")
  @ApiInput(loginSchema, {
    email: "demo@example.test",
    password: "example-password-change-me",
  })
  @ApiLoginResponse()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @UseGuards(ThrottlerGuard)
  login(@Body() body: unknown) {
    return this.loginService.login(body);
  }
}
