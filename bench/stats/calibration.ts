// 보정 — Brier(주), ECE 15 등간격 bin(보조)과 신뢰도 곡선 bin 데이터. 계획 §4 보정.
// Choice는 top-label(선택 라벨의 확률 vs 정답 여부), Noul은 p(true)(vs gold가 true인지)로 분리한다.
// bin 규칙: index = min(⌊conf·15⌋, 14) → conf = 1.0은 마지막 bin.
import type { ChoiceAnswer, NoulAnswer, ProbabilitySource } from "../types";

export const ECE_BINS = 15;

export type CalibrationKind = "choice-top-label" | "noul-p-true";

/** 확률 하나와 그 사건의 실제 발생 여부 */
export interface CalibrationPoint {
  readonly probability: number;
  readonly outcome: boolean;
}

export interface ReliabilityBin {
  readonly index: number;
  readonly lower: number;
  readonly upper: number;
  readonly n: number;
  /** 평균 확률(n=0이면 null) */
  readonly meanProbability: number | null;
  /** 실제 발생 비율(n=0이면 null) */
  readonly observedRate: number | null;
}

export interface CalibrationSummary {
  readonly kind: CalibrationKind;
  readonly source: ProbabilitySource;
  readonly n: number;
  /** n=0이면 null */
  readonly brier: number | null;
  readonly ece: number | null;
  readonly bins: readonly ReliabilityBin[];
}

/** Choice top-label: 선택 라벨의 확률, 선택이 정답인지 */
export function choiceTopLabelPoint(answer: ChoiceAnswer, gold: string): CalibrationPoint {
  return { probability: answer.probability, outcome: answer.choice === gold };
}

/** Noul p(true): p(true), gold가 true인지 */
export function noulPTruePoint(answer: NoulAnswer, gold: boolean): CalibrationPoint {
  return { probability: answer.probability, outcome: gold };
}

function checkPoints(points: readonly CalibrationPoint[]): void {
  points.forEach(({ probability }) => {
    if (!(probability >= 0 && probability <= 1)) throw new RangeError(`확률은 [0, 1]이어야 한다: ${probability}`);
  });
}

export function binIndex(probability: number, bins: number = ECE_BINS): number {
  return Math.min(Math.floor(probability * bins), bins - 1);
}

/** Brier = 평균 (p − y)² */
export function brier(points: readonly CalibrationPoint[]): number | null {
  checkPoints(points);
  if (points.length === 0) return null;
  const sum = points.reduce((acc, { probability, outcome }) => acc + (probability - (outcome ? 1 : 0)) ** 2, 0);
  return sum / points.length;
}

/** 신뢰도 곡선 bin 데이터(빈 bin 포함, bin별 n) */
export function reliabilityBins(points: readonly CalibrationPoint[], bins: number = ECE_BINS): ReliabilityBin[] {
  checkPoints(points);
  const count = new Array<number>(bins).fill(0);
  const probSum = new Array<number>(bins).fill(0);
  const hitSum = new Array<number>(bins).fill(0);
  points.forEach(({ probability, outcome }) => {
    const b = binIndex(probability, bins);
    count[b]++;
    probSum[b] += probability;
    if (outcome) hitSum[b]++;
  });
  return count.map((n, index) => ({
    index,
    lower: index / bins,
    upper: (index + 1) / bins,
    n,
    meanProbability: n === 0 ? null : probSum[index] / n,
    observedRate: n === 0 ? null : hitSum[index] / n,
  }));
}

/** ECE = Σ (n_b / N)·|관측 비율_b − 평균 확률_b| */
export function ece(points: readonly CalibrationPoint[], bins: number = ECE_BINS): number | null {
  if (points.length === 0) return null;
  return expectedCalibrationError(reliabilityBins(points, bins), points.length);
}

function expectedCalibrationError(bins: readonly ReliabilityBin[], total: number): number {
  return bins.reduce(
    (acc, bin) =>
      bin.meanProbability === null || bin.observedRate === null
        ? acc
        : acc + (bin.n / total) * Math.abs(bin.observedRate - bin.meanProbability),
    0,
  );
}

export function calibrate(
  kind: CalibrationKind,
  source: ProbabilitySource,
  points: readonly CalibrationPoint[],
  binCount: number = ECE_BINS,
): CalibrationSummary {
  const bins = reliabilityBins(points, binCount);
  const n = points.length;
  return {
    kind,
    source,
    n,
    brier: brier(points),
    ece: n === 0 ? null : expectedCalibrationError(bins, n),
    bins,
  };
}
