import {
  cmToIn,
  findSize,
  getBrand,
  type NormalizedBrand,
  type NormalizedSize,
} from "./charts";
import type { FitFeel, FitPreference, KnownFit, RecommendRequest } from "./schema";

/**
 * The sizing engine is deliberately deterministic: no model calls here.
 * Charts are the source of truth, arithmetic does the matching, and the
 * confidence score comes from how cleanly the numbers line up.
 */

export interface Interval {
  low: number;
  high: number;
}

export interface Evidence {
  brandId: string;
  brandName: string;
  size: string;
  feel: FitFeel;
  /** The body-waist range this fit implies, in cm. */
  implied: Interval;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface ConfidenceFactor {
  name: "coverage" | "margin" | "evidence" | "consistency" | "source";
  value: number;
  note: string;
}

export interface Recommendation {
  targetBrandId: string;
  targetBrandName: string;
  size: string;
  alias?: string;
  confidence: {
    level: ConfidenceLevel;
    score: number;
    factors: ConfidenceFactor[];
  };
  estimatedWaistCm: Interval & { target: number };
  /** Present when the target lands near a size boundary. */
  alternate?: { size: string; direction: "up" | "down"; when: string };
  reasons: string[];
  warnings: string[];
  evidence: Evidence[];
}

export class SizingError extends Error {}

/** Preference shifts the target waist by half an inch either way. */
const PREFERENCE_OFFSET_CM: Record<FitPreference, number> = {
  snug: -1.27,
  regular: 0,
  relaxed: 1.27,
};

/** Within this share of a size's width from an edge, we call it "between sizes". */
const BOUNDARY_SHARE = 0.2;

export const width = (i: Interval) => i.high - i.low;
export const mid = (i: Interval) => (i.low + i.high) / 2;
const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Turn "size 32 at Levi's, a bit tight" into a body-waist interval.
 * Good fit -> the size's own range. Tight -> the top half of the range and
 * half a size beyond it. Loose -> the mirror image.
 */
export function impliedWaist(size: NormalizedSize, feel: FitFeel): Interval {
  const range = { low: size.waistMin, high: size.waistMax };
  const w = width(range);
  const m = mid(range);
  switch (feel) {
    case "good":
      return range;
    case "tight":
      return { low: m, high: range.high + w / 2 };
    case "loose":
      return { low: range.low - w / 2, high: m };
  }
}

export function gatherEvidence(knownFits: KnownFit[]): Evidence[] {
  return knownFits.map((fit) => {
    const brand = getBrand(fit.brandId);
    if (!brand) throw new SizingError(`Unknown brand "${fit.brandId}"`);
    const size = findSize(brand, fit.size);
    if (!size) {
      throw new SizingError(
        `${brand.name} has no size "${fit.size}" in our chart (sizes: ${brand.sizes
          .map((s) => s.label)
          .join(", ")})`,
      );
    }
    return {
      brandId: brand.id,
      brandName: brand.name,
      size: size.label,
      feel: fit.feel,
      implied: impliedWaist(size, fit.feel),
    };
  });
}

export interface WaistEstimate {
  interval: Interval;
  /** "agree": all fits overlap. "set-aside": one outlier ignored. "conflict": no clean overlap. */
  agreement: "agree" | "set-aside" | "conflict";
  /** The reference fit we ignored, when agreement is "set-aside". */
  setAside?: Evidence;
}

const MIN_ESTIMATE_WIDTH_CM = 1;

/** Where all implied ranges overlap, or null if they don't. */
function intersect(evidence: Evidence[]): Interval | null {
  const low = Math.max(...evidence.map((e) => e.implied.low));
  const high = Math.min(...evidence.map((e) => e.implied.high));
  if (low > high) return null;
  // A sliver of overlap is still informative, but give it a minimum width so
  // a single shared edge doesn't read as false precision.
  if (high - low < MIN_ESTIMATE_WIDTH_CM) {
    const c = (low + high) / 2;
    return { low: c - MIN_ESTIMATE_WIDTH_CM / 2, high: c + MIN_ESTIMATE_WIDTH_CM / 2 };
  }
  return { low, high };
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Combine evidence:
 *  1. If every known fit agrees, the answer is where their ranges overlap.
 *  2. With 3+ fits, if dropping the single most out-of-line fit makes the rest
 *     agree, use that and tell the user which one we set aside.
 *  3. Otherwise fall back to a band around the median that spans the
 *     disagreement, and let the confidence score say so.
 */
export function estimateWaist(evidence: Evidence[]): WaistEstimate {
  const agreed = intersect(evidence);
  if (agreed) return { interval: agreed, agreement: "agree" };

  const mids = evidence.map((e) => mid(e.implied));
  const center = median(mids);

  if (evidence.length >= 3) {
    const outlier = [...evidence].sort(
      (a, b) => Math.abs(mid(b.implied) - center) - Math.abs(mid(a.implied) - center),
    )[0];
    const rest = intersect(evidence.filter((e) => e !== outlier));
    if (rest) return { interval: rest, agreement: "set-aside", setAside: outlier };
  }

  const half = Math.max(1.5, (Math.max(...mids) - Math.min(...mids)) / 2);
  return {
    interval: { low: center - half, high: center + half },
    agreement: "conflict",
  };
}

function overlap(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.high, b.high) - Math.max(a.low, b.low));
}

