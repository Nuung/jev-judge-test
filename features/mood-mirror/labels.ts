// 화면에만 쓰는 라벨이라 features 계층에 둔다.
// lib/judge/labels.ts는 판정 SDK, eval과 공유하는 최소 집합만 둔다.
import type { FaceStrength } from "@/lib/judge/face";
import type { FaceKey } from "@/lib/judge/labels";

export const FACE_LABEL_KO: Readonly<Record<FaceKey, string>> = {
  neutral: "무표정",
  happy: "웃음",
  sad: "슬픔",
  angry: "화남",
  fearful: "두려움",
  disgusted: "혐오",
  surprised: "놀람",
};

/**
 * 표정 이름 + 주격 조사. 받침 유무에 따라 이/가를 미리 붙여 둔다("혐오"만 받침이 없어 "가").
 * "웃음이 뚜렷해요"처럼 세기 문구 앞에 붙인다.
 */
export const FACE_SUBJECT_KO: Readonly<Record<FaceKey, string>> = {
  neutral: "무표정이",
  happy: "웃음이",
  sad: "슬픔이",
  angry: "화남이",
  fearful: "두려움이",
  disgusted: "혐오가",
  surprised: "놀람이",
};

/** 표정 세기를 단정하지 않는 말로 바꾼다. FACE_SUBJECT_KO 뒤에 붙어 "웃음이 뚜렷해요"가 된다 */
export const FACE_STRENGTH_PHRASE_KO: Readonly<Record<FaceStrength, string>> = {
  strong: "뚜렷해요",
  moderate: "보여요",
  weak: "살짝 보여요",
};

/** 불일치 문장 앞절용 연결형. 예: "웃음 표정이 뚜렷한데, 말은 ~" */
export const FACE_STRENGTH_CLAUSE_KO: Readonly<Record<FaceStrength, string>> = {
  strong: "뚜렷한데",
  moderate: "보이는데",
  weak: "살짝 보이는데",
};
