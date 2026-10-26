import { describe, expect, it } from "vitest";
import { BRANDS, findSize, getBrand, normalizeChart } from "../src/lib/charts";
import {
  estimateWaist,
  gatherEvidence,
  impliedWaist,
  recommend,
  SizingError,
} from "../src/lib/engine";
import type { BrandChart } from "../src/lib/schema";

describe("chart normalization", () => {
  it("loads every brand chart and validates it", () => {
    expect(BRANDS.map((b) => b.id).sort()).toEqual(["asos", "hm", "levis", "uniqlo", "zara"]);
  });

  it("turns point charts into contiguous ranges split at midpoints", () => {
    const levis = getBrand("levis")!;
    const s31 = findSize(levis, "31")!;
    const s32 = findSize(levis, "32")!;
    expect(s31.waistMax).toBe(s32.waistMin);
    expect(s32.waistMin).toBeCloseTo((78.7 + 81.3) / 2, 1);
    expect(s32.derived).toBe(true);
  });

  it("keeps published ranges as-is, including gaps", () => {
    const zara = getBrand("zara")!;
    expect(findSize(zara, "50")!.waistMax).toBe(88);
    expect(findSize(zara, "52")!.waistMin).toBe(89);
  });

  it("rejects malformed charts", () => {
    const bad = {
      id: "bad",
      name: "Bad",
      category: "mens-jeans",
      labelSystem: "us-waist",
      source: { url: "https://example.com", type: "official", retrievedOn: "2026-10-26" },
      sizes: [{ label: "30", waistCmMin: 80, waistCmMax: 76 }, { label: "32", waistCm: 81 }],
    } as unknown as BrandChart;
    expect(() => normalizeChart(bad)).toThrow();
  });

  it("finds sizes by label or alias", () => {
    const zara = getBrand("zara")!;
    expect(findSize(zara, "48")!.label).toBe("48");
    expect(findSize(zara, "EU 48")!.label).toBe("48");
    expect(findSize(zara, "32")!.label).toBe("48"); // via "US 32" alias
  });
});

describe("evidence and estimation", () => {
  const levis32 = findSize(getBrand("levis")!, "32")!;

  it("a good fit implies the size's own range", () => {
    expect(impliedWaist(levis32, "good")).toEqual({ low: levis32.waistMin, high: levis32.waistMax });
  });

  it("tight shifts the estimate up and loose shifts it down", () => {
    const good = impliedWaist(levis32, "good");
    expect(impliedWaist(levis32, "tight").low).toBeGreaterThan(good.low);
    expect(impliedWaist(levis32, "tight").high).toBeGreaterThan(good.high);
    expect(impliedWaist(levis32, "loose").high).toBeLessThan(good.high);
  });

  it("intersects agreeing references", () => {
    const ev = gatherEvidence([
      { brandId: "levis", size: "32", feel: "good" },
      { brandId: "uniqlo", size: "32", feel: "good" },
    ]);
    const est = estimateWaist(ev);
    expect(est.agreement).toBe("agree");
    expect(est.interval.low).toBeCloseTo(80.5, 1);
    expect(est.interval.high).toBeCloseTo(82.6, 1);
  });

  it("sets aside a single outlier when 3+ references are given", () => {
    const ev = gatherEvidence([
      { brandId: "levis", size: "30", feel: "good" },
      { brandId: "asos", size: "30", feel: "good" },
      { brandId: "hm", size: "34", feel: "good" },
    ]);
    const est = estimateWaist(ev);
    expect(est.agreement).toBe("set-aside");
    expect(est.setAside?.brandId).toBe("hm");
  });

  it("falls back to a wide band when two references conflict", () => {
    const ev = gatherEvidence([
      { brandId: "levis", size: "30", feel: "good" },
      { brandId: "levis", size: "36", feel: "good" },
    ]);
    const est = estimateWaist(ev);
    expect(est.agreement).toBe("conflict");
    expect(est.interval.high - est.interval.low).toBeGreaterThan(10);
  });

  it("explains unknown brands and sizes", () => {
    expect(() => gatherEvidence([{ brandId: "nope", size: "32", feel: "good" }])).toThrow(SizingError);
    expect(() => gatherEvidence([{ brandId: "levis", size: "37", feel: "good" }])).toThrow(/no size "37"/);
  });
});

