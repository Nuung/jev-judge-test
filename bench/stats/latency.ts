// 지연 — nearest-rank p50/p95. 계획 §4 지연(N3): 성공 && 시도 1회인 호출만 표본으로 쓴다.
// 캐시 적중 호출은 캐시에 저장된 원 attempts를 쓰므로 이전 실행 측정 비율을 함께 낸다.
import type { Attempt } from "../types";

/** 부동소수 오차 보정(bootstrap의 inverted_cdf와 같은 규칙) */
const RANK_EPSILON = 1e-9;

/** nearest-rank 백분위(p는 0~100). 순위 = max(1, ⌈p/100·n⌉) */
export function nearestRank(values: readonly number[], p: number): number | null {
  if (!(p >= 0 && p <= 100)) throw new RangeError(`p는 [0, 100]이어야 한다: ${p}`);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p * sorted.length) / 100 - RANK_EPSILON));
  return sorted[rank - 1];
}

/** 지연 집계에 필요한 호출 결과(JudgeOutcome과 호환) */
export interface LatencyCall {
  readonly ok: boolean;
  readonly cached: boolean;
  readonly attempts: readonly Attempt[];
}

export interface LatencySummary {
  /** 표본 수(성공 && 시도 1회) */
  readonly n: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  /** 재시도가 발생한(시도 2회 이상) 호출 수 — 성공·실패 모두 */
  readonly retriedCalls: number;
  /** 표본 중 캐시 적중(이전 실행 측정) 비율(n=0이면 null) */
  readonly priorMeasurementShare: number | null;
}

export function summarizeLatency(calls: readonly LatencyCall[]): LatencySummary {
  const eligible = calls.filter((call) => call.ok && call.attempts.length === 1);
  const ms = eligible.map((call) => call.attempts[0].ms);
  const cached = eligible.filter((call) => call.cached).length;
  return {
    n: eligible.length,
    p50Ms: nearestRank(ms, 50),
    p95Ms: nearestRank(ms, 95),
    retriedCalls: calls.filter((call) => call.attempts.length > 1).length,
    priorMeasurementShare: eligible.length === 0 ? null : cached / eligible.length,
  };
}
