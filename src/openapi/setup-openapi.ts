import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { Environment } from "../infrastructure/config/environment.js";

export function setupOpenApi(
  app: NestFastifyApplication,
  config: Environment,
): void {
  const enabled = config.API_DOCS_ENABLED ?? config.NODE_ENV === "development";
  if (!enabled) return;
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("AgentGate API")
      .setDescription(
        "Runtime action safety for AI agents. Fake Commerce is a test lab, not a real payment integration. Authorize with either a user JWT or an agent API key as required by each operation. Paste the token only, without the Bearer prefix. Swagger sends real requests: approval does not execute an action, and ambiguous outcomes must be reconciled before retrying. Amounts are integer minor units: 5000 USD cents = $50. Custom validation and authorization remain enforced by the server.",
      )
      .setVersion("1.0")
      .setLicense("MIT", "https://opensource.org/license/mit")
      .addServer("/")
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "User access token returned by POST /auth/login. Membership and OWNER checks still apply.",
        },
        "userJwt",
      )
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          description:
            "Agent API key returned once at credential creation. Not a user JWT.",
        },
        "agentApiKey",
      )
      .build(),
  );
  SwaggerModule.setup("docs", app, document, {
    jsonDocumentUrl: "openapi.json",
    raw: ["json"],
    customSiteTitle: "AgentGate API Reference",
    swaggerOptions: {
      persistAuthorization: false,
      validatorUrl: null,
      tryItOutEnabled: false,
      displayRequestDuration: true,
    },
  });
}
