// 화면에 쓰는 숫자 포맷. FaceBars, GuardrailBadge, MoodGauge가 같이 쓴다.

/**
 * 확률(0~1)을 정수 퍼센트로 바꾼다.
 * 항목마다 따로 반올림하므로 여러 값의 합이 100에서 1~2 벗어날 수 있다. 표시 전용이라 보정하지 않는다.
 */
export function toPercent(value: number): number {
  return Math.round(value * 100);
}

/** 확률(0~1)을 퍼센트 문자열로 바꾼다 */
export function formatPercent(value: number): string {
  return `${toPercent(value)}%`;
}

/** 밀리초를 반올림한 "280ms" 형태로 바꾼다 */
export function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}
