# FitMatch PRD: cross-brand jeans size translator (v1)

**Status:** v1 built, entering user validation
**Owner:** _you_
**Last updated:** 2026-10-26

---

## 1. Problem

Jeans sizes look standardized but aren't. A "32" is a label, not a measurement: Levi's cuts its 32 for an ~81 cm waist, while the H&M chart we use puts its 32 at 84–87 cm. Zara skips US numbers entirely and labels men's jeans in EU sizes (44–54).

So a shopper who knows exactly what fits them at one brand still has to guess at another. The guess usually means one of three outcomes:

- **Buy two sizes and return one.** Costs the shopper time and the retailer margin.
- **Buy the wrong size and keep it.** A bad experience that lowers trust in the brand.
- **Don't buy.** The brand loses the sale.

Fit and size are widely reported as the leading reason clothing bought online is returned. **That is a hypothesis we will validate ourselves** in user research (Section 9) rather than lean on secondhand stats.

## 2. Target user

**Primary:** Men who buy jeans online across 2+ brands and already own at least one pair that fits well.

**Why this segment first:**
- Men's jeans use a numeric waist label, which makes the problem easy to explain and the math tractable.
- The pain is real despite the "simple" sizing, which makes for a sharp demo ("your Levi's 32 is an H&M 31").
- Women's sizing (0–16, 24–34, alpha, petite) is more painful but far more complex. It's the v2 bet once the method is validated.

**Not for (yet):** people who don't own a pair that fits, tops/dresses, kids, shoes.

## 3. Jobs to be done

> When I'm buying jeans from a brand I haven't worn before, I want to know which size to order based on jeans that already fit me, so I can order once and not deal with a return.

Secondary: *"…and I want to know how sure I should be,"* so I can decide whether to order one size or two.

## 4. Goals and non-goals

### Goals (v1)
1. Recommend a size at a target brand from 1–5 known fits.
2. Show a confidence level that is **honest**: high-confidence picks should fit more often than low-confidence ones.
3. Explain *why* in plain English, including when you're between sizes.
4. Collect fit feedback so the confidence score can be checked against reality.

