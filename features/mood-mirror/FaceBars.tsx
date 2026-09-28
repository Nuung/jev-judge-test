// 표정 라이브 리드아웃 — 1위 표정을 큰 숫자로, 7개 표정을 고정 순서의 막대+수치로 보여준다.
// 데스크톱은 캠 오른쪽 아래 세로 패널(FaceOverlay), 모바일은 캠 위에 작은 상태 칩만 두고
// 수치는 캠 바로 아래 시트 최상단 가로 행(FaceReadout)으로 뺀다 — 오버레이가 입을 가리지 않게.
// 행 순서를 확률순으로 바꾸지 않는 이유: 추론이 약 300ms마다 갱신돼 순서가 계속 뒤바뀌면 읽을 수 없다.
// 영상은 이 기기 밖으로 나가지 않는다.
import { rankFace, type FaceStrength } from "@/lib/judge/face";
import { FACE_KEYS, type FaceKey, type FaceProbabilities } from "@/lib/judge/labels";
import { FACE_LABEL_KO, FACE_STRENGTH_PHRASE_KO, FACE_SUBJECT_KO } from "./labels";
import { formatPercent, toPercent } from "./format";
import type { FaceReadingState } from "./useFaceExpressions";

/** 리드아웃이 뜨는 상태만 — 카메라를 쓸 수 없는 상태는 WebcamPanel이 화면 전체 안내로 덮는다 */
export type LiveFaceState = Extract<
  FaceReadingState,
  { status: "idle" | "requesting" | "loading_models" | "no_face" | "inference_error" | "detected" }
>;

interface FaceBarsProps {
  state: LiveFaceState;
}

/** 화면에 그릴 내용 — 얼굴을 읽었으면 수치, 아니면 다음 행동 안내 */
type View =
  | { kind: "reading"; probabilities: FaceProbabilities; dominant: FaceKey; strength: FaceStrength }
  | { kind: "guide"; text: string };