describe("recommendations", () => {
  it("maps a Levi's 32 to Zara EU 48", () => {
    const r = recommend({
      knownFits: [{ brandId: "levis", size: "32", feel: "good" }],
      targetBrandId: "zara",
      preference: "regular",
    });
    expect(r.size).toBe("48");
    expect(r.alias).toBe("US 32");
  });

  it("catches vanity sizing: a Levi's 32 is an H&M 31", () => {
    const r = recommend({
      knownFits: [{ brandId: "levis", size: "32", feel: "good" }],
      targetBrandId: "hm",
      preference: "regular",
    });
    expect(r.size).toBe("31");
    expect(r.reasons.join(" ")).toMatch(/Same label doesn't mean same fit/);
  });

  it("is most confident when several agreeing references hit an official chart", () => {
    const one = recommend({
      knownFits: [{ brandId: "levis", size: "32", feel: "good" }],
      targetBrandId: "asos",
      preference: "regular",
    });
    const three = recommend({
      knownFits: [
        { brandId: "levis", size: "32", feel: "good" },
        { brandId: "uniqlo", size: "32", feel: "good" },
        { brandId: "asos", size: "32", feel: "good" },
      ],
      targetBrandId: "levis",
      preference: "regular",
    });
    expect(three.confidence.score).toBeGreaterThan(one.confidence.score);
    expect(three.confidence.level).toBe("high");
  });

  it("drops confidence when references conflict", () => {
    const r = recommend({
      knownFits: [
        { brandId: "levis", size: "30", feel: "good" },
        { brandId: "levis", size: "36", feel: "good" },
      ],
      targetBrandId: "uniqlo",
      preference: "regular",
    });
    expect(r.confidence.level).toBe("low");
    expect(r.warnings.join(" ")).toMatch(/different waist sizes/);
  });

  it("relaxed preference never picks a smaller size than regular", () => {
    for (const brand of BRANDS) {
      for (const size of ["29", "31", "33", "36"]) {
        if (!findSize(getBrand("levis")!, size)) continue;
        const base = { knownFits: [{ brandId: "levis", size, feel: "good" as const }], targetBrandId: brand.id };
        const reg = recommend({ ...base, preference: "regular" });
        const rel = recommend({ ...base, preference: "relaxed" });
        const snug = recommend({ ...base, preference: "snug" });
        const idx = (label: string) => brand.sizes.findIndex((s) => s.label === label);
        expect(idx(rel.size)).toBeGreaterThanOrEqual(idx(reg.size));
        expect(idx(snug.size)).toBeLessThanOrEqual(idx(reg.size));
      }
    }
  });

  it("offers the neighbouring size when the target sits near an edge", () => {
    const r = recommend({
      knownFits: [{ brandId: "levis", size: "32", feel: "good" }],
      targetBrandId: "hm",
      preference: "regular",
    });
    expect(r.alternate).toEqual(expect.objectContaining({ size: "30", direction: "down" }));
  });

  it("caps confidence when the user is outside the target chart", () => {
    const r = recommend({
      knownFits: [{ brandId: "levis", size: "42", feel: "tight" }],
      targetBrandId: "zara",
      preference: "relaxed",
    });
    expect(r.confidence.level).toBe("low");
    expect(r.warnings.join(" ")).toMatch(/outside Zara's published range/);
  });

  it("returns a size for every brand/size combination without throwing", () => {
    for (const ref of BRANDS) {
      for (const s of ref.sizes) {
        for (const target of BRANDS) {
          const r = recommend({
            knownFits: [{ brandId: ref.id, size: s.label, feel: "good" }],
            targetBrandId: target.id,
            preference: "regular",
          });
          expect(r.confidence.score).toBeGreaterThanOrEqual(0);
          expect(r.confidence.score).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
