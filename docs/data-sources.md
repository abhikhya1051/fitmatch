# Size chart data sources

All charts are men's jeans **body** measurements (the waist the jeans are designed to fit), in centimetres. Retrieved 2026-10-26.

| Brand | File | Source | Type | Shape | Notes |
|---|---|---|---|---|---|
| Levi's | `data/brands/levis.json` | [levi.com size chart](https://www.levi.com/NL/en/info/sizechart) | Official | Point per size | Also includes seat (hip) |
| ASOS Design | `data/brands/asos.json` | [asos.com men's jeans guide](https://asos.com/us/discover/size-charts/men/jeans-pants/) | Official | Point per size | ASOS own-brand only |
| Uniqlo | `data/brands/uniqlo.json` | [LookSize compilation](https://www.looksize.com/brand-size-chart/uniqlo) | Third-party | Point per size | Uniqlo publishes per-product charts; verify on uniqlo.com |
| Zara | `data/brands/zara.json` | [Sizely compilation](https://www.size.ly/size-chart/zara) | Third-party | Range per size | EU labels 44–54; small gaps between some sizes |
| H&M | `data/brands/hm.json` | [Size-Charts.com compilation](https://size-charts.com/brands/hm-size-charts/hm-mens-sizes-chart-and-fitting-guide/) | Third-party | Range per size | Runs ~3 cm larger than Levi's per label |

## How point charts become ranges

Levi's says a 32 fits an 81.3 cm waist and a 31 fits 78.7 cm. We treat the boundary as the midpoint (80.0 cm), so the 32 covers 80.0–82.6 cm. The smallest and largest sizes extend by half the gap to their only neighbour. See `normalizeChart` in `src/lib/charts.ts`.

## Adding a brand

1. Create `data/brands/<id>.json` matching `BrandChartSchema` in `src/lib/schema.ts` (either `waistCm` points or `waistCmMin`/`waistCmMax` ranges).
2. Record the source URL, whether it's official, and the date.
3. Import it in `src/lib/charts.ts`.
4. `npm test` validates the schema and runs every size of every brand against every other brand.

## Known limitations

- Brand-level charts only; individual styles (slim vs relaxed) can differ.
- Waist only; inseam and hip aren't used for matching yet.
- Charts change. Re-check sources before each release.
