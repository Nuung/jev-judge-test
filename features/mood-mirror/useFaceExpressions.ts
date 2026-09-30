// 브라우저 로컬 표정 인식 훅. 영상/이미지는 절대 네트워크로 보내지 않고
// 확률 7개만 부모가 준 ref에 기록한다(제출 시 스냅샷으로만 사용).
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { FaceProbabilities } from "@/lib/judge/labels";

/** 카메라, 모델, 추론 파이프라인의 현재 상태 (판별 유니온) */
export type FaceReadingState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "loading_models" }
  | { status: "unsupported" }
  | { status: "denied"; reason: "permission" | "not_found" | "busy" | "other" }
  | { status: "model_error"; message: string }
  | { status: "inference_error" }
  | { status: "no_face" }
  | { status: "detected"; probabilities: FaceProbabilities };

const DETECTION_INTERVAL_MS = 300;
const DETECTOR_INPUT_SIZE = 224;
const DETECTOR_SCORE_THRESHOLD = 0.5;
/** 첫 성공 이후 연속 추론 실패가 이 횟수 이상이면 잠시 물러났다가 재개한다 */
const MAX_CONSECUTIVE_FAILURES = 5;
/** 연속 실패 뒤 재개까지 기다리는 시간 */
const INFERENCE_BACKOFF_MS = 2000;

function denialReasonOf(error: unknown): "permission" | "not_found" | "busy" | "other" {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return "permission";
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") return "not_found";
    if (error.name === "NotReadableError" || error.name === "TrackStartError") return "busy";
  }
  return "other";
}

export function useFaceExpressions(snapshotRef: RefObject<FaceProbabilities | null>): {
  videoRef: RefObject<HTMLVideoElement | null>;
  state: FaceReadingState;
} {
  // video 엘리먼트는 React 상태가 아니라 DOM 핸들이라 ref로 다뤄야 마음대로 mutate할 수 있다
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [state, setState] = useState<FaceReadingState>({ status: "idle" });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    // video를 인자로 넘겨야 클로저 안에서도 non-null 타입이 유지된다
    async function start(video: HTMLVideoElement) {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setState({ status: "unsupported" });
        return;
      }

      setState({ status: "requesting" });
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
          audio: false,
        });
      } catch (error) {
        if (!cancelled) setState({ status: "denied", reason: denialReasonOf(error) });
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // 자동 재생이 막혀도 사용자가 화면을 건드리면 대개 다시 재생되니 치명적이지 않다
      }
      if (cancelled) return;

      setState({ status: "loading_models" });
      try {
        // main이 node 빌드를 가리키므로 정적 import를 쓰지 않고, 브라우저에서만 동적으로 불러온다
        const faceapi = await import("@vladmandic/face-api");
        if (cancelled) return;

        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
          faceapi.nets.faceExpressionNet.loadFromUri("/models"),
        ]);
        if (cancelled) return;

        const options = new faceapi.TinyFaceDetectorOptions({
          inputSize: DETECTOR_INPUT_SIZE,
          scoreThreshold: DETECTOR_SCORE_THRESHOLD,
        });

        // 웹캠 워밍업 중(0×0 프레임 등) 예외는 첫 성공 전까지 카운트하지 않고 계속 재시도한다
        let hasSucceededOnce = false;
        let consecutiveFailures = 0;

        const tick = async () => {
          if (cancelled) return;
          try {
            const result = await faceapi.detectSingleFace(video, options).withFaceExpressions().run();
            if (cancelled) return;
            hasSucceededOnce = true;
            consecutiveFailures = 0;
            if (result) {
              const { expressions } = result;
              const probabilities: FaceProbabilities = {
                neutral: expressions.neutral,
                happy: expressions.happy,
                sad: expressions.sad,
                angry: expressions.angry,
                fearful: expressions.fearful,
                disgusted: expressions.disgusted,
                surprised: expressions.surprised,
              };
              snapshotRef.current = probabilities;
              setState({ status: "detected", probabilities });
            } else {
              snapshotRef.current = null;
              setState({ status: "no_face" });
            }
            timerId = setTimeout(() => void tick(), DETECTION_INTERVAL_MS);
          } catch {
            // 오래된 스냅샷이 전송되지 않도록 실패 시 즉시 비운다
            snapshotRef.current = null;
            if (cancelled) return;

            if (!hasSucceededOnce) {
              timerId = setTimeout(() => void tick(), DETECTION_INTERVAL_MS);
              return;
            }

            consecutiveFailures += 1;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              setState({ status: "inference_error" });
              timerId = setTimeout(() => {
                consecutiveFailures = 0;
                void tick();
              }, INFERENCE_BACKOFF_MS);
              return;
            }
            timerId = setTimeout(() => void tick(), DETECTION_INTERVAL_MS);
          }
        };
        void tick();
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "알 수 없는 오류";
          setState({ status: "model_error", message });
        }
      }
    }

    void start(video);

    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
      if (stream) stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      snapshotRef.current = null;
    };
  }, [snapshotRef]);

  return { videoRef, state };
}
