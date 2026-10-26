/**
 * Prints the calibration report from collected feedback.
 *   npm run calibration            # reads .data/feedback.jsonl
 *   npm run calibration -- path.jsonl
 */
import path from "node:path";
import { calibrate, loadFeedback } from "../src/lib/feedback";

const file = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const report = calibrate(await loadFeedback(file));

console.log(`\nFitMatch calibration report (${report.totalEvents} events)\n`);
console.table(
  report.buckets.map((b) => ({
    confidence: b.level,
    recommendations: b.recommendations,
    "would buy": b.wouldBuyRate === null ? "-" : `${Math.round(b.wouldBuyRate * 100)}%`,
    purchases: b.purchases,
    "fit rate": b.fitRate === null ? "-" : `${Math.round(b.fitRate * 100)}%`,
  })),
);
console.log(
  report.calibrated === null
    ? "Not enough purchases yet to judge calibration."
    : report.calibrated
      ? "High-confidence recommendations fit more often than low-confidence ones. The score is doing its job."
      : "Warning: high-confidence recommendations are NOT fitting more often. Revisit the confidence weights.",
);
