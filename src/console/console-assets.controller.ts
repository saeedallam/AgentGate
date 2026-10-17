import { Controller, Get, Redirect, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const csp =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const assets = new Map(
  [
    ["index.html", "text/html; charset=utf-8"],
    ["app.mjs", "text/javascript; charset=utf-8"],
    ["model.mjs", "text/javascript; charset=utf-8"],
    ["styles.css", "text/css; charset=utf-8"],
    ["logo.svg", "image/svg+xml"],
  ].map(([name, type]) => [
    name!,
    {
      type: type!,
      body: readFileSync(
        resolve(__dirname, "../../public/console", name!),
        "utf8",
      ),
    },
  ]),
);

@Controller()
export class ConsoleAssetsController {
  @Get()
  @Redirect("/console", 302)
  home() {}

  private send(reply: FastifyReply, name: string) {
    const asset = assets.get(name)!;
    return reply
      .header("Content-Type", asset.type)
      .header("Content-Security-Policy", csp)
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY")
      .header("Cache-Control", "no-store")
      .send(asset.body);
  }
  @Get("console") index(@Res() reply: FastifyReply) {
    return this.send(reply, "index.html");
  }
  @Get("console/app.mjs") app(@Res() reply: FastifyReply) {
    return this.send(reply, "app.mjs");
  }
  @Get("console/model.mjs") model(@Res() reply: FastifyReply) {
    return this.send(reply, "model.mjs");
  }
  @Get("console/styles.css") style(@Res() reply: FastifyReply) {
    return this.send(reply, "styles.css");
  }
  @Get("console/logo.svg") logo(@Res() reply: FastifyReply) {
    return this.send(reply, "logo.svg");
  }
}
