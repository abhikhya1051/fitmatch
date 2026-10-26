# Decision log

Product and technical decisions, the options considered, and why. Newest last.

---

### D1. The model doesn't pick the size
**Date:** 2026-10-26
**Decision:** Size charts are structured data; matching is deterministic math. An LLM is used only to parse free text and to rephrase the explanation.
**Options considered:**
1. Ask an LLM "I'm a 32 in Levi's, what am I in Zara?" (fastest to build)
2. Deterministic engine with the LLM for the fuzzy edges (chosen)

**Why:** Option 1 answers confidently whether or not it knows the chart, and its answers can't be audited, tested, or calibrated. A sizing tool lives or dies on trust; one confident wrong answer costs a return and the user. Option 2 gives the same "AI" experience for the parts where language matters while keeping the answer reproducible. It also means 31 unit tests can pin the behaviour down.
**Trade-off:** Every brand chart must be curated by hand, which limits how fast we add brands.

---

### D2. Men's jeans first, waist only
**Date:** 2026-10-26
**Decision:** v1 covers men's jeans and uses waist as the only matching signal.
**Why:** Numeric waist labels make the problem legible ("same label, different fit") and the math simple enough to validate quickly. Women's sizing is a bigger opportunity but mixes numeric, alpha, and petite systems. Validate the method on the easier case first.
**Trade-off:** Ignores hip/seat, rise, and inseam. Hip data is stored where available so it can become a second signal in v2.

---

### D3. "Tight" and "loose" are inputs, not just "fits"
**Date:** 2026-10-26
**Decision:** Each known fit carries a feel: too tight / fits well / too loose. Tight shifts the implied waist up by half a size; loose shifts it down.
**Why:** Most people don't own jeans that fit perfectly, and "my Levi's 32 are a bit tight" is more information than "I'm a Levi's 32". It's also what people naturally say.

---

### D4. Confidence comes from the data, and is measured against outcomes
**Date:** 2026-10-26
**Decision:** Confidence is a product of five factors (coverage, margin, evidence, consistency, source), mapped to high / medium / low. Feedback is collected specifically so we can check that high-confidence picks fit more often (calibration).
**Options considered:** no confidence at all; an LLM-stated confidence; a computed score (chosen).
**Why:** A confidence label is a promise. Computing it from the inputs makes it explainable ("100% of your estimated waist falls inside H&M 31; you're near the edge"), and the calibration report makes it falsifiable.
**Open:** The weights are reasoned, not fitted. Revisit after 50+ purchase outcomes.

---

### D5. When references disagree, set aside one outlier, then fall back
**Date:** 2026-10-26
**Decision:** If all known fits overlap, use the overlap. With 3+ fits, if dropping the single most out-of-line fit makes the rest agree, use that and tell the user which one we ignored. Otherwise use a wide band around the median and lower confidence.
**Why:** Conflicting fits are common (a mislabelled pair, an unusual cut). Silently averaging them hides the problem; refusing to answer is unhelpful. Naming the outlier ("We set aside your H&M 34") gives the user something to act on.

---

### D6. Feedback in a local file for v1
**Date:** 2026-10-26
**Decision:** Feedback is appended to `.data/feedback.jsonl`.
**Why:** Zero setup for a portfolio project and the first handful of testers on a self-hosted instance.
**Consequence:** This won't persist on serverless hosts with read-only filesystems; the API returns 503 there. Moving to Supabase is R12 in the PRD and must happen before sharing a public link.

---

### D7. The LLM explanation has a faithfulness check
**Date:** 2026-10-26
**Decision:** A model-written explanation is only shown if it names the recommended size and doesn't mention any other size of that brand except ones the engine produced. Otherwise the rule-written explanation is shown. The UI says which one you're seeing.
**Why:** The explanation is the most persuasive text on the page. If it ever said "go for a 33" while the big number says 31, the product would be actively harmful. A cheap, deterministic check removes that failure mode.

---

### D8. Third-party chart data is allowed, but labelled
**Date:** 2026-10-26
**Decision:** Levi's and ASOS charts come from the brands' own size guides. Uniqlo, Zara, and H&M come from third-party compilations because the brands publish charts per product or behind dynamic pages. Each chart records its source and date; the UI warns when a target brand's chart is third-party, and the confidence score is slightly lower.
**Why:** Waiting for perfect official data would block validation. Being transparent about the source keeps trust intact.
**Next step:** Verify each third-party chart against 2–3 live product pages during research.