function viewOf(state: LiveFaceState): View {
  switch (state.status) {
    case "detected":
      return { kind: "reading", probabilities: state.probabilities, ...rankFace(state.probabilities) };
    case "idle":
    case "requesting":
      return { kind: "guide", text: "카메라를 켜고 있어요" };
    case "loading_models":
      return { kind: "guide", text: "표정 모델을 불러오고 있어요" };
    case "no_face":
      return { kind: "guide", text: "얼굴을 가운데 원에 맞춰 주세요" };
    case "inference_error":
      return { kind: "guide", text: "잠시 후 다시 읽어 볼게요" };
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/** 모바일 캠 위 상태 칩에 쓸 짧은 상태 이름 */
function statusLabelOf(status: LiveFaceState["status"]): string {
  switch (status) {
    case "detected":
      return "얼굴 인식 중";
    case "idle":
    case "requesting":
      return "카메라 준비 중";
    case "loading_models":
      return "표정 모델 준비 중";
    case "no_face":
      return "얼굴 없음";
    case "inference_error":
      return "인식 잠시 멈춤";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** 1위 표정 이름 아래의 세기 문구 — 무표정은 세기 대신 상태를 풀어 쓴다 */
function strengthPhraseOf(dominant: FaceKey, strength: FaceStrength): string {
  if (dominant === "neutral") return "특별한 표정이 없어요";
  return FACE_STRENGTH_PHRASE_KO[strength];
}

/** 한 줄 요약 — "웃음이 뚜렷해요" */
function summaryOf(dominant: FaceKey, strength: FaceStrength): string {
  if (dominant === "neutral") return "특별한 표정이 없어요";
  return `${FACE_SUBJECT_KO[dominant]} ${FACE_STRENGTH_PHRASE_KO[strength]}`;
}

/** 어두운 캠 위(dark)와 흰 시트 위(light)의 색 조합 */
type Surface = "dark" | "light";

const METER_TONE: Readonly<Record<Surface, { track: string; fill: string }>> = {
  dark: { track: "bg-white/20", fill: "bg-white/70" },
  light: { track: "bg-grey-200", fill: "bg-grey-400" },
};

/** 얼굴을 읽는 중인지 보여주는 점 — 인식 중일 때만 키컬러 */
function LiveDot({ live, surface }: { live: boolean; surface: Surface }) {
  const idle = surface === "dark" ? "bg-white/40" : "bg-grey-300";
  return <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${live ? "bg-toss-blue" : idle}`} />;
}

/** 표정 하나의 확률 미터 — 트랙은 항상 그려서 얼굴이 없어도 자리가 흔들리지 않는다 */
function Meter({
  faceKey,
  value,
  strong,
  surface,
  className,
}: {
  faceKey: FaceKey;
  value: number | null;
  strong: boolean;
  surface: Surface;
  className: string;
}) {
  const tone = METER_TONE[surface];
  return (
    <span
      className={`block overflow-hidden rounded-full ${tone.track} ${className}`}
      role="meter"
      aria-label={`${FACE_LABEL_KO[faceKey]} 확률`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? 0 : toPercent(value)}
      aria-valuetext={value === null ? "읽는 중" : formatPercent(value)}
    >
      {value !== null && (
        // 값이 바뀌면 200ms로 따라간다(모션 줄이기 설정이면 즉시)
        <span
          className={`block h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none ${strong ? "bg-toss-blue" : tone.fill}`}
          style={{ width: formatPercent(value) }}
        />
      )}
    </span>
  );
}

/** 1위 퍼센트 — 숫자는 크게, % 기호는 작게 붙인다 */
function BigPercent({ value, className, unitClassName }: { value: number; className: string; unitClassName: string }) {
  return (
    <p className={`shrink-0 leading-none font-bold tracking-[-0.03em] tabular-nums ${className}`}>
      {toPercent(value)}
      <span className={`ml-0.5 ${unitClassName}`}>%</span>
    </p>
  );
}

/** 데스크톱 세로 패널 — 폭 264px, 캠 오른쪽 아래. 낮은 화면(short)에서는 캠을 절반 넘게 덮지 않도록 줄인다 */
function DesktopPanel({ view }: { view: View }) {
  const reading = view.kind === "reading" ? view : null;
  return (
    <section
      aria-label="표정 수치"
      className="w-[264px] rounded-[20px] bg-black/60 px-5 pt-4 pb-5 text-white short:pt-3 short:pb-4"
    >
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-white/80">
        <LiveDot live={reading !== null} surface="dark" />
        표정
      </p>

      {/* 1위 표정 — 높이를 고정해 얼굴이 사라졌다 나타나도 아래 행이 밀리지 않는다 */}
      <div className="mt-1 flex h-[76px] flex-col justify-center short:h-[60px]">
        {view.kind === "reading" ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-[24px] leading-tight font-bold tracking-[-0.02em] short:text-[20px]">
                {FACE_LABEL_KO[view.dominant]}
              </p>
              <BigPercent
                value={view.probabilities[view.dominant]}
                className="text-[40px] short:text-[32px]"
                unitClassName="text-[22px] short:text-[18px]"
              />
            </div>
            <p className="mt-1.5 text-[15px] font-semibold text-white/80 short:mt-1 short:text-[14px]">
              {strengthPhraseOf(view.dominant, view.strength)}
            </p>
          </>
        ) : (
          <p className="text-[17px] leading-snug font-bold">{view.text}</p>
        )}
      </div>

      <ul
        className="mt-4 space-y-3 border-t border-white/15 pt-4 short:mt-3 short:space-y-2 short:pt-3"
        aria-label="표정별 확률"
      >
        {FACE_KEYS.map((key) => {
          const value = reading ? reading.probabilities[key] : null;
          const strong = reading?.dominant === key;
          const tone = strong ? "text-white" : "text-white/80";
          return (
            <li key={key} className="grid grid-cols-[3.25rem_minmax(0,1fr)_2.75rem] items-center gap-3">
              <span className={`text-[15px] font-semibold short:text-[14px] ${tone}`}>{FACE_LABEL_KO[key]}</span>
              <Meter faceKey={key} value={value} strong={strong} surface="dark" className="h-2" />
              <span aria-hidden="true" className={`text-right text-[15px] font-bold tabular-nums short:text-[14px] ${tone}`}>
                {value === null ? "" : formatPercent(value)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * 캠 위 오버레이 — 데스크톱 패널 + 모바일 상태 칩 + 스크린리더용 1위 표정 알림.
 * 알림 영역에는 1위 표정 이름만 넣는다: 수치가 300ms마다 바뀌어도 이름이 같으면 React가 DOM을 건드리지 않아
 * 1위가 바뀔 때만 다시 읽힌다.
 */
export function FaceOverlay({ state }: FaceBarsProps) {
  const view = viewOf(state);
  const announcement = view.kind === "reading" ? `지금 표정 ${FACE_LABEL_KO[view.dominant]}` : view.text;

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {/* 데스크톱 — 얼굴은 대개 가운데이므로 수치는 오른쪽 가장자리에 둔다 */}
      <div className="pointer-events-none absolute right-4 bottom-4 max-lg:hidden">
        <DesktopPanel view={view} />
      </div>

      {/* 모바일 — 수치는 캠 아래 시트로 빼고, 캠 위에는 상태 칩만. 시트가 캠 아래 24px을 덮으므로 그만큼 띄운다 */}
      <p
        aria-hidden="true"
        className="pointer-events-none absolute bottom-9 left-3 inline-flex h-8 items-center gap-1.5 rounded-xl bg-black/60 px-2.5 text-[12px] font-semibold text-white lg:hidden"
      >
        <LiveDot live={view.kind === "reading"} surface="dark" />
        {statusLabelOf(state.status)}
      </p>
    </>
  );
}

/** 모바일 시트 최상단 — 1위 표정 + 큰 % 한 줄, 그 아래 7열 컴팩트 미터 */
export function FaceReadout({ state }: FaceBarsProps) {
  const view = viewOf(state);
  const reading = view.kind === "reading" ? view : null;

  return (
    <section
      aria-label="표정 수치"
      className="relative z-10 -mt-6 rounded-t-3xl bg-white px-5 pt-5 pb-4 lg:hidden"
    >
      <div className="flex h-12 items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-grey-600">
            <LiveDot live={reading !== null} surface="light" />
            표정
          </p>
          <p className="truncate text-[19px] leading-snug font-bold tracking-[-0.01em] text-grey-900">
            {view.kind === "reading" ? summaryOf(view.dominant, view.strength) : view.text}
          </p>
        </div>
        {view.kind === "reading" && (
          <BigPercent
            value={view.probabilities[view.dominant]}
            className="text-[30px] text-grey-900"
            unitClassName="text-[17px]"
          />
        )}
      </div>

      <ul className="mt-3 grid grid-cols-7 gap-1.5" aria-label="표정별 확률">
        {FACE_KEYS.map((key) => {
          const value = reading ? reading.probabilities[key] : null;
          const strong = reading?.dominant === key;
          return (
            <li key={key} className="min-w-0 text-center">
              <span className={`block truncate text-[12px] font-semibold ${strong ? "text-grey-900" : "text-grey-600"}`}>
                {FACE_LABEL_KO[key]}
              </span>
              <span
                aria-hidden="true"
                className={`block h-[18px] text-[13px] font-bold tabular-nums ${strong ? "text-grey-900" : "text-grey-700"}`}
              >
                {value === null ? "" : formatPercent(value)}
              </span>
              <Meter faceKey={key} value={value} strong={strong} surface="light" className="mt-1 h-1" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
