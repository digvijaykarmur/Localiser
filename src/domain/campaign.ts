import { z } from "zod";
import { DialectCode, FormatCode } from "./primitives";

export const SlotStatus = z.enum([
  "EMPTY",
  "PLANNED",
  "GENERATING",
  "AWAITING_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "PUBLISHED",
  "MEASURED",
]);
export type SlotStatus = z.infer<typeof SlotStatus>;

export const Campaign = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  channel: DialectCode,
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  budget_inr: z.number().positive(),
  created_at: z.string().datetime(),
});
export type Campaign = z.infer<typeof Campaign>;

export const CampaignRequest = Campaign.omit({ id: true, created_at: true });

export const Slot = z.object({
  id: z.string(),
  campaign_id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  intended_format: FormatCode,
  title_id: z.string().nullable(),
  recipe_id: z.string().nullable(),
  promo_id: z.string().nullable(),
  job_id: z.string().nullable(),
  status: SlotStatus,
});
export type Slot = z.infer<typeof Slot>;

export const SlotCreateRequest = z.object({
  slots: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        intended_format: FormatCode,
      }),
    )
    .min(1)
    .max(35),
});

/** Batch fill (§10): N slots, one preset, N titles → N recipes + jobs. */
export const SlotFillRequest = z.object({
  fills: z
    .array(
      z.object({
        slot_id: z.string(),
        title_id: z.string(),
        angle_id: z.string().nullable().default(null), // null → best vertical-feasible angle
      }),
    )
    .min(1),
  preset_id: z.string(),
  created_by: z.string().default("producer"),
  confirm_cost_inr: z.number().nonnegative().optional(), // must match the estimate when present
});
export type SlotFillRequest = z.infer<typeof SlotFillRequest>;

export const ScheduleRequest = z.object({
  channel: DialectCode,
  scheduled_at: z.string().datetime(),
});

/** Delivery manifest (§12 step 4, §30). */
export const DeliveryManifest = z.object({
  promo_id: z.string(),
  title: z.object({ id: z.string(), name: z.string(), name_native: z.string() }),
  claim: z.string(),
  evidence_ids: z.array(z.string()),
  dialect: DialectCode,
  dialect_pack_version: z.string(),
  prompt_versions: z.record(z.string(), z.string()),
  format: FormatCode,
  cost_inr: z.number(),
  ratios: z.array(z.string()),
  files: z.record(z.string(), z.string()),
  ai_generated: z.boolean(),
  ai_generated_by_asset_class: z.record(z.string(), z.boolean()),
  channel: DialectCode.nullable(),
  scheduled_at: z.string().datetime().nullable(),
  exported_at: z.string().datetime(),
});
export type DeliveryManifest = z.infer<typeof DeliveryManifest>;
