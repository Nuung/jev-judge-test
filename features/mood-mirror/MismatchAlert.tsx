// 표정과 말의 불일치 알림. 결과 헤드라인 바로 아래에 붙고, 얼굴이 없었으면 비교하지 않았다고 알린다.
// 불일치는 이 데모의 핵심 순간이라 키컬러(Toss Blue)를 쓴다. 결과 영역 전체가 aria-live라 여기엔 role을 따로 두지 않는다.
import { Info, ScanFace } from "lucide-react";
import { rankFace } from "@/lib/judge/face";
import { MOOD_LABEL_KO, type FaceProbabilities, type MoodKey } from "@/lib/judge/labels";
import { FACE_LABEL_KO, FACE_STRENGTH_CLAUSE_KO } from "./labels";

/** face는 mismatch 상태에만 있다. 타입으로 못박아 불가능한 상태를 없앤다 */
export type MismatchAlertProps =
  | { status: "no_face" }
  | { status: "consistent" }
  | { status: "mismatch"; face: FaceProbabilities; moodChoice: MoodKey };

function QuietNote({ children }: { children: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[13px] font-medium text-grey-600">
      <Info size={16} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0 text-grey-400" />
      {children}
    </p>
  );
}

export function MismatchAlert(props: MismatchAlertProps) {
  if (props.status === "no_face") {
    return <QuietNote>얼굴이 보이지 않아 표정과 말의 차이는 살피지 않았어요.</QuietNote>;
  }

  if (props.status === "consistent") {
    // 무표정이거나 약한 표정이면 비교 자체를 건너뛰므로 "잘 어울린다"고 단정하지 않는다
    return <QuietNote>표정과 말 사이에 뚜렷한 차이는 보이지 않아요.</QuietNote>;
  }

  const { dominant, strength } = rankFace(props.face);
  const faceText =
    dominant === "neutral"
      ? "표정은 무표정에 가깝고"
      : `${FACE_LABEL_KO[dominant]} 표정이 ${FACE_STRENGTH_CLAUSE_KO[strength]}`;

  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-toss-blue-soft px-4 py-3 short:py-2.5">
      <ScanFace size={20} strokeWidth={2} aria-hidden="true" className="mt-px shrink-0 text-toss-blue" />
      <div className="min-w-0">
        <p className="text-[15px] leading-snug font-bold text-toss-blue-strong">표정과 말이 조금 달라 보여요</p>
        <p className="mt-0.5 text-[13px] font-medium text-grey-700">
          {faceText}, 말은 {MOOD_LABEL_KO[props.moodChoice]}에 가까워요.
        </p>
      </div>
    </div>
  );
}
