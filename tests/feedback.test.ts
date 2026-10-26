import { describe, expect, it } from "vitest";
import { calibrate, type StoredFeedback } from "../src/lib/feedback";

const row = (level: StoredFeedback["confidenceLevel"], outcome: StoredFeedback["outcome"], id: string): StoredFeedback => ({
  recommendationId: id,
  targetBrandId: "zara",
  recommendedSize: "48",
  confidenceLevel: level,
  confidenceScore: level === "high" ? 0.8 : level === "medium" ? 0.55 : 0.3,
  outcome,
  at: "2026-10-26T00:00:00Z",
});

describe("calibration", () => {
  it("reports not-yet-known with no purchases", () => {
    expect(calibrate([row("high", "would_buy", "a")]).calibrated).toBeNull();
  });

  it("says calibrated when high-confidence fits beat low-confidence fits", () => {
    const report = calibrate([
      row("high", "fit", "a"),
      row("high", "fit", "b"),
      row("high", "too_small", "c"),
      row("low", "fit", "d"),
      row("low", "too_big", "e"),
      row("low", "too_small", "f"),
    ]);
    expect(report.buckets[0].fitRate).toBeCloseTo(0.67, 2);
    expect(report.buckets[2].fitRate).toBeCloseTo(0.33, 2);
    expect(report.calibrated).toBe(true);
  });

  it("flags a confidence score that isn't predicting fit", () => {
    const report = calibrate([row("high", "too_small", "a"), row("low", "fit", "b")]);
    expect(report.calibrated).toBe(false);
  });

  it("separates purchase intent from purchase outcomes", () => {
    const report = calibrate([row("medium", "would_buy", "a"), row("medium", "would_not_buy", "b"), row("medium", "fit", "a")]);
    expect(report.buckets[1]).toEqual(
      expect.objectContaining({ recommendations: 2, wouldBuyRate: 0.5, purchases: 1, fitRate: 1 }),
    );
  });
});
