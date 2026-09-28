// POST /api/judge 호출 + 응답을 경계에서 다시 zod로 검증한다. 왕복 ms는 성공 시에만 의미가 있다.
import { ErrorResponseSchema, JudgeResponseSchema, type JudgeResponse } from "@/lib/judge/schema";
import type { FaceProbabilities } from "@/lib/judge/labels";
import { ERROR_GUIDE_KO, type ClientErrorCode } from "./errorMessages";

export interface JudgmentError {
  code: ClientErrorCode;
  message: string;
}

export type JudgmentResult =
  | { ok: true; data: JudgeResponse; roundTripMs: number }
  | { ok: false; error: JudgmentError };

export async function requestJudgment(
  text: string,
  face: FaceProbabilities | null,
): Promise<JudgmentResult> {
  const started = performance.now();

  let response: Response;
  try {
    response = await fetch("/api/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, face }),
    });
  } catch {
    return { ok: false, error: { code: "network_error", message: ERROR_GUIDE_KO.network_error } };
  }

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsedError = ErrorResponseSchema.safeParse(json);
    if (parsedError.success) {
      return { ok: false, error: parsedError.data.error };
    }
    return { ok: false, error: { code: "unknown_error", message: ERROR_GUIDE_KO.unknown_error } };
  }

  const parsed = JudgeResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_response", message: ERROR_GUIDE_KO.invalid_response } };
  }

  const roundTripMs = Math.round(performance.now() - started);
  return { ok: true, data: parsed.data, roundTripMs };
}
