import { z } from "zod";

export const VOICE_LIMITS = {
  offerChars: 64_000,
  transcriptChars: 2_000,
  replyChars: 4_000,
  summaryChars: 2_000,
  promptChars: 1_000,
  sessionSeconds: 180,
  maxOutputTokens: 512,
  upstreamTimeoutMs: 15_000,
} as const;

const identity = z.string().trim().min(1).max(200);

export const VoiceContextSchema = z
  .object({
    projectId: identity,
    mode: z.enum(["intake", "chat"]).default("intake"),
    selectedSiteId: identity.optional(),
    scenarioId: identity.optional(),
    prompt: z.string().max(VOICE_LIMITS.promptChars).optional(),
    summary: z.string().max(VOICE_LIMITS.summaryChars).optional(),
  })
  .strict();

export type VoiceContext = z.infer<typeof VoiceContextSchema>;

export const VoiceSessionRequestSchema = z
  .object({
    offerSdp: z
      .string()
      .min(1)
      .max(VOICE_LIMITS.offerChars)
      .refine((value) => /^v=0\r?\n/.test(value), "Invalid SDP offer"),
    context: VoiceContextSchema,
  })
  .strict();

export const VoiceSessionResponseSchema = z.object({
  answerSdp: z.string().min(1).max(VOICE_LIMITS.offerChars),
  sessionSeconds: z.number().int().positive().max(VOICE_LIMITS.sessionSeconds),
});

export const VoiceCapabilitiesSchema = z.object({ configured: z.boolean() });

/** The existing client action is the only owner of business/conversation state. */
export interface VoiceAdapter {
  readContext(): VoiceContext;
  submitTranscript(text: string): Promise<string | null>;
}
