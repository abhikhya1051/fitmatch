import { z } from "zod";

/**
 * Raw size chart rows. Brands publish charts in two shapes:
 *  - a single "fits waist" point per size (Levi's, ASOS, Uniqlo)
 *  - a min/max range per size (Zara, H&M)
 * We accept both and normalize to ranges in charts.ts.
 */
const PointSize = z.object({
  label: z.string(),
  alias: z.string().optional(),
  waistCm: z.number().positive(),
  hipCm: z.number().positive().optional(),
});

const RangeSize = z
  .object({
    label: z.string(),
    alias: z.string().optional(),
    waistCmMin: z.number().positive(),
    waistCmMax: z.number().positive(),
    hipCmMin: z.number().positive().optional(),
    hipCmMax: z.number().positive().optional(),
  })
  .refine((s) => s.waistCmMax > s.waistCmMin, {
    message: "waistCmMax must be greater than waistCmMin",
  });

export const RawSizeSchema = z.union([PointSize, RangeSize]);

export const BrandChartSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  category: z.literal("mens-jeans"),
  labelSystem: z.enum(["us-waist", "eu"]),
  source: z.object({
    url: z.string().url(),
    type: z.enum(["official", "third-party"]),
    retrievedOn: z.string(),
    notes: z.string().optional(),
  }),
  sizes: z.array(RawSizeSchema).min(2),
});

export type RawSize = z.infer<typeof RawSizeSchema>;
export type BrandChart = z.infer<typeof BrandChartSchema>;

/** How a size the user already owns fits them. */
export const FitFeelSchema = z.enum(["good", "tight", "loose"]);
export type FitFeel = z.infer<typeof FitFeelSchema>;

export const KnownFitSchema = z.object({
  brandId: z.string(),
  size: z.string(),
  feel: FitFeelSchema.default("good"),
});
export type KnownFit = z.infer<typeof KnownFitSchema>;

/** How the user likes jeans to sit, independent of any brand. */
export const FitPreferenceSchema = z.enum(["snug", "regular", "relaxed"]);
export type FitPreference = z.infer<typeof FitPreferenceSchema>;

export const RecommendRequestSchema = z.object({
  knownFits: z.array(KnownFitSchema).min(1).max(5),
  targetBrandId: z.string(),
  preference: FitPreferenceSchema.default("regular"),
});
export type RecommendRequest = z.infer<typeof RecommendRequestSchema>;

export const FeedbackSchema = z.object({
  recommendationId: z.string(),
  targetBrandId: z.string(),
  recommendedSize: z.string(),
  confidenceLevel: z.enum(["high", "medium", "low"]),
  confidenceScore: z.number().min(0).max(1),
  /** "would_buy" is the leading indicator; the others are post-purchase outcomes. */
  outcome: z.enum(["would_buy", "would_not_buy", "fit", "too_small", "too_big"]),
});
export type Feedback = z.infer<typeof FeedbackSchema>;
