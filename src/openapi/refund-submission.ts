import { z } from "zod";
import { refundArgumentsSchema } from "../actions/definitions/refund-create.action.js";

// The one currently supported action. Extend this documented union when the
// registry gains another action; the runtime registry remains authoritative.
export const refundSubmissionSchema = z.strictObject({
  action: z.strictObject({ name: z.literal("refund.create") }),
  arguments: refundArgumentsSchema,
});
