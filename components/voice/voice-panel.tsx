"use client";

import { useEffect, useRef, useState } from "react";
import {
  VoiceCapabilitiesSchema,
  type VoiceAdapter,
} from "@/lib/voice/contracts";
import {
  browserVoiceDependencies,
  VoiceClient,
  type VoiceSnapshot,
} from "@/lib/voice/client";
import { GradientOrb } from "./gradient-orb";

/** Portable HAC-112 mount: pass the existing conversation's read/submit adapter. */
export function VoicePanel({
  adapter,
  title = "Talk through your intake",
  label = "Voice intake",
  className = "",
  tone = "light",
}: {
  adapter: VoiceAdapter;
  title?: string;
  label?: string;
  className?: string;
  /** "dark" restyles the panel for the dark BizBox workspace; behaviour is identical. */
  tone?: "light" | "dark";
}) {
  const latest = useRef(adapter);
  useEffect(() => {
    latest.current = adapter;
  }, [adapter]);
  const client = useRef<VoiceClient | null>(null);
  const level = useRef(0);
  const [state, setState] = useState<VoiceSnapshot>({
    phase: "idle",
    muted: false,
    message: "Voice is off.",
  });
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    const connection = new VoiceClient(
      {
        readContext: () => latest.current.readContext(),
        submitTranscript: (text) => latest.current.submitTranscript(text),
      },
      browserVoiceDependencies(),
      setState,
      level,
    );
    client.current = connection;
    const controller = new AbortController();
    void fetch("/api/voice/session", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) =>
        response.ok
          ? VoiceCapabilitiesSchema.parse(await response.json()).configured
          : false,
      )
      .then((value) => {
        if (!controller.signal.aborted) setConfigured(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfigured(false);
      });
    return () => {
      controller.abort();
      connection.stop();
      client.current = null;
    };
  }, []);
  const active = !["idle", "error"].includes(state.phase);
  const dark = tone === "dark";
  const muted = dark ? "text-viewport-muted" : "text-muted";
  const primary = `rounded-lg px-3 py-2 text-sm font-semibold ${dark ? "bg-viewport-ink text-viewport-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-viewport-ink" : "bg-pine text-white"}`;
  const secondary = `rounded-lg border px-3 py-2 text-sm ${dark ? "border-viewport-line bg-transparent text-viewport-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-viewport-ink" : "border-line bg-white"}`;
  return (
    <section
      aria-label={label}
      className={`my-4 rounded-xl border p-4 ${dark ? "border-viewport-line bg-viewport-surface text-viewport-ink" : "border-line bg-paper"} ${className}`}
    >
      <div className="flex items-start gap-4">
        <GradientOrb
          className="w-20 shrink-0 sm:w-24"
          levelRef={level}
          active={active}
        />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{title}</h3>
          <p className={`mt-1 text-xs ${muted}`}>
            Optional AI voice. Starting sends microphone audio for transcription
            and speaks the conversation reply. You can keep typing.
          </p>
          <p
            role="status"
            aria-label="Voice status"
            className={`mt-2 text-sm ${muted}`}
          >
            {configured === null
              ? "Checking voice availability…"
              : configured
                ? state.message
                : "Voice is unavailable. Typed intake still works."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {!active ? (
              <button
                type="button"
                disabled={configured !== true}
                onClick={() => void client.current?.start()}
                className={`${primary} disabled:opacity-60`}
              >
                Start voice
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => client.current?.setMuted(!state.muted)}
                  aria-pressed={state.muted}
                  className={secondary}
                >
                  {state.muted ? "Unmute microphone" : "Mute microphone"}
                </button>
                <button
                  type="button"
                  onClick={() => client.current?.interrupt()}
                  className={secondary}
                >
                  Stop speaking
                </button>
                <button
                  type="button"
                  onClick={() => client.current?.stop()}
                  className={primary}
                >
                  Stop voice
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