/** The size containing the target, or the nearest one if it falls in a gap. */
function pickSize(brand: NormalizedBrand, target: number) {
  const inside = brand.sizes.find((s) => target >= s.waistMin && target < s.waistMax);
  if (inside) return { size: inside, outOfRange: false };

  const distance = (s: NormalizedSize) =>
    target < s.waistMin ? s.waistMin - target : target - s.waistMax;
  const nearest = [...brand.sizes].sort((a, b) => distance(a) - distance(b))[0];
  const first = brand.sizes[0];
  const last = brand.sizes[brand.sizes.length - 1];
  const outOfRange =
    target < first.waistMin - width({ low: first.waistMin, high: first.waistMax }) ||
    target > last.waistMax + width({ low: last.waistMin, high: last.waistMax });
  return { size: nearest, outOfRange };
}

function levelFor(score: number): ConfidenceLevel {
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

const fmtRange = (i: Interval) =>
  `${r1(i.low)}–${r1(i.high)} cm (${cmToIn(i.low)}–${cmToIn(i.high)} in)`;

export function recommend(req: RecommendRequest): Recommendation {
  const target = getBrand(req.targetBrandId);
  if (!target) throw new SizingError(`Unknown brand "${req.targetBrandId}"`);

  const evidence = gatherEvidence(req.knownFits);
  const estimate = estimateWaist(evidence);
  const offset = PREFERENCE_OFFSET_CM[req.preference];
  const targetWaist = mid(estimate.interval) + offset;
  const shifted = {
    low: estimate.interval.low + offset,
    high: estimate.interval.high + offset,
  };

  const { size, outOfRange } = pickSize(target, targetWaist);
  const sizeRange = { low: size.waistMin, high: size.waistMax };
  const idx = target.sizes.indexOf(size);

  // --- Confidence -----------------------------------------------------------
  // coverage: how much of the user's plausible waist band the chosen size covers
  const coverage = clamp01(overlap(shifted, sizeRange) / Math.max(width(shifted), 0.5));
  // evidence: more reference fits -> tighter estimate
  const evidenceScore = [0, 0.7, 0.88, 1][Math.min(evidence.length, 3)];
  // consistency: references that disagree with each other undermine the estimate
  const consistency = { agree: 1, "set-aside": 0.8, conflict: 0.55 }[estimate.agreement];
  // source: official charts beat third-party compilations
  const officialShare =
    [...evidence.map((e) => getBrand(e.brandId)!), target].filter(
      (b) => b.source.type === "official",
    ).length /
    (evidence.length + 1);
  const source = 0.85 + 0.15 * officialShare;

  // margin: landing right on a size boundary means the neighbour is nearly as good
  const edgeBand = width(sizeRange) * BOUNDARY_SHARE;
  const nearLow = targetWaist - size.waistMin < edgeBand;
  const nearHigh = size.waistMax - targetWaist < edgeBand;
  const margin = nearLow || nearHigh ? 0.88 : 1;

  let score = Math.sqrt(coverage) * margin * evidenceScore * consistency * source;
  if (outOfRange) score = Math.min(score, 0.2);
  score = Math.round(score * 100) / 100;

  const factors: ConfidenceFactor[] = [
    {
      name: "coverage",
      value: r1(coverage * 100) / 100,
      note: `${Math.round(coverage * 100)}% of your estimated waist band falls inside ${target.name} ${size.label}`,
    },
    {
      name: "margin",
      value: margin,
      note:
        margin < 1
          ? `You sit near the edge of ${size.label}, so the next size is a close call`
          : `You sit comfortably inside ${size.label}`,
    },
    {
      name: "evidence",
      value: evidenceScore,
      note: `${evidence.length} reference fit${evidence.length === 1 ? "" : "s"}`,
    },
    {
      name: "consistency",
      value: consistency,
      note: {
        agree: "Your reference fits agree with each other",
        "set-aside": "One reference fit was out of line and set aside",
        conflict: "Your reference fits disagree, so the estimate is wider",
      }[estimate.agreement],
    },
    {
      name: "source",
      value: r1(source * 100) / 100,
      note: `${Math.round(officialShare * 100)}% of charts used are official brand charts`,
    },
  ];

  // --- Between sizes ------------------------------------------------------------
  let alternate: Recommendation["alternate"];
  if (nearHigh && idx < target.sizes.length - 1) {
    alternate = {
      size: target.sizes[idx + 1].label,
      direction: "up",
      when: "if you prefer room at the waist, or the fabric has no stretch",
    };
  } else if (nearLow && idx > 0) {
    alternate = {
      size: target.sizes[idx - 1].label,
      direction: "down",
      when: "if the style has stretch or you like a close fit",
    };
  }

  // --- Explanation ingredients ------------------------------------------------------
  const reasons = [
    `Your reference fits put your waist at about ${fmtRange(estimate.interval)}.`,
    `${target.name} ${size.label}${size.alias ? ` (${size.alias})` : ""} is cut for ${fmtRange(sizeRange)}.`,
  ];
  if (offset !== 0) {
    reasons.push(
      `You prefer a ${req.preference} fit, so we aimed ${offset > 0 ? "half an inch larger" : "half an inch smaller"}.`,
    );
  }
  const sameLabelRef = evidence.find((e) => e.size === size.label);
  const labelDiffers = evidence.find(
    (e) => e.feel === "good" && e.size !== size.label && target.labelSystem === "us-waist",
  );
  if (labelDiffers && !sameLabelRef) {
    reasons.push(
      `Same label doesn't mean same fit: your ${labelDiffers.brandName} ${labelDiffers.size} maps to ${target.name} ${size.label}.`,
    );
  }

  const warnings: string[] = [];
  if (estimate.agreement === "set-aside" && estimate.setAside) {
    const o = estimate.setAside;
    warnings.push(
      `We set aside your ${o.brandName} ${o.size}: it doesn't line up with your other fits. Double-check that size, or that style may be cut unusually.`,
    );
  } else if (estimate.agreement === "conflict") {
    warnings.push(
      "Your reference fits point to different waist sizes, so treat this as a starting point.",
    );
  }
  if (outOfRange) {
    warnings.push(`Your estimated waist is outside ${target.name}'s published range.`);
  }
  if (target.source.type === "third-party") {
    warnings.push(
      `${target.name}'s chart comes from a third-party compilation; check the product page before buying.`,
    );
  }
  return {
    targetBrandId: target.id,
    targetBrandName: target.name,
    size: size.label,
    alias: size.alias,
    confidence: { level: levelFor(score), score, factors },
    estimatedWaistCm: {
      low: r1(estimate.interval.low),
      high: r1(estimate.interval.high),
      target: r1(targetWaist),
    },
    alternate,
    reasons,
    warnings,
    evidence,
  };
}

/** Run the same profile against every brand: the "my size everywhere" view. */
export function recommendAll(
  knownFits: KnownFit[],
  preference: FitPreference,
  brandIds: string[],
): Recommendation[] {
  return brandIds.map((targetBrandId) =>
    recommend({ knownFits, targetBrandId, preference }),
  );
}
