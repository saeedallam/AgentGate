import { ApiExcludeController } from "@nestjs/swagger";
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Redirect,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const csp =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
// One explicit allowlist. Route parameters are keys, never filesystem paths.
const manifest: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "app.mjs": "text/javascript; charset=utf-8",
  "model.mjs": "text/javascript; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
  "logo.svg": "image/svg+xml",
  "fonts/dmsans.ttf": "font/ttf",
  "fonts/manrope.ttf": "font/ttf",
};
for (const name of [
  "index",
  "execution-table",
  "hive-art",
  "result",
  "overview",
  "executions",
  "agents",
  "approvals",
  "budgets",
  "studies",
  "playground",
  "help",
  "execution-details",
  "approval-details",
]) {
  manifest[`pages/${name}.mjs`] = "text/javascript; charset=utf-8";
}

@ApiExcludeController()
@Controller()
export class ConsoleAssetsController {
  // Loaded once per application instance, not as an import side effect or per request.
  private readonly assets = new Map(
    Object.entries(manifest).map(([name, type]) => [
      name,
      {
        type,
        body: readFileSync(resolve(__dirname, "../../public/console", name)),
      },
    ]),
  );

  @Get()
  @Redirect("/console", 302)
  home() {}

  private send(reply: FastifyReply, name: string) {
    const asset = this.assets.get(name);
    if (!asset) throw new NotFoundException("Asset not found");
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
  @Get("console/*") asset(
    @Param("*") path: string | string[],
    @Res() reply: FastifyReply,
  ) {
    return this.send(reply, Array.isArray(path) ? path.join("/") : path);
  }
}