### Non-goals (v1)
- Accounts, saved profiles, or history
- Browser extension or retailer integrations
- Scraping size charts at scale (charts are curated by hand)
- Body scanning, photos, or height/weight models
- Per-style charts (e.g. Levi's 511 vs 501). Brand-level charts only.
- Inseam / length recommendations (waist only)

## 5. Solution overview

The user enters jeans they own (brand, size, and how they fit: too tight / fits well / too loose), picks a target brand and a fit preference (snug / regular / relaxed), and gets:

- **A size** (with the US equivalent for EU-labelled brands)
- **A confidence level** (high / medium / low) and a 0–100 score
- **A plain-English explanation**, including "same label doesn't mean same fit" when relevant
- **A between-sizes suggestion** when they land near a size boundary
- **Their size at every supported brand**
- **Feedback buttons:** "Would you buy this size?" and "Already bought it? It fit / Too small / Too big"

They can also describe their jeans in free text ("Levi's 32 but a bit tight, Uniqlo 33 fits great") or say it out loud ("I have Levi's 32 and Zara 48, what size at H&M? I'm looking for a relaxed fit"), and the form fills itself in.

### Where AI sits (and where it doesn't)

| Job | Approach | Why |
|---|---|---|
| Size charts | Curated JSON, schema-validated | Source of truth must be auditable |
| Estimating your waist | Deterministic interval math | Reproducible and testable |
| Picking the size | Deterministic | An LLM guessing sizes is exactly the failure mode we're avoiding |
| Confidence | Computed from the data, not the model | Has to be checkable against outcomes |
| Free-text and voice input | Browser speech-to-text, then LLM parse (schema-validated) with rule fallback | Fuzzy input is what models are good at |
| Explanation | LLM rewrite of computed reasons, guarded | Friendlier copy, but can't change the facts |

See `decision-log.md` (D1, D4) for the reasoning.

## 6. Requirements

| # | Requirement | Priority | Status |
|---|---|---|---|
| R1 | Support 5 brands for men's jeans with sourced charts | P0 | ✅ Levi's, Uniqlo, Zara, H&M, ASOS |
| R2 | Accept 1–5 known fits with a tight / good / loose signal | P0 | ✅ |
| R3 | Return size + confidence level + score | P0 | ✅ |
| R4 | Explain the recommendation in plain English | P0 | ✅ |
| R5 | Flag between-sizes cases and suggest the neighbour | P0 | ✅ |
| R6 | Detect and set aside an inconsistent reference fit | P1 | ✅ |
| R7 | Free-text input that fills the form | P1 | ✅ (works without an API key via rules) |
| R8 | "Your size everywhere" table | P1 | ✅ |
| R9 | Collect purchase-intent and post-purchase feedback | P0 | ✅ |
| R10 | Calibration report from feedback | P1 | ✅ `npm run calibration` |
| R11 | Show chart source and warn on third-party data | P1 | ✅ |
| R12 | Durable hosted feedback storage | P1 | ⏳ Local file today; Supabase before public launch |
| R13 | Voice input: speak your sizes, target brand, and fit preference in one sentence | P2 | ✅ Chrome, Edge, Safari (see D9) |

## 7. Success metrics

| Type | Metric | Target (first 50 testers) | How |
|---|---|---|---|
| **North star** | Post-purchase fit rate | ≥ 80% "It fit" | Feedback buttons |
| Leading | Purchase intent | ≥ 70% "Yes, I'd buy this size" | Feedback buttons |
| **Trust** | Calibration: fit rate for *high* > *medium* > *low* | Monotonic, with ≥ 15 pt gap high vs low | `npm run calibration` |
| Quality | Share of recommendations that are *low* confidence | < 20% | Server logs |
| Guardrail | LLM explanations rejected by the faithfulness check | < 5% | `explanationVia` field |

**Why calibration is a first-class metric:** a confidence label that doesn't predict outcomes is worse than no label, because it teaches users to trust the wrong recommendations. If high-confidence picks don't fit more often, the score weights get revisited before anything else.

## 8. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Third-party chart data is wrong or stale | Medium | Source + date stored per chart; UI warns on third-party data; verify against brand product pages during research |
| Charts differ by style (slim vs relaxed cuts) | High | Out of scope for v1; "between sizes" guidance; per-style charts are the top v2 candidate if feedback shows misses cluster by style |
| Body charts ≠ how people actually wear jeans (low rise, stretch) | Medium | Tight/loose signal on known fits captures real-world wear, not just the chart |
| LLM explanation contradicts the engine | Low | Faithfulness check rejects any text naming a different size; falls back to rule text |
| Too few testers to measure calibration | High | Recruit from friends + one Reddit community; also log purchase intent as a faster proxy |

## 9. Validation plan

**Before more building:**
1. **Survey (15–20 people):** how often do you return jeans for size? Which brands do you buy? Do you know your size at more than one brand?
2. **Concierge test (5 people):** answer their "what's my size at X?" question by hand using the same charts. Did the method's answer match what they'd have bought?

**With the product:**
3. Share with 20–50 testers. Track intent, then follow up two weeks later for purchase outcomes.
4. Run the calibration report. Review every "too small"/"too big" by hand for patterns (brand? style? stretch fabric?).

**Decision rule after 50 testers:**
- Fit rate ≥ 80% and calibrated → expand brands, start women's sizing research.
- Fit rate < 80% and misses cluster by style → build per-style charts.
- Confidence not calibrated → re-weight confidence before adding scope.

## 10. Roadmap

| Phase | Scope |
|---|---|
| **v1 (now)** | Men's jeans, 5 brands, waist only, local feedback |
| v1.1 | Hosted feedback (Supabase), +5 brands, verify third-party charts |
| v2 | Per-style charts for top brands; inseam/length; hip as a second signal |
| v3 | Women's jeans (numeric + alpha + petite), the bigger opportunity |
| Later | Browser extension that shows your size on the product page |

## 11. Open questions

- Do people actually use voice, or is it a demo feature? Track the share of recommendations that start from the mic.
- Do users trust a number more with or without seeing the underlying chart?
- Is "medium confidence" actionable, or does it just cause anxiety? Would "order both and return one" guidance be more useful?
- How much does fabric stretch shift the right answer, and can we capture it cheaply (a "stretch denim?" toggle)?
