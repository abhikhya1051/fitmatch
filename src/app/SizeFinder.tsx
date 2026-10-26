"use client";

import { useMemo, useState } from "react";
import type { Recommendation } from "@/lib/engine";
import type { FitFeel, FitPreference, KnownFit } from "@/lib/schema";
import { useVoiceInput } from "./useVoiceInput";

export interface BrandOption {
  id: string;
  name: string;
  sizes: { label: string; alias?: string }[];
  official: boolean;
}

interface ApiResult {
  id: string;
  recommendation: Recommendation;
  explanation: string;
  explanationVia: "model" | "rules";
  everywhere: { brandId: string; brandName: string; size: string; alias?: string; level: string }[];
}

const FEELS: { value: FitFeel; label: string }[] = [
  { value: "tight", label: "Too tight" },
  { value: "good", label: "Fits well" },
  { value: "loose", label: "Too loose" },
];

const PREFERENCES: { value: FitPreference; label: string; hint: string }[] = [
  { value: "snug", label: "Snug", hint: "close at the waist" },
  { value: "regular", label: "Regular", hint: "as the brand intends" },
  { value: "relaxed", label: "Relaxed", hint: "a little room" },
];

const LEVEL_COPY: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

const sizeLabel = (size: string, alias?: string) => (alias ? `${size} (${alias})` : size);

