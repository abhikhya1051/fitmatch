import { BrandChartSchema, type BrandChart, type RawSize } from "./schema";

import levis from "../../data/brands/levis.json";
import uniqlo from "../../data/brands/uniqlo.json";
import zara from "../../data/brands/zara.json";
import hm from "../../data/brands/hm.json";
import asos from "../../data/brands/asos.json";

/** A size with a body-waist range, the only shape the engine works with. */
export interface NormalizedSize {
  label: string;
  alias?: string;
  waistMin: number;
  waistMax: number;
  /** true when the range was derived from a single published point. */
  derived: boolean;
}

export interface NormalizedBrand {
  id: string;
  name: string;
  labelSystem: BrandChart["labelSystem"];
  source: BrandChart["source"];
  sizes: NormalizedSize[];
}

const isPoint = (s: RawSize): s is Extract<RawSize, { waistCm: number }> =>
  "waistCm" in s;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Point charts ("size 32 fits an 81.3 cm waist") are turned into ranges by
 * splitting the difference with each neighbour. The smallest and largest
 * sizes extend by half the gap to their only neighbour.
 */
export function normalizeChart(raw: BrandChart): NormalizedBrand {
  const chart = BrandChartSchema.parse(raw);

  const center = (s: RawSize) =>
    isPoint(s) ? s.waistCm : (s.waistCmMin + s.waistCmMax) / 2;
  const sorted = [...chart.sizes].sort((a, b) => center(a) - center(b));

  const sizes = sorted.map((s, i): NormalizedSize => {
    if (!isPoint(s)) {
      return {
        label: s.label,
        alias: s.alias,
        waistMin: s.waistCmMin,
        waistMax: s.waistCmMax,
        derived: false,
      };
    }
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const c = s.waistCm;
    const lowGap = prev ? c - center(prev) : next ? center(next) - c : 2.5;
    const highGap = next ? center(next) - c : lowGap;
    return {
      label: s.label,
      alias: s.alias,
      waistMin: round1(c - lowGap / 2),
      waistMax: round1(c + highGap / 2),
      derived: true,
    };
  });

  return {
    id: chart.id,
    name: chart.name,
    labelSystem: chart.labelSystem,
    source: chart.source,
    sizes,
  };
}

const RAW_CHARTS = [levis, uniqlo, zara, hm, asos] as BrandChart[];

export const BRANDS: NormalizedBrand[] = RAW_CHARTS.map(normalizeChart).sort(
  (a, b) => a.name.localeCompare(b.name),
);

export function getBrand(id: string): NormalizedBrand | undefined {
  return BRANDS.find((b) => b.id === id);
}

export function findSize(
  brand: NormalizedBrand,
  label: string,
): NormalizedSize | undefined {
  const wanted = label.trim().toLowerCase().replace(/^(eu|us|w)\s*/, "");
  return brand.sizes.find(
    (s) =>
      s.label.toLowerCase() === wanted ||
      s.alias?.toLowerCase().replace(/^us\s*/, "") === wanted,
  );
}

export const cmToIn = (cm: number) => Math.round((cm / 2.54) * 10) / 10;
