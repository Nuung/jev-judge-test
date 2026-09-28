// 신뢰 경계 스키마(zod 4) — 요청 본문, Jev 응답, 라우트 응답. SDK 비의존.
import { z } from "zod";
import { MOOD_KEYS, REACTION_KINDS, type FACE_KEYS } from "./labels";

const PROBABILITY_ERROR = "확률은 0 이상 1 이하의 숫자여야 해요.";
const probability = z
  .number({ error: PROBABILITY_ERROR })
  .min(0, { error: PROBABILITY_ERROR })
  .max(1, { error: PROBABILITY_ERROR });

// ── 요청 ────────────────────────────────────────────────

export const TEXT_MAX_LENGTH = 300;

export const FaceProbabilitiesSchema = z.object({
  neutral: probability,
  happy: probability,
  sad: probability,
  angry: probability,
  fearful: probability,
  disgusted: probability,
  surprised: probability,
} satisfies Record<(typeof FACE_KEYS)[number], typeof probability>);

export const JudgeRequestSchema = z.object({
  text: z
    .string({ error: "text는 문자열이어야 해요." })
    .trim()
    .min(1, { error: "한마디를 입력해 주세요." })
    .max(TEXT_MAX_LENGTH, { error: `한마디는 ${TEXT_MAX_LENGTH}자 이하로 입력해 주세요.` }),
  face: FaceProbabilitiesSchema.nullable(),
});
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>;

// ── Jev 응답 (SDK 결과는 unknown으로 받아 여기서 검증) ─────────

const noulAnswer = z.object({ type: z.literal("noul"), noul: probability });

function choiceAnswer<const K extends readonly [string, ...string[]]>(keys: K) {
  const key = z.enum(keys);
  return z.object({
    type: z.literal("choice"),
    choice: key,
    confidence: probability,
    probabilities: z.record(key, probability),
  });
}

const reactionAnswer = choiceAnswer(REACTION_KINDS);

export const JevAnswersSchema = z.object({
  mood: choiceAnswer(MOOD_KEYS),
  prompt_injection: noulAnswer,
  harmful_content: noulAnswer,
  mismatch: noulAnswer,
  reaction_joy: reactionAnswer,
  reaction_calm: reactionAnswer,
  reaction_sad: reactionAnswer,
  reaction_tired: reactionAnswer,
  reaction_annoyed: reactionAnswer,
  reaction_anxious: reactionAnswer,
});
export type JevAnswers = z.infer<typeof JevAnswersSchema>;

export const JevResultSchema = z.object({
  model: z.string(),
  answers: JevAnswersSchema,
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

// ── 라우트 응답 ─────────────────────────────────────────

export const ReactionItemSchema = z.object({
  id: z.string(),
  kind: z.enum(REACTION_KINDS),
  title: z.string(),
  body: z.string(),
});
export type ReactionItem = z.infer<typeof ReactionItemSchema>;

export const GuardrailStatusSchema = z.enum(["safe", "caution", "blocked"]);
export type GuardrailStatus = z.infer<typeof GuardrailStatusSchema>;

export const MismatchStatusSchema = z.enum(["no_face", "consistent", "mismatch"]);
export type MismatchStatus = z.infer<typeof MismatchStatusSchema>;

export const ReactionDecisionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("shown"), item: ReactionItemSchema, lowConfidence: z.boolean() }),
  z.object({ status: z.literal("hidden"), reason: z.literal("guardrail") }),
]);
export type ReactionDecision = z.infer<typeof ReactionDecisionSchema>;

export const DecisionSchema = z.object({
  mood: z.object({
    choice: z.enum(MOOD_KEYS),
    confidence: probability,
    probabilities: z.record(z.enum(MOOD_KEYS), probability),
  }),
  guardrail: z.object({
    status: GuardrailStatusSchema,
    injection: probability,
    harmful: probability,
  }),
  mismatch: z.object({
    status: MismatchStatusSchema,
    probability,
  }),
  reaction: ReactionDecisionSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

export const JudgeResponseSchema = DecisionSchema.extend({
  model: z.string(),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
});
export type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

// ── 에러 응답 ───────────────────────────────────────────

export const ErrorCodeSchema = z.enum([
  "invalid_input",
  "upstream_error",
  "upstream_rate_limited",
  "config_error",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({ code: ErrorCodeSchema, message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
