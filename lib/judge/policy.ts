// 판정 정책 — Jev 확률을 화면 상태로 바꾸는 임계값과 규칙. SDK 비의존.
import type { FaceRanking } from "./face";
import { REACTIONS } from "./reactions";
import type { Decision, GuardrailStatus, JevAnswers, MismatchStatus, ReactionDecision } from "./schema";

/** 가드레일: 인젝션·유해 확률 중 큰 값이 이 이상이면 주의 */
export const GUARDRAIL_REVIEW = 0.35;
/** 가드레일: 인젝션·유해 확률 중 큰 값이 이 이상이면 차단 */
export const GUARDRAIL_BLOCK = 0.7;
/**
 * 기분 확신도가 이보다 낮으면 "확신 낮음" 표기만 붙인다(반응은 숨기지 않음).
 * 출처: docs.typesafe.ai/patterns/confidence-routing.md의 기본 라우팅 기준 0.6
 */
export const MOOD_MIN_CONFIDENCE = 0.6;
/** 불일치 확률이 이 이상이면 알림 */
export const MISMATCH_ALERT = 0.6;

export function guardrailStatus(injection: number, harmful: number): GuardrailStatus {
  const risk = Math.max(injection, harmful);
  if (risk >= GUARDRAIL_BLOCK) return "blocked";
  if (risk >= GUARDRAIL_REVIEW) return "caution";
  return "safe";
}

/**
 * 불일치 판정. 얼굴 유무·세기 조건은 코드가 판단하고, Jev의 확률은 표정이 뚜렷할 때만 쓴다.
 * - 얼굴 없음 → no_face
 * - 가장 강한 표정이 무표정이거나 세기가 약함 → 확률과 무관하게 consistent
 * - 그 외 → 확률이 MISMATCH_ALERT 이상이면 mismatch
 */
export function mismatchStatus(face: FaceRanking | null, probability: number): MismatchStatus {
  if (face === null) return "no_face";
  if (face.dominant === "neutral" || face.strength === "weak") return "consistent";
  return probability >= MISMATCH_ALERT ? "mismatch" : "consistent";
}

/** @param face `rankFace` 결과. 얼굴이 감지되지 않았으면 null */
export function decide(answers: JevAnswers, face: FaceRanking | null): Decision {
  const { mood } = answers;
  const injection = answers.prompt_injection.noul;
  const harmful = answers.harmful_content.noul;
  const guardrail = guardrailStatus(injection, harmful);

  // 가드레일이 safe가 아니면(주의·차단) 반응을 숨긴다. 인젝션이 기분을 조작했을 수 있어서다
  let reaction: ReactionDecision;
  if (guardrail !== "safe") {
    reaction = { status: "hidden", reason: "guardrail" };
  } else {
    const kind = answers[`reaction_${mood.choice}`].choice;
    reaction = {
      status: "shown",
      item: REACTIONS[mood.choice][kind],
      lowConfidence: mood.confidence < MOOD_MIN_CONFIDENCE,
    };
  }

  const mismatchProbability = answers.mismatch.noul;
  const mismatch = mismatchStatus(face, mismatchProbability);

  return {
    mood: { choice: mood.choice, confidence: mood.confidence, probabilities: mood.probabilities },
    guardrail: { status: guardrail, injection, harmful },
    mismatch: { status: mismatch, probability: mismatchProbability },
    reaction,
  };
}
