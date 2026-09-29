// 웹캠 미리보기. 데스크톱은 주어진 영역을 꽉 채우고 표정 수치를 영상 위 패널로 띄운다.
// 모바일은 영상 높이를 CAM_BOX_CLASS로 고정하고, 표정 수치는 영상 바로 아래 시트 최상단(FaceReadout)에 둔다.
// next/dynamic(ssr:false)로만 로드된다.
"use client";

import { CameraOff, ScanFace } from "lucide-react";
import type { RefObject } from "react";
import { CAM_BOX_CLASS, CameraCover, type CameraCoverProps } from "./CameraCover";
import { FaceOverlay, FaceReadout, type LiveFaceState } from "./FaceBars";
import { useFaceExpressions, type FaceReadingState } from "./useFaceExpressions";
import type { FaceProbabilities } from "@/lib/judge/labels";

export interface WebcamPanelProps {
  /** 최신 표정 확률 스냅샷을 기록할 ref. 부모와 공유하고 리렌더를 일으키지 않는다. */
  snapshotRef: RefObject<FaceProbabilities | null>;
}

type BlockedFaceState = Exclude<FaceReadingState, LiveFaceState>;

function isBlocked(state: FaceReadingState): state is BlockedFaceState {
  return state.status === "unsupported" || state.status === "denied" || state.status === "model_error";
}

/** 카메라를 쓸 수 없을 때 영역 전체에 띄우는 안내. 원인과 다음 행동을 함께 적는다 */
function coverOf(state: BlockedFaceState): CameraCoverProps {
  switch (state.status) {
    case "unsupported":
      return {
        icon: CameraOff,
        title: "이 브라우저는 카메라를 지원하지 않아요",
        body: "한마디만으로도 기분을 살펴볼 수 있어요.",
      };
    case "denied":
      if (state.reason === "not_found") {
        return { icon: CameraOff, title: "카메라를 찾을 수 없어요", body: "카메라를 연결하고 새로고침해 주세요." };
      }
      if (state.reason === "busy") {
        return { icon: CameraOff, title: "다른 앱이 카메라를 쓰고 있어요", body: "그 앱을 닫고 새로고침해 주세요." };
      }
      return {
        icon: CameraOff,
        title: "카메라 권한이 꺼져 있어요",
        body: "브라우저 설정에서 카메라를 허용한 뒤 새로고침해 주세요.",
      };
    case "model_error":
      return {
        icon: ScanFace,
        title: "표정 인식 모델을 불러오지 못했어요",
        body: `새로고침해 주세요. (${state.message})`,
      };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export default function WebcamPanel({ snapshotRef }: WebcamPanelProps) {
  const { videoRef, state } = useFaceExpressions(snapshotRef);

  return (
    <>
      <div className={CAM_BOX_CLASS}>
        <video
          ref={videoRef}
          className="h-full w-full -scale-x-100 object-cover"
          autoPlay
          muted
          playsInline
          aria-label="웹캠 미리보기"
        />
        {isBlocked(state) ? (
          <div role="alert">
            <CameraCover {...coverOf(state)} />
          </div>
        ) : (
          <>
            {state.status !== "detected" && (
              // 데스크톱은 오른쪽 아래 표정 패널과 겹치지 않도록 원을 조금 왼쪽에 둔다
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-1/2 aspect-square h-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-dashed border-white/60 lg:left-[42%]"
              />
            )}
            <FaceOverlay state={state} />
          </>
        )}
      </div>
      {!isBlocked(state) && <FaceReadout state={state} />}
    </>
  );
}
