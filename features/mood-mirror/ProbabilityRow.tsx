// 기분 확률 막대 한 행. 1위 막대만 Toss Blue(수치는 grey900)이고 나머지는 grey300이다. role="meter" 접근성 속성은 유지한다.
import { formatPercent } from "./format";

/** 막대 한 행의 높이. 목록의 남는 높이를 나눠 갖되 32–44px(낮은 화면은 20px부터) 안에 머문다 */
export const BAR_ROW_CLASS = "min-h-8 max-h-11 flex-1 short:min-h-5 short:leading-5";

interface ProbabilityRowProps {
  label: string;
  value: number;
  ariaLabel: string;
  /** 1위 항목 강조: 라벨·수치는 진하게, 막대만 Toss Blue */
  emphasized?: boolean;
}

export function ProbabilityRow({ label, value, ariaLabel, emphasized = false }: ProbabilityRowProps) {
  return (
    <li className={`grid grid-cols-[2.75rem_1fr_3rem] items-center gap-3 ${BAR_ROW_CLASS}`}>
      <span
        className={`text-[15px] ${emphasized ? "font-bold text-grey-900" : "font-medium text-grey-600"}`}
      >
        {label}
      </span>
      <span
        className="block h-2.5 overflow-hidden rounded-full bg-grey-200"
        role="meter"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <span
          className={`block h-full origin-left animate-bar-grow rounded-full ${emphasized ? "bg-toss-blue" : "bg-grey-300"}`}
          style={{ width: formatPercent(value) }}
        />
      </span>
      <span
        className={`text-right text-[15px] tabular-nums ${emphasized ? "font-bold text-grey-900" : "font-medium text-grey-600"}`}
      >
        {formatPercent(value)}
      </span>
    </li>
  );
}
