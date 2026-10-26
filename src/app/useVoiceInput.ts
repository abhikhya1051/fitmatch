"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Thin wrapper around the browser's Web Speech API (SpeechRecognition).
 * Supported in Chrome, Edge and Safari; Firefox has no implementation, so the
 * mic button hides itself there and typing still works.
 */

// The Web Speech API isn't in TypeScript's DOM lib yet; type the bits we use.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type Ctor = new () => SpeechRecognitionLike;

function getCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceStatus = "unsupported" | "idle" | "listening" | "error";

const ERROR_COPY: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser's site settings, or type instead.",
  "service-not-allowed": "Microphone access is blocked. Allow it in your browser's site settings, or type instead.",
  "no-speech": "We didn't hear anything. Tap the mic and try again.",
  "audio-capture": "No microphone found. Plug one in, or type instead.",
  network: "Speech recognition needs an internet connection. Try again, or type instead.",
};

interface Options {
  /** Live transcript while the user is speaking. */
  onInterim: (text: string) => void;
  /** Called once with the full transcript when the user stops talking. */
  onFinal: (text: string) => void;
}

export function useVoiceInput({ onInterim, onFinal }: Options) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const handlers = useRef({ onInterim, onFinal });
  handlers.current = { onInterim, onFinal };

  // Feature detection has to wait for the browser.
  useEffect(() => {
    if (!getCtor()) setStatus("unsupported");
    return () => recRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return setStatus("unsupported");
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false; // stop after a pause; one sentence is all we need
    finalRef.current = "";
    setError(null);

    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      handlers.current.onInterim((finalRef.current + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      setError(ERROR_COPY[e.error] ?? "Voice input stopped unexpectedly. Try again, or type instead.");
      setStatus("error");
    };
    rec.onend = () => {
      recRef.current = null;
      setStatus((s) => (s === "error" ? s : "idle"));
      const text = finalRef.current.trim();
      if (text) handlers.current.onFinal(text);
    };

    recRef.current = rec;
    rec.start();
    setStatus("listening");
  }, []);

  const stop = useCallback(() => recRef.current?.stop(), []);

  return { status, error, start, stop };
}
