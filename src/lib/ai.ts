import { z } from "zod";
import { BRANDS, findSize, getBrand } from "./charts";
import type { Recommendation } from "./engine";
import { FitPreferenceSchema, KnownFitSchema, type FitFeel, type KnownFit } from "./schema";

/**
 * The AI layer handles the two fuzzy jobs and nothing else:
 *   1. parse   - free text ("32 in Levi's but a bit tight") -> structured fits
 *   2. explain - deterministic reasons -> one friendly paragraph
 *
 * Both have a rule-based fallback, so the product works with no API key, and
 * both outputs are validated before use. The model never picks the size.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5";

export const ParsedProfileSchema = z.object({
  knownFits: z.array(KnownFitSchema).max(5),
  targetBrandId: z.string().nullable().default(null),
  preference: FitPreferenceSchema.nullable().default(null),
  /** Things we heard but couldn't use, phrased for the user ("Zara uses EU sizes…"). */
  skipped: z.array(z.string()).default([]),
});
export type ParsedProfile = z.infer<typeof ParsedProfileSchema>;

export interface AiResult<T> {
  value: T;
  via: "model" | "rules";
}

async function callModel(system: string, user: string): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    return data.content?.find((c) => c.type === "text")?.text ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const BRAND_PATTERNS: [string, string][] = [
  ["levis", String.raw`levi'?s?|levi strauss`],
  ["uniqlo", String.raw`uniqlo|uni qlo`],
  ["zara", String.raw`zara`],
  ["hm", String.raw`h\s?&\s?m|h and m|h n m|h & m|hm`],
  ["asos", String.raw`asos|a sauce`],
];
const BRAND_RE = new RegExp(
  BRAND_PATTERNS.map(([id, p]) => `(?<${id}>\\b(?:${p})\\b)`).join("|"),
  "gi",
);

const TIGHT = /\b(tight|snug|small|squeez\w*|digs?)\b/i;
const LOOSE = /\b(loose|baggy|big|roomy|gap(?:s|ping)?|falls? down)\b/i;

function feelFrom(text: string): FitFeel | null {
  if (TIGHT.test(text)) return "tight";
  if (LOOSE.test(text)) return "loose";
  return null;
}

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

/**
 * Speech-to-text often gives "thirty two" or "thirty-two" instead of "32".
 * Convert the waist-size range of number words to digits.
 */
export function numberWordsToDigits(text: string): string {
  return text.replace(
    /\b(twenty|thirty|forty|fifty)(?:[\s-](one|two|three|four|five|six|seven|eight|nine))?\b/gi,
    (_, t: string, u?: string) => String(TENS[t.toLowerCase()] + (u ? UNITS[u.toLowerCase()] : 0)),
  );
}

