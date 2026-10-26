import { BRANDS } from "@/lib/charts";
import SizeFinder, { type BrandOption } from "./SizeFinder";

export default function Home() {
  const brands: BrandOption[] = BRANDS.map((b) => ({
    id: b.id,
    name: b.name,
    sizes: b.sizes.map((s) => ({ label: s.label, alias: s.alias })),
    official: b.source.type === "official",
  }));

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Men's jeans · v1</p>
        <h1>
          Your size at any brand,
          <br />
          from the jeans you already own.
        </h1>
        <p className="lede">
          A 32 at one brand can be a 31 at another. Tell us what fits today and FitMatch reads each
          brand's size chart to find your size, with an honest confidence level.
        </p>
      </header>

      <SizeFinder brands={brands} />

      <footer className="footer">
        <p>
          Recommendations come from published size charts, not guesses. Charts can change and
          individual styles vary, so check the product page before you buy.
        </p>
      </footer>
    </main>
  );
}
