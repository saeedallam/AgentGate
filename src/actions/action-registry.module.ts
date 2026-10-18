import { Module } from "@nestjs/common";
import { ActionRegistry } from "./action-registry.js";
@Module({ providers: [ActionRegistry], exports: [ActionRegistry] })
export class ActionRegistryModule {}
