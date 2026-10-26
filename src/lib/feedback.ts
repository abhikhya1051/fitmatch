import { promises as fs } from "node:fs";
import path from "node:path";
import { FeedbackSchema, type Feedback } from "./schema";

/**
 * MVP storage: one JSON line per event in .data/feedback.jsonl.
 * Good enough for a few dozen testers; swap for Supabase/Postgres before
 * deploying anywhere with a read-only filesystem (see docs/decision-log.md).
 */
const FILE = path.join(process.cwd(), ".data", "feedback.jsonl");

export interface StoredFeedback extends Feedback {
  at: string;
}

export async function saveFeedback(input: unknown): Promise<StoredFeedback> {
  const fb = FeedbackSchema.parse(input);
  const row: StoredFeedback = { ...fb, at: new Date().toISOString() };
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.appendFile(FILE, JSON.stringify(row) + "\n", "utf8");
  return row;
}

export async function loadFeedback(file = FILE): Promise<StoredFeedback[]> {
  try {
    const text = await fs.readFile(/*turbopackIgnore: true*/ file, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as StoredFeedback);
  } catch {
    return [];
  }
}

export interface BucketStats {
  level: "high" | "medium" | "low";
  recommendations: number;
  wouldBuyRate: number | null;
  purchases: number;
  fitRate: number | null;
}

export interface Calibration {
  buckets: BucketStats[];
  totalEvents: number;
  /** True when high-confidence fits beat low-confidence fits, i.e. the score means something. */
  calibrated: boolean | null;
}

const rate = (num: number, den: number) => (den ? Math.round((num / den) * 100) / 100 : null);

/**
 * The metric that matters: does "high confidence" actually fit more often
 * than "low confidence"? If not, the confidence score is decoration.
 */
export function calibrate(rows: StoredFeedback[]): Calibration {
  const buckets = (["high", "medium", "low"] as const).map((level): BucketStats => {
    const inBucket = rows.filter((r) => r.confidenceLevel === level);
    const intents = inBucket.filter((r) => r.outcome === "would_buy" || r.outcome === "would_not_buy");
    const purchases = inBucket.filter((r) => ["fit", "too_small", "too_big"].includes(r.outcome));
    return {
      level,
      recommendations: new Set(inBucket.map((r) => r.recommendationId)).size,
      wouldBuyRate: rate(intents.filter((r) => r.outcome === "would_buy").length, intents.length),
      purchases: purchases.length,
      fitRate: rate(purchases.filter((r) => r.outcome === "fit").length, purchases.length),
    };
  });

  const high = buckets[0].fitRate;
  const low = buckets[2].fitRate;
  return {
    buckets,
    totalEvents: rows.length,
    calibrated: high === null || low === null ? null : high > low,
  };
}
