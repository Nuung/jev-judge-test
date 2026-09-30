// 판정에 쓰는 라벨 집합이다. 데모와 평가가 공유하는 단일 출처. SDK 비의존(클라이언트 번들 가능).

/** 기분 6종 (Choice 옵션 키) */
export const MOOD_KEYS = ["joy", "calm", "sad", "tired", "annoyed", "anxious"] as const;
export type MoodKey = (typeof MOOD_KEYS)[number];

export const MOOD_LABEL_KO: Readonly<Record<MoodKey, string>> = {
  joy: "기쁨",
  calm: "평온",
  sad: "슬픔",
  tired: "피곤",
  annoyed: "짜증",
  anxious: "불안",
};

/** face-api FaceExpressions의 7개 표정 키 */
export const FACE_KEYS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "fearful",
  "disgusted",
  "surprised",
] as const;
export type FaceKey = (typeof FACE_KEYS)[number];

/** 브라우저 로컬 모델이 낸 표정 확률(0~1) 7개 */
export type FaceProbabilities = Readonly<Record<FaceKey, number>>;

/** 기분 맞춤 반응 종류 (기분별 Choice 옵션 키) */
export const REACTION_KINDS = ["music", "phrase", "rest"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];
