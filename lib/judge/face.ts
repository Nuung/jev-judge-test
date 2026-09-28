// 표정 확률 → 이름 버킷 변환. Jev는 수치 비교에 약하므로(jaggedness #2) 원시 확률 대신 코드가 만든 버킷만 state에 넣는다.
import { FACE_KEYS, type FaceKey, type FaceProbabilities } from "./labels";

export const FACE_STRONG = 0.7;
export const FACE_MODERATE = 0.4;

export type FaceStrength = "strong" | "moderate" | "weak";

/** Jev가 읽을 영문 설명 이름 */
export const FACE_DESCRIPTION: Readonly<Record<FaceKey, string>> = {
  neutral: "neutral (no clear expression)",
  happy: "happy (smiling)",
  sad: "sad (frowning, downcast)",
  angry: "angry (scowling)",
  fearful: "fearful (tense, wide eyes)",
  disgusted: "disgusted (wrinkled nose)",
  surprised: "surprised (raised brows, open mouth)",
};

export interface FaceRanking {
  dominant: FaceKey;
  strength: FaceStrength;
}

export function strengthOf(probability: number): FaceStrength {
  if (probability >= FACE_STRONG) return "strong";
  if (probability >= FACE_MODERATE) return "moderate";
  return "weak";
}

/** 확률이 가장 높은 표정과 그 세기를 구한다 */
export function rankFace(p: FaceProbabilities): FaceRanking {
  const dominant = FACE_KEYS.reduce((best, key) => (p[key] > p[best] ? key : best));
  return { dominant, strength: strengthOf(p[dominant]) };
}

/** Jev state의 `facial_expression` 필드 (JSON 호환 타입 별칭) */
export type FaceState =
  | { detected: false }
  | { detected: true; dominant: string; dominant_strength: FaceStrength };

export function summarizeFace(p: FaceProbabilities | null): FaceState {
  if (p === null) return { detected: false };
  const { dominant, strength } = rankFace(p);
  return { detected: true, dominant: FACE_DESCRIPTION[dominant], dominant_strength: strength };
}
