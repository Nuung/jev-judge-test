// Jev 무드 미러 데모 화면. 웹캠(로컬 표정)과 한국어 한마디를 묶어 서버 라우트에 판정을 요청한다.
// 데스크톱은 한 화면(h-dvh)에 캠을 주인공으로 꽉 채우고, 모바일은 캠 아래로 토스 바텀시트처럼 표정 수치·결과·입력이 올라온다.
"use client";

import { CircleAlert, Loader, ShieldCheck } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import type { FaceProbabilities, MoodKey } from "@/lib/judge/labels";
import type { JudgeResponse } from "@/lib/judge/schema";
import { CAM_BOX_CLASS, CameraCover } from "./CameraCover";
import { ERROR_GUIDE_KO } from "./errorMessages";
import { MessageForm, SubmitButton } from "./MessageForm";
import { MismatchAlert, type MismatchAlertProps } from "./MismatchAlert";
import { MoodGauge, MoodGaugePlaceholder } from "./MoodGauge";
import { ReactionRow } from "./ReactionCard";
import { requestJudgment, type JudgmentError } from "./requestJudgment";

// 웹캠 접근은 브라우저에서만 의미가 있으므로 서버 렌더링을 건너뛴다
const WebcamPanel = dynamic(() => import("./WebcamPanel"), {
  ssr: false,
  loading: () => (
    <div className={CAM_BOX_CLASS}>
      <CameraCover icon={Loader} title="카메라를 불러오고 있어요" body="잠시만 기다려 주세요." />
    </div>
  ),
});

type RequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: JudgeResponse; roundTripMs: number; face: FaceProbabilities | null }
  | { status: "error"; error: JudgmentError };

/** mismatch가 "mismatch"일 때만 face를 요구하는 판별 유니온으로 좁힌다 */
function mismatchAlertPropsOf(
  mismatch: JudgeResponse["mismatch"],
  face: FaceProbabilities | null,
  moodChoice: MoodKey,
): MismatchAlertProps {
  if (mismatch.status === "mismatch" && face) return { status: "mismatch", face, moodChoice };
  if (mismatch.status === "consistent") return { status: "consistent" };
  return { status: "no_face" };
}

/** config_error·invalid_input은 서버가 준 한국어 메시지를 그대로 보여준다 */
function errorMessageOf(error: JudgmentError): string {
  if (error.code === "config_error" || error.code === "invalid_input") return error.message;
  return ERROR_GUIDE_KO[error.code];
}

/** 토스 카드: 흰 배경, 테두리·그림자 없음. 모바일에서는 시트 안 구획이라 모서리를 없앤다 */
const CARD = "bg-white px-5 lg:rounded-3xl lg:px-6";
/** 캠 위에 뜨는 반투명 칩(blur 없이 검정 60%) */
const CAM_CHIP = "inline-flex h-9 items-center gap-1.5 rounded-xl bg-black/60 px-3 text-[13px] font-semibold text-white";

/** 모바일(<1024)에서만 결과 카드로 스크롤한다. 데스크톱은 한 화면이라 필요 없다 */
function revealResultOnMobile(target: HTMLElement | null) {
  if (!target || !window.matchMedia("(max-width: 1023.98px)").matches) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

export function MoodMirror() {
  const [text, setText] = useState("");
  const [request, setRequest] = useState<RequestState>({ status: "idle" });
  const faceSnapshotRef = useRef<FaceProbabilities | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  const isLoading = request.status === "loading";

  async function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    setRequest({ status: "loading" });
    // 사용자가 제출한 데 따른 동작이라 effect가 아니라 핸들러에서 결과 자리로 스크롤한다
    revealResultOnMobile(resultRef.current);
    const face = faceSnapshotRef.current;
    const result = await requestJudgment(trimmed, face);
    if (result.ok) {
      setRequest({ status: "success", data: result.data, roundTripMs: result.roundTripMs, face });
    } else {
      setRequest({ status: "error", error: result.error });
    }
  }

  return (
    <main className="flex min-h-dvh flex-col lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(420px,34vw)] lg:gap-3 lg:overflow-hidden lg:p-3">
      {/* 캠: 데스크톱은 뷰포트 높이 전부, 모바일은 상단 48dvh 전폭이고 표정 수치는 바로 아래 시트 최상단 */}
      <section
        aria-labelledby="camera-heading"
        className="relative shrink-0 lg:h-full lg:overflow-hidden lg:rounded-3xl lg:bg-grey-800"
      >
        <h2 id="camera-heading" className="sr-only">
          카메라와 표정
        </h2>
        <WebcamPanel snapshotRef={faceSnapshotRef} />
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2 lg:inset-x-4 lg:top-4">
          <h1 className={`${CAM_CHIP} text-[15px] font-bold`}>Jev 무드 미러</h1>
          <p className={CAM_CHIP}>
            <ShieldCheck size={16} strokeWidth={2.25} aria-hidden="true" />
            <span className="max-sm:hidden">영상은 이 기기에서만 처리돼요</span>
            <span className="sm:hidden">기기에서만 처리돼요</span>
          </p>
        </div>
      </section>

      {/* 결과(추천 포함) → 입력. 모바일은 시트 안의 구획, 데스크톱은 높이를 꽉 채우는 열 */}
      <div className="flex flex-1 flex-col gap-2 pt-2 lg:min-h-0 lg:gap-3 lg:pt-0">
        <section
          ref={resultRef}
          aria-live="polite"
          aria-label="기분 판정 결과"
          className={`${CARD} flex scroll-mt-2 flex-col py-5 lg:min-h-0 lg:flex-1 lg:overflow-hidden short:lg:py-4`}
        >
          {request.status === "success" ? (
            <div className="flex min-h-0 flex-1 animate-rise flex-col">
              <MoodGauge
                decision={request.data}
                model={request.data.model}
                latencyMs={request.data.latencyMs}
                roundTripMs={request.roundTripMs}
                insight={
                  <MismatchAlert
                    {...mismatchAlertPropsOf(request.data.mismatch, request.face, request.data.mood.choice)}
                  />
                }
                footer={<ReactionRow reaction={request.data.reaction} />}
              />
            </div>
          ) : (
            <MoodGaugePlaceholder
              loading={isLoading}
              notice={
                request.status === "error" ? (
                  <p className="flex items-start gap-2.5 rounded-2xl bg-grey-100 px-4 py-3 text-[15px] font-medium text-grey-800">
                    <CircleAlert size={20} strokeWidth={2} aria-hidden="true" className="shrink-0 text-grey-600" />
                    {errorMessageOf(request.error)}
                  </p>
                ) : undefined
              }
            />
          )}
        </section>

        <section aria-label="한마디 입력" className={`${CARD} shrink-0 pt-5 pb-3 lg:rounded-b-none short:lg:pt-4`}>
          <MessageForm value={text} onChange={setText} onSubmit={() => void handleSubmit()} />
        </section>

        {/* 토스 하단 고정 CTA. 모바일은 화면 하단에 붙고, 데스크톱은 입력 카드 아랫부분이 된다 */}
        <div className="sticky bottom-0 -mt-2 shrink-0 bg-white px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:static lg:-mt-3 lg:rounded-b-3xl lg:px-6 lg:pt-3 lg:pb-6 short:lg:pt-2 short:lg:pb-4">
          <SubmitButton loading={isLoading} disabled={text.trim().length === 0} />
        </div>
      </div>
    </main>
  );
}
