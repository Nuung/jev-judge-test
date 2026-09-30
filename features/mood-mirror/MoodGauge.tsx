// 기분 판정 결과 카드. 헤드라인 → 불일치 알림 → 6종 확률 막대 → 맞춤 추천 행 순서다.
// 헤드라인, 알림, 추천은 줄지 않고(shrink-0) 막대 목록만 남는 높이를 나눠 가지므로, 화면이 낮아도 핵심이 잘리지 않는다.
// 결과 전(빈 상태)과 요청 중(스켈레톤)에도 같은 골격을 그려 레이아웃이 흔들리지 않는다.
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { MOOD_KEYS, MOOD_LABEL_KO } from "@/lib/judge/labels";
import type { Decision } from "@/lib/judge/schema";
import { formatMs, formatPercent } from "./format";
import { GuardrailBadge } from "./GuardrailBadge";
import { BAR_ROW_CLASS, ProbabilityRow } from "./ProbabilityRow";
import { ReactionHint } from "./ReactionCard";

/**
 * 막대 목록. 남는 높이만 차지하고, 그래도 모자라면 목록 안에서만 스크롤한다.
 * 행은 남는 높이를 나눠 갖되 BAR_ROW_CLASS 상한(44px)까지만 늘어나 카드가 비어 보이지 않게 한다.
 */
const BARS_CLASS = "flex min-h-0 flex-1 flex-col overflow-y-auto";
const HEADLINE_CLASS = "text-[28px] leading-[1.25] font-bold tracking-[-0.02em] text-grey-900 lg:text-[30px] short:text-[26px]";

/** 결과, 빈 상태, 스켈레톤이 공유하는 카드 골격 */
function GaugeFrame({
  showCaption,
  aside,
  headline,
  notice,
  bars,
  footer,
  footerClassName = "",
}: {
  /** "지금 기분은" 캡션은 결과가 있을 때만 보인다(그 외에는 스크린리더용 제목으로만 남긴다) */
  showCaption: boolean;
  aside?: ReactNode;
  headline: ReactNode;
  notice?: ReactNode;
  bars: ReactNode;
  footer?: ReactNode;
  footerClassName?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 short:gap-2.5">
      <div className="shrink-0 space-y-1.5">
        {showCaption ? (
          <div className="flex min-h-7 items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-grey-600">지금 기분은</h2>
            {aside}
          </div>
        ) : (
          <h2 className="sr-only">기분 판정 결과</h2>
        )}
        {headline}
      </div>
      {notice && <div className="shrink-0">{notice}</div>}
      {bars}
      {footer && (
        <div className={`shrink-0 border-t border-grey-100 pt-4 short:pt-3 ${footerClassName}`}>{footer}</div>
      )}
    </div>
  );
}

