import { createHash } from "node:crypto";
import { canonicalJson } from "../executions/action-json.js";
import type { Policy } from "./policy.js";
// Version 1 historical hashes remain untouched. Arrays retain their original order.
export const POLICY_HASH_VERSION = 2;
export function policyFingerprint(rules: readonly Policy[]) {
  return createHash("sha256")
    .update(
      canonicalJson({
        version: POLICY_HASH_VERSION,
        rules: JSON.parse(JSON.stringify(rules)),
      }),
    )
    .digest("hex");
}
