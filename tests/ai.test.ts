import { describe, expect, it } from "vitest";
import { explain, isFaithful, parseProfile, parseWithRules } from "../src/lib/ai";
import { recommend } from "../src/lib/engine";

describe("rule-based parser", () => {
  it("reads brands, sizes and the target brand", () => {
    const p = parseWithRules("I wear a 32 in Levi's and a 31 at Uniqlo. What size should I get at Zara?");
    expect(p.knownFits).toEqual([
      { brandId: "levis", size: "32", feel: "good" },
      { brandId: "uniqlo", size: "31", feel: "good" },
    ]);
    expect(p.targetBrandId).toBe("zara");
  });

  it("attaches a trailing feel to the previous fit", () => {
    const p = parseWithRules("Levi's 32, a little tight. H&M 33 is perfect");
    expect(p.knownFits[0]).toEqual({ brandId: "levis", size: "32", feel: "tight" });
    expect(p.knownFits[1]).toEqual({ brandId: "hm", size: "33", feel: "good" });
  });

  it("picks up a stated fit preference", () => {
    expect(parseWithRules("ASOS 30. I prefer a relaxed fit").preference).toBe("relaxed");
  });

  it("ignores sizes a brand doesn't make", () => {
    expect(parseWithRules("Levi's 37").knownFits).toEqual([]);
  });
});

describe("AI layer without an API key", () => {
  it("falls back to rules", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const parsed = await parseProfile("Uniqlo 30. what's my zara size?");
    expect(parsed.via).toBe("rules");
    const rec = recommend({ knownFits: parsed.value.knownFits, targetBrandId: "zara", preference: "regular" });
    const ex = await explain(rec);
    expect(ex.via).toBe("rules");
    expect(ex.value).toContain(rec.size);
  });
});

describe("explanation guardrail", () => {
  const rec = recommend({
    knownFits: [{ brandId: "levis", size: "32", feel: "good" }],
    targetBrandId: "hm",
    preference: "regular",
  });

  it("accepts text that sticks to the engine's sizes", () => {
    expect(isFaithful("Go with H&M 31. If you like it close, H&M 30 works too.", rec)).toBe(true);
  });

  it("rejects text that names a different size", () => {
    expect(isFaithful("We'd suggest H&M 33, though H&M 31 could work.", rec)).toBe(false);
  });

  it("rejects text that omits the recommended size", () => {
    expect(isFaithful("H&M runs small, so size up.", rec)).toBe(false);
  });
});

describe("voice-style transcripts", () => {
  it("handles the unpunctuated example sentence", () => {
    const p = parseWithRules(
      "i have levis 32 and zara 31 what size at H and M I am looking for relaxed fit",
    );
    expect(p.knownFits).toEqual([{ brandId: "levis", size: "32", feel: "good" }]);
    expect(p.targetBrandId).toBe("hm");
    expect(p.preference).toBe("relaxed");
    expect(p.skipped[0]).toMatch(/Zara uses EU sizes \(44–54\)/);
  });

  it("reads spelled-out numbers and EU sizes", () => {
    const p = parseWithRules("levis thirty two a bit tight and zara forty eight which size at uniqlo");
    expect(p.knownFits).toEqual([
      { brandId: "levis", size: "32", feel: "tight" },
      { brandId: "zara", size: "48", feel: "good" },
    ]);
    expect(p.targetBrandId).toBe("uniqlo");
  });

  it("reads sizes said before the brand", () => {
    const p = parseWithRules("I wear a 30 at asos and a 31 in uniqlo what should I get at levis");
    expect(p.knownFits.map((f) => `${f.brandId} ${f.size}`)).toEqual(["asos 30", "uniqlo 31"]);
    expect(p.targetBrandId).toBe("levis");
  });

  it("doesn't treat the fit preference as how a pair fits", () => {
    const p = parseWithRules("H&M 32 and I like a snug fit what size at zara");
    expect(p.knownFits).toEqual([{ brandId: "hm", size: "32", feel: "good" }]);
    expect(p.preference).toBe("snug");
  });
});