/** Words right before a brand that mean "this is the brand I'm shopping at". */
const TARGET_CUE =
  /(?:what|which)(?:'s| is)?(?: my)?(?: size)?(?: would i be| am i| should i (?:get|buy|order))?\s+(?:at|in|for|from|with)\s*$|\bsize\s+(?:at|in|for|with)\s*$|\b(?:get|buy|order|shop(?:ping)?|buying|ordering)\s+(?:at|from|in|on)\s*$|\b(?:at|in|for)\s*$/i;
const QUESTION = /\b(what|which|how)\b|\?|\bshould i\b|\bsize at\b/i;

const PREFERENCE_RE =
  /\b(?:prefer|like|want|looking for|going for|after|need)\b[^.?!]{0,20}?\b(relaxed|loose|roomy|baggy|regular|normal|snug|slim|fitted|tight|skinny)\b|\b(relaxed|regular|snug|slim)\s+fit\b/gi;

function preferenceFrom(word: string): ParsedProfile["preference"] {
  const w = word.toLowerCase();
  if (["relaxed", "loose", "roomy", "baggy"].includes(w)) return "relaxed";
  if (["snug", "slim", "fitted", "tight", "skinny"].includes(w)) return "snug";
  return "regular";
}

interface Mention {
  brandId: string;
  start: number;
  end: number;
}

/**
 * Deterministic parser. Scans for brand mentions, then reads the words around
 * each one, so it copes with unpunctuated voice transcripts like
 * "i have levis 32 and zara 48 what size at h and m i want a relaxed fit".
 */
export function parseWithRules(input: string): ParsedProfile {
  let text = numberWordsToDigits(input).replace(/\s+/g, " ");
  const skipped: string[] = [];

  // 1. Fit preference ("looking for a relaxed fit"). Blank it out afterwards so
  //    "relaxed"/"tight" here isn't mistaken for how a specific pair fits.
  let preference: ParsedProfile["preference"] = null;
  text = text.replace(PREFERENCE_RE, (m, a?: string, b?: string) => {
    preference = preferenceFrom(a ?? b ?? "");
    return " ".repeat(m.length);
  });

  // 2. Brand mentions, in order.
  const mentions: Mention[] = [];
  for (const m of text.matchAll(BRAND_RE)) {
    const brandId = Object.entries(m.groups ?? {}).find(([, v]) => v)?.[0];
    if (brandId) mentions.push({ brandId, start: m.index!, end: m.index! + m[0].length });
  }

  const knownFits: KnownFit[] = [];
  let targetBrandId: string | null = null;

  mentions.forEach((m, i) => {
    const prevEnd = i > 0 ? mentions[i - 1].end : 0;
    const nextStart = i < mentions.length - 1 ? mentions[i + 1].start : text.length;
    const before = text.slice(prevEnd, m.start);
    let after = text.slice(m.end, nextStart);
    // Stop reading "after" at the start of a question about another brand.
    const q = after.search(/\b(what|which)\b|\?/i);
    if (q >= 0) after = after.slice(0, q);

    const brand = getBrand(m.brandId)!;
    const sizeAfter = after.match(/^\D{0,12}?\b(?:eu\s*|us\s*|w\s*|size\s*|in\s*(?:a\s*)?)?(\d{2})\b/i);
    const sizeBefore = before.match(/\b(\d{2})\s*(?:in|at|from|with|for)\s*(?:my\s*)?$/i);
    // "a 32 at Levi's" beats a number that follows, which may belong to the next brand.
    const raw = sizeBefore?.[1] ?? sizeAfter?.[1];

    const isTarget = !raw && (TARGET_CUE.test(before) || QUESTION.test(before.slice(-40)));
    if (isTarget || (!raw && i === mentions.length - 1 && QUESTION.test(text))) {
      targetBrandId = m.brandId;
      return;
    }
    if (!raw) return;

    const size = findSize(brand, raw);
    if (!size) {
      skipped.push(
        brand.labelSystem === "eu"
          ? `${brand.name} uses EU sizes (${brand.sizes[0].label}–${brand.sizes[brand.sizes.length - 1].label}), so we couldn't use "${brand.name} ${raw}". Check the label for the EU number.`
          : `${brand.name} doesn't make a ${raw} in our chart (${brand.sizes[0].label}–${brand.sizes[brand.sizes.length - 1].label}).`,
      );
      return;
    }
    if (knownFits.some((f) => f.brandId === m.brandId && f.size === size.label)) return;
    knownFits.push({ brandId: m.brandId, size: size.label, feel: feelFrom(after) ?? "good" });
  });

  return { knownFits: knownFits.slice(0, 5), targetBrandId, preference, skipped };
}

const PARSE_SYSTEM = `You extract men's jeans sizing info from a shopper's message.
Known brands (use these ids only): ${BRANDS.map((b) => `${b.id} = ${b.name} (sizes: ${b.sizes.map((s) => s.label).join(", ")})`).join("; ")}.
Return ONLY JSON: {"knownFits":[{"brandId":string,"size":string,"feel":"good"|"tight"|"loose"}],"targetBrandId":string|null,"preference":"snug"|"regular"|"relaxed"|null,"skipped":string[]}
- knownFits: sizes the shopper already owns, with how they fit. "feel" is "good" unless they say tight/small or loose/big.
- targetBrandId: the brand they want a size for, if any.
- preference: only if they state how they like jeans to fit overall.
- The text may be an unpunctuated voice transcript; numbers may be spelled out.
- If a size isn't in a brand's list, leave it out of knownFits and add a short plain-English note to "skipped" (e.g. Zara uses EU sizes). Never convert or guess a size they didn't state.`;

export async function parseProfile(text: string): Promise<AiResult<ParsedProfile>> {
  const raw = await callModel(PARSE_SYSTEM, text.slice(0, 1000));
  if (raw) {
    try {
      const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      const parsed = ParsedProfileSchema.parse(json);
      // Drop anything that doesn't exist in our charts: the model doesn't get to invent sizes.
      parsed.knownFits = parsed.knownFits.filter((f) => {
        const b = getBrand(f.brandId);
        const ok = Boolean(b && findSize(b, f.size));
        if (!ok && b) parsed.skipped.push(`We couldn't find ${b.name} ${f.size} in our chart.`);
        return ok;
      });
      if (parsed.targetBrandId && !getBrand(parsed.targetBrandId)) parsed.targetBrandId = null;
      return { value: parsed, via: "model" };
    } catch {
      // fall through to rules
    }
  }
  return { value: parseWithRules(text), via: "rules" };
}

// ---------------------------------------------------------------------------
// Explaining
// ---------------------------------------------------------------------------

export function explainWithRules(rec: Recommendation): string {
  const parts = [...rec.reasons];
  if (rec.alternate) {
    parts.push(`You're near the edge of the size, so consider ${rec.alternate.size} ${rec.alternate.when}.`);
  }
  return parts.join(" ");
}

const EXPLAIN_SYSTEM = `You write a 2-3 sentence explanation of a jeans size recommendation for a shopper.
Use ONLY the facts provided. Do not change the recommended size, the confidence level, or any number.
Plain, friendly, no hype, no emojis. Mention the recommended size exactly as given.`;

/**
 * Guardrail: the rewritten text must name the recommended size and must not
 * introduce any size label the engine didn't mention. Otherwise use the rules text.
 */
export function isFaithful(text: string, rec: Recommendation): boolean {
  const brand = getBrand(rec.targetBrandId)!;
  const allowed = new Set([rec.size, rec.alternate?.size, ...rec.evidence.map((e) => e.size)].filter(Boolean));
  if (!new RegExp(`\\b${rec.size}\\b`).test(text)) return false;
  const name = brand.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentioned = brand.sizes
    .map((s) => s.label)
    .filter((l) => new RegExp(`${name}\\s+(?:EU\\s*)?${l}\\b`, "i").test(text));
  return mentioned.every((l) => allowed.has(l));
}

export async function explain(rec: Recommendation): Promise<AiResult<string>> {
  const facts = JSON.stringify({
    brand: rec.targetBrandName,
    recommendedSize: rec.size + (rec.alias ? ` (${rec.alias})` : ""),
    confidence: rec.confidence.level,
    reasons: rec.reasons,
    alternate: rec.alternate ?? null,
    warnings: rec.warnings,
  });
  const raw = await callModel(EXPLAIN_SYSTEM, facts);
  if (raw && isFaithful(raw, rec)) return { value: raw.trim(), via: "model" };
  return { value: explainWithRules(rec), via: "rules" };
}