/** 판정 메타 한 줄. 평소엔 응답 시간만 보이고 "자세히"를 펼치면 모델, 확신, 가드레일 수치가 나온다 */
function DecisionMeta({
  decision,
  model,
  latencyMs,
  roundTripMs,
}: {
  decision: Decision;
  model: string;
  latencyMs: number;
  roundTripMs: number;
}) {
  const { mood, guardrail, reaction } = decision;
  const lowConfidence = reaction.status === "shown" && reaction.lowConfidence;
  const details: readonly { label: string; value: string }[] = [
    { label: "확신", value: formatPercent(mood.confidence) },
    { label: "인젝션", value: formatPercent(guardrail.injection) },
    { label: "유해", value: formatPercent(guardrail.harmful) },
    { label: "왕복", value: formatMs(roundTripMs) },
    { label: "모델", value: model },
  ];

  return (
    <details className="group text-[13px] font-medium text-grey-600">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md [&::-webkit-details-marker]:hidden">
        <span>
          Jev가 {formatMs(latencyMs)} 만에 판정했어요
          {lowConfidence && ". 확신이 낮아요"}
        </span>
        <span className="ml-1 font-semibold text-grey-700">자세히</span>
        <ChevronDown
          size={14}
          strokeWidth={2.25}
          aria-hidden="true"
          className="text-grey-600 transition-transform group-open:rotate-180"
        />
      </summary>
      <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {details.map((item) => (
          <div key={item.label} className="flex min-w-0 items-baseline gap-1">
            <dt>{item.label}</dt>
            <dd className="truncate font-semibold text-grey-800 tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

interface MoodGaugeProps {
  decision: Decision;
  model: string;
  latencyMs: number;
  roundTripMs: number;
  /** 표정과 말 불일치 알림. 가드레일이 안전할 때만 보인다 */
  insight: ReactNode;
  /** 결과 카드 마지막 행(맞춤 추천) */
  footer: ReactNode;
}

export function MoodGauge({ decision, model, latencyMs, roundTripMs, insight, footer }: MoodGaugeProps) {
  const { mood, guardrail } = decision;
  // 주의와 경고 입력은 기분을 단정하지 않고 판정 보류로 보여준다(막대는 참고용으로 흐리게, 불일치 알림은 숨김)
  const withheld = guardrail.status !== "safe";
  const withheldReason =
    guardrail.injection >= guardrail.harmful
      ? "다른 지시가 섞인 문장 같아요."
      : "민감한 내용이 담긴 것 같아요.";
  const meta = <DecisionMeta decision={decision} model={model} latencyMs={latencyMs} roundTripMs={roundTripMs} />;

  return (
    <GaugeFrame
      showCaption
      aside={<GuardrailBadge guardrail={guardrail} />}
      headline={
        withheld ? (
          <div className="space-y-1">
            <p className={HEADLINE_CLASS}>이 입력은 판정을 보류했어요</p>
            <p className="text-[15px] font-medium text-grey-700">{withheldReason} 막대는 참고용이에요.</p>
            {meta}
          </div>
        ) : (
          <div className="space-y-1">
            <p className={HEADLINE_CLASS}>{MOOD_LABEL_KO[mood.choice]}에 가까워요</p>
            {meta}
          </div>
        )
      }
      notice={withheld ? undefined : insight}
      bars={
        <ul className={`${BARS_CLASS} ${withheld ? "opacity-40" : ""}`} aria-label="기분별 확률">
          {MOOD_KEYS.map((key) => (
            <ProbabilityRow
              key={key}
              label={MOOD_LABEL_KO[key]}
              value={mood.probabilities[key]}
              ariaLabel={`${MOOD_LABEL_KO[key]} 확률`}
              emphasized={key === mood.choice}
            />
          ))}
        </ul>
      }
      footer={footer}
    />
  );
}

interface MoodGaugePlaceholderProps {
  loading: boolean;
  /** 에러 안내. 헤드라인 바로 아래에 둔다 */
  notice?: ReactNode;
}

/**
 * 결과 전(빈 상태)과 요청 중(스켈레톤).
 * 모바일 빈 상태에서는 빈 막대를 숨기고 헤드라인만 짧게 둬서 첫 화면에 입력창이 보이게 한다.
 */
export function MoodGaugePlaceholder({ loading, notice }: MoodGaugePlaceholderProps) {
  const block = loading ? "animate-shimmer bg-grey-100" : "bg-grey-200";

  return (
    <GaugeFrame
      showCaption={false}
      headline={
        loading ? (
          <>
            <p className="sr-only">기분을 살펴보고 있어요.</p>
            <div aria-hidden="true" className="space-y-2.5 pt-1">
              <div className={`h-9 w-60 rounded-xl ${block}`} />
              <div className={`h-5 w-44 rounded-lg ${block}`} />
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[22px] leading-[1.3] font-bold tracking-[-0.02em] text-grey-900 lg:text-[30px] lg:leading-[1.25] short:lg:text-[26px]">
              한마디 적고{" "}
              <br className="max-lg:hidden" />
              기분을 살펴보세요
            </p>
            <p className="text-[15px] font-medium text-grey-700 max-lg:hidden">
              표정과 말을 함께 보고 6가지 기분 중 가장 가까운 걸 골라요.
            </p>
          </div>
        )
      }
      notice={notice}
      bars={
        <ul aria-hidden="true" className={`${BARS_CLASS} ${loading ? "" : "max-lg:hidden"}`}>
          {MOOD_KEYS.map((key) => (
            <li key={key} className={`grid grid-cols-[2.75rem_1fr_3rem] items-center gap-3 ${BAR_ROW_CLASS}`}>
              <span className="text-[15px] font-medium text-grey-500">{MOOD_LABEL_KO[key]}</span>
              <span className={`block h-2.5 rounded-full ${block}`} />
              <span />
            </li>
          ))}
        </ul>
      }
      // 추천이 뜰 자리를 미리 보여 준다. 모바일 빈 상태에서는 입력창이 먼저 보이도록 숨긴다
      footer={<ReactionHint />}
      footerClassName={loading ? "" : "max-lg:hidden"}
    />
  );
}
