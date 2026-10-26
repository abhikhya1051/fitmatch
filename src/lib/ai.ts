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

const BRAND_ALIASES: Record<string, RegExp> = {
  levis: /\blevi'?s?\b|\blevi strauss\b/i,
  uniqlo: /\buniqlo\b/i,
  zara: /\bzara\b/i,
  hm: /\bh\s?&\s?m\b|\bh and m\b|\bhm\b/i,
  asos: /\basos\b/i,
};

const TIGHT = /\b(tight|snug|small|squeez|digs?)\w*/i;
const LOOSE = /\b(loose|baggy|big|roomy|gap(s|ping)?|falls? down)\w*/i;

function feelFrom(text: string): FitFeel | null {
  if (TIGHT.test(text)) return "tight";
  if (LOOSE.test(text)) return "loose";
  return null;
}

function brandIn(text: string): string | null {
  for (const [id, re] of Object.entries(BRAND_ALIASES)) if (re.test(text)) return id;
  return null;
}

/** Deterministic parser: good enough for "Levi's 32, Uniqlo 31 (a bit tight), what's my Zara size?" */
export function parseWithRules(text: string): ParsedProfile {
  const chunks = text
    .split(/[,;.\n]|\band\b|\balso\b/i)
    .map((c) => c.trim())
    .filter(Boolean);

  const knownFits: KnownFit[] = [];
  let targetBrandId: string | null = null;
  let preference: ParsedProfile["preference"] = null;

  for (const chunk of chunks) {
    const brandId = brandIn(chunk);
    const sizeMatch = chunk.match(/\b(?:eu\s*|w\s*)?(\d{2})\b/i);
    const asksAbout = /\b(what|which|at|in|for)\b.*\?|\bwhat size\b|\bshould i (get|buy)\b/i.test(chunk);

    if (/\b(prefer|like)\b.*\b(relaxed|loose|roomy)\b/i.test(chunk)) preference = "relaxed";
    else if (/\b(prefer|like)\b.*\b(snug|slim|tight|fitted)\b/i.test(chunk)) preference = "snug";

    if (brandId && sizeMatch && !asksAbout) {
      const brand = getBrand(brandId)!;
      if (findSize(brand, sizeMatch[0])) {
        knownFits.push({ brandId, size: findSize(brand, sizeMatch[0])!.label, feel: feelFrom(chunk) ?? "good" });
        continue;
      }
    }
    if (brandId && (asksAbout || !sizeMatch)) {
      targetBrandId = brandId;
      continue;
    }
    // A feel word with no brand describes the previous fit ("Levi's 32, a bit tight").
    const feel = feelFrom(chunk);
    if (!brandId && feel && knownFits.length && !/\bprefer|like\b/i.test(chunk)) {
      knownFits[knownFits.length - 1].feel = feel;
    }
  }

  return { knownFits: knownFits.slice(0, 5), targetBrandId, preference };
}

const PARSE_SYSTEM = `You extract men's jeans sizing info from a shopper's message.
Known brands (use these ids only): ${BRANDS.map((b) => `${b.id} = ${b.name} (sizes: ${b.sizes.map((s) => s.label).join(", ")})`).join("; ")}.
Return ONLY JSON: {"knownFits":[{"brandId":string,"size":string,"feel":"good"|"tight"|"loose"}],"targetBrandId":string|null,"preference":"snug"|"regular"|"relaxed"|null}
- knownFits: sizes the shopper already owns, with how they fit. "feel" is "good" unless they say tight/small or loose/big.
- targetBrandId: the brand they want a size for, if any.
- preference: only if they state how they like jeans to fit overall.
- Skip brands or sizes not in the list. Never guess a size they didn't state.`;

export async function parseProfile(text: string): Promise<AiResult<ParsedProfile>> {
  const raw = await callModel(PARSE_SYSTEM, text.slice(0, 1000));
  if (raw) {
    try {
      const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
      const parsed = ParsedProfileSchema.parse(json);
      // Drop anything that doesn't exist in our charts: the model doesn't get to invent sizes.
      parsed.knownFits = parsed.knownFits.filter((f) => {
        const b = getBrand(f.brandId);
        return b && findSize(b, f.size);
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
