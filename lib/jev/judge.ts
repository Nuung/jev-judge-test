// Jev 1회 호출(모든 질문 fan-out) + 응답 경계 검증.
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import type { FaceProbabilities } from "@/lib/judge/labels";
import { buildState, JUDGE_QUESTIONS } from "@/lib/jev/questions";
import { JevResultSchema, type JevAnswers } from "@/lib/judge/schema";

export interface JevJudgment {
  answers: JevAnswers;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Jev 호출 소요 시간(ms, 재시도 포함) */
  latencyMs: number;
}

/** Jev 응답이 예상한 형태가 아닐 때 */
export class JevResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JevResponseError";
  }
}

/**
 * @throws {JevResponseError} 응답 형태 검증 실패
 * @throws SDK의 APIError / APIConnectionError 등은 그대로 전파한다
 */
export async function judgeWithJev(
  client: TypeSafeClient,
  input: { text: string; face: FaceProbabilities | null },
): Promise<JevJudgment> {
  const started = performance.now();
  // SDK는 응답을 런타임 검증하지 않으므로 unknown으로 받아 zod로 좁힌다
  const raw: unknown = await client.systemOne({
    state: buildState(input),
    questions: JUDGE_QUESTIONS,
  });
  const latencyMs = Math.round(performance.now() - started);

  const parsed = JevResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new JevResponseError(`Jev 응답 형식이 올바르지 않습니다: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return {
    answers: parsed.data.answers,
    model: parsed.data.model,
    inputTokens: parsed.data.usage.input_tokens,
    outputTokens: parsed.data.usage.output_tokens,
    latencyMs,
  };
}