export default function SizeFinder({ brands }: { brands: BrandOption[] }) {
  const [fits, setFits] = useState<KnownFit[]>([{ brandId: "levis", size: "32", feel: "good" }]);
  const [target, setTarget] = useState("zara");
  const [preference, setPreference] = useState<FitPreference>("regular");
  const [freeText, setFreeText] = useState("");
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"parse" | "recommend" | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null);

  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands]);

  function updateFit(i: number, patch: Partial<KnownFit>) {
    setFits((prev) =>
      prev.map((f, idx) => {
        if (idx !== i) return f;
        const next = { ...f, ...patch };
        // Keep the size valid when the brand changes.
        if (patch.brandId) {
          const sizes = brandById.get(patch.brandId)!.sizes;
          if (!sizes.some((s) => s.label === next.size)) {
            next.size = sizes[Math.floor(sizes.length / 2)].label;
          }
        }
        return next;
      }),
    );
  }

  /** Parse free text into the form. Voice input also runs the recommendation straight away. */
  async function fillFromText(text = freeText, runAfter = false) {
    if (text.trim().length < 3) return;
    setLoading("parse");
    setParseNote(null);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const nextFits: KnownFit[] = data.knownFits.length ? data.knownFits : fits;
      const nextTarget: string = data.targetBrandId ?? target;
      const nextPref: FitPreference = data.preference ?? preference;
      setFits(nextFits);
      setTarget(nextTarget);
      setPreference(nextPref);
      const notes = [
        data.knownFits.length
          ? `Filled in ${data.knownFits.length} pair${data.knownFits.length > 1 ? "s" : ""}${data.targetBrandId ? ` and ${brandById.get(data.targetBrandId)?.name} as the brand you're shopping` : ""}${data.preference ? `, ${data.preference} fit` : ""}. Check them below.`
          : "We couldn't spot a brand and size we know. Try something like \u201cLevi's 32, a bit tight\u201d.",
        ...(data.skipped ?? []),
      ];
      setParseNote(notes.join(" "));
      if (runAfter && data.knownFits.length) {
        setLoading(null);
        await findSize({ fits: nextFits, target: nextTarget, preference: nextPref });
      }
    } catch (e) {
      setParseNote(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(null);
    }
  }

  const voice = useVoiceInput({
    onInterim: (t) => setFreeText(t),
    onFinal: (t) => {
      setFreeText(t);
      void fillFromText(t, true);
    },
  });

  async function findSize(
    override?: { fits: KnownFit[]; target: string; preference: FitPreference },
  ) {
    const input = override ?? { fits, target, preference };
    setLoading("recommend");
    setError(null);
    setFeedbackSent(null);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          knownFits: input.fits,
          targetBrandId: input.target,
          preference: input.preference,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(null);
    }
  }

  async function sendFeedback(outcome: string) {
    if (!result) return;
    const rec = result.recommendation;
    setFeedbackSent(outcome);
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recommendationId: result.id,
        targetBrandId: rec.targetBrandId,
        recommendedSize: rec.size,
        confidenceLevel: rec.confidence.level,
        confidenceScore: rec.confidence.score,
        outcome,
      }),
    }).catch(() => undefined);
  }

  const rec = result?.recommendation;

  return (
    <div className="layout">
      <section className="panel" aria-labelledby="input-heading">
        <h2 id="input-heading" className="panel-title">
          <span className="step">1</span> Jeans that fit you now
        </h2>

        <div className="freetext">
          <label htmlFor="freetext" className="label">
            Describe them or say it <span className="muted">(optional)</span>
          </label>
          <div className="freetext-row">
            <input
              id="freetext"
              type="text"
              placeholder={
                voice.status === "listening"
                  ? "Listening…"
                  : "e.g. Levi's 32, a bit tight. What size at H&M? Relaxed fit."
              }
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fillFromText()}
            />
            {voice.status !== "unsupported" && (
              <button
                type="button"
                className={`btn mic ${voice.status === "listening" ? "live" : ""}`}
                onClick={voice.status === "listening" ? voice.stop : voice.start}
                disabled={loading !== null}
                aria-pressed={voice.status === "listening"}
                aria-label={voice.status === "listening" ? "Stop listening" : "Speak instead of typing"}
              >
                <MicIcon />
                <span>{voice.status === "listening" ? "Stop" : "Speak"}</span>
              </button>
            )}
            <button type="button" className="btn ghost" onClick={() => fillFromText()} disabled={loading !== null}>
              {loading === "parse" ? "Reading…" : "Fill in"}
            </button>
          </div>
          {voice.status === "listening" && (
            <p className="note listening" role="status">
              Listening. Try: “I have Levi's 32 and Zara 48, what size at H&M? I'm looking for a relaxed fit.”
            </p>
          )}
          {voice.error && (
            <p className="note warn" role="alert">
              {voice.error}
            </p>
          )}
          {parseNote && <p className="note">{parseNote}</p>}
        </div>

        <ul className="fits">
          {fits.map((fit, i) => {
            const brand = brandById.get(fit.brandId)!;
            return (
              <li key={i} className="fit-row">
                <div className="fit-fields">
                  <label className="field">
                    <span className="label">Brand</span>
                    <select value={fit.brandId} onChange={(e) => updateFit(i, { brandId: e.target.value })}>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field narrow">
                    <span className="label">Size</span>
                    <select value={fit.size} onChange={(e) => updateFit(i, { size: e.target.value })}>
                      {brand.sizes.map((s) => (
                        <option key={s.label} value={s.label}>
                          {sizeLabel(s.label, s.alias)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {fits.length > 1 && (
                    <button
                      type="button"
                      className="remove"
                      aria-label={`Remove ${brand.name} ${fit.size}`}
                      onClick={() => setFits((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="segmented" role="radiogroup" aria-label="How do they fit at the waist?">
                  {FEELS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      role="radio"
                      aria-checked={fit.feel === f.value}
                      className={fit.feel === f.value ? "on" : ""}
                      onClick={() => updateFit(i, { feel: f.value })}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>

        {fits.length < 5 && (
          <button
            type="button"
            className="btn ghost add"
            onClick={() => setFits((prev) => [...prev, { brandId: "uniqlo", size: "32", feel: "good" }])}
          >
            + Add another pair <span className="muted">(more pairs = more confidence)</span>
          </button>
        )}

        <h2 className="panel-title spaced">
          <span className="step">2</span> What you're shopping for
        </h2>
        <div className="target-row">
          <label className="field">
            <span className="label">Brand</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="prefs">
          <legend className="label">How do you like them to fit?</legend>
          {PREFERENCES.map((p) => (
            <label key={p.value} className={`pref ${preference === p.value ? "on" : ""}`}>
              <input
                type="radio"
                name="preference"
                value={p.value}
                checked={preference === p.value}
                onChange={() => setPreference(p.value)}
              />
              <strong>{p.label}</strong>
              <span>{p.hint}</span>
            </label>
          ))}
        </fieldset>

        <button type="button" className="btn primary" onClick={() => findSize()} disabled={loading !== null}>
          {loading === "recommend" ? "Reading size charts…" : `Find my ${brandById.get(target)?.name} size`}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="panel result" aria-live="polite" aria-labelledby="result-heading">
        {!rec ? (
          <div className="empty">
            <h2 id="result-heading" className="panel-title">
              <span className="step">3</span> Your size
            </h2>
            <p className="muted">
              Your recommendation shows up here, with the reasoning behind it and your size at every brand we
              cover.
            </p>
          </div>
        ) : (
          <>
            <p className="eyebrow" id="result-heading">
              Your {rec.targetBrandName} size
            </p>
            <div className="answer">
              <span className="size">{rec.size}</span>
              {rec.alias && <span className="alias">{rec.alias}</span>}
            </div>

            <div className={`confidence ${rec.confidence.level}`}>
              <span className="pill">{LEVEL_COPY[rec.confidence.level]}</span>
              <span className="meter" aria-hidden="true">
                <span style={{ width: `${Math.round(rec.confidence.score * 100)}%` }} />
              </span>
              <span className="score">{Math.round(rec.confidence.score * 100)}/100</span>
            </div>

            <p className="explanation">{result!.explanation}</p>

            {rec.alternate && (
              <div className="callout">
                <strong>
                  Between sizes? Try {rec.alternate.size} ({rec.alternate.direction === "up" ? "one up" : "one down"})
                </strong>{" "}
                {rec.alternate.when}.
              </div>
            )}

            {rec.warnings.length > 0 && (
              <ul className="warnings">
                {rec.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            <details className="why">
              <summary>How we worked this out</summary>
              <dl className="factors">
                {rec.confidence.factors.map((f) => (
                  <div key={f.name}>
                    <dt>{f.name}</dt>
                    <dd>{f.note}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted small">
                Estimated waist {rec.estimatedWaistCm.low}–{rec.estimatedWaistCm.high} cm, aiming at{" "}
                {rec.estimatedWaistCm.target} cm. Explanation written by{" "}
                {result!.explanationVia === "model" ? "an AI model, checked against the numbers" : "our rules"}.
              </p>
            </details>

            <div className="feedback">
              {feedbackSent ? (
                <p className="thanks">Thanks, that helps us check our confidence scores.</p>
              ) : (
                <>
                  <p className="label">Would you buy this size?</p>
                  <div className="feedback-row">
                    <button type="button" className="btn ghost" onClick={() => sendFeedback("would_buy")}>
                      Yes
                    </button>
                    <button type="button" className="btn ghost" onClick={() => sendFeedback("would_not_buy")}>
                      No
                    </button>
                  </div>
                  <p className="label subtle">Already bought it?</p>
                  <div className="feedback-row">
                    <button type="button" className="btn ghost" onClick={() => sendFeedback("fit")}>
                      It fit
                    </button>
                    <button type="button" className="btn ghost" onClick={() => sendFeedback("too_small")}>
                      Too small
                    </button>
                    <button type="button" className="btn ghost" onClick={() => sendFeedback("too_big")}>
                      Too big
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="everywhere">
              <h3>Your size everywhere</h3>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Brand</th>
                    <th scope="col">Size</th>
                    <th scope="col">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {result!.everywhere.map((e) => (
                    <tr key={e.brandId} className={e.brandId === rec.targetBrandId ? "current" : ""}>
                      <td>{e.brandName}</td>
                      <td className="mono">{sizeLabel(e.size, e.alias)}</td>
                      <td>
                        <span className={`dot ${e.level}`} /> {e.level}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
