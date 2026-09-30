// 분류 지표: accuracy, 이진 F1(양성), macro-F1(라벨 체계 전체). 계획 §4 주지표와 ITT.
// 실패(모든 errorKind)는 abstain(null)이다: accuracy에서는 오답, F1과 macro-F1에서는 정답 클래스의 FN으로만 세고
// 어느 클래스에도 FP를 더하지 않는다. 분모가 0인 F1은 0(sklearn zero_division=0과 동일).
import type { GoldValue, PrimaryMetric } from "../types";

/** 채점 입력. pred의 null은 abstain(호출 실패) */
export interface ScoredCases<L extends GoldValue> {
  /** 라벨 체계 전체(macro-F1 고정 클래스 목록). Noul이면 [true, false] */
  readonly labels: readonly L[];
  /** f1_positive의 양성 라벨(Noul이면 true) */
  readonly positive?: L;
  readonly gold: readonly L[];
  readonly pred: readonly (L | null)[];
}

/** 재표집 인덱스(중복 허용) → 지표 값 */
export type Statistic = (indices: readonly number[]) => number;

/** 주지표 값과 병기용 성공 기준 수치 */
export interface MetricSummary {
  readonly metric: PrimaryMetric;
  /** ITT(실패=abstain) 값. 주지표 */
  readonly value: number;
  /** 성공 케이스만으로 계산한 값(성공 0건이면 null) */
  readonly successOnly: number | null;
  readonly n: number;
  readonly failures: number;
  /** 실패율(n=0이면 0) */
  readonly failureRate: number;
}

const ABSTAIN = -1;

interface Encoded {
  readonly k: number;
  readonly gold: Int32Array;
  readonly pred: Int32Array;
}

function encode<L extends GoldValue>(cases: ScoredCases<L>): Encoded {
  if (cases.gold.length !== cases.pred.length) {
    throw new RangeError(`gold(${cases.gold.length})와 pred(${cases.pred.length}) 길이가 다르다`);
  }
  const codes = new Map<L, number>();
  cases.labels.forEach((label, i) => {
    if (codes.has(label)) throw new RangeError(`라벨 중복: ${String(label)}`);
    codes.set(label, i);
  });
  const codeOf = (label: L): number => {
    const code = codes.get(label);
    if (code === undefined) throw new RangeError(`라벨 체계에 없는 값: ${String(label)}`);
    return code;
  };
  return {
    k: cases.labels.length,
    gold: Int32Array.from(cases.gold, codeOf),
    pred: Int32Array.from(cases.pred, (p) => (p === null ? ABSTAIN : codeOf(p))),
  };
}

function f1(tp: number, fp: number, fn: number): number {
  const denom = 2 * tp + fp + fn;
  return denom === 0 ? 0 : (2 * tp) / denom;
}

function accuracyOf(e: Encoded, indices: readonly number[]): number {
  if (indices.length === 0) return 0;
  let hit = 0;
  for (const i of indices) if (e.pred[i] === e.gold[i]) hit++;
  return hit / indices.length;
}

function binaryF1Of(e: Encoded, positive: number, indices: readonly number[]): number {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const i of indices) {
    const g = e.gold[i] === positive;
    const p = e.pred[i] === positive;
    if (g && p) tp++;
    else if (p) fp++;
    else if (g) fn++;
  }
  return f1(tp, fp, fn);
}

function macroF1Of(e: Encoded, indices: readonly number[]): number {
  if (e.k === 0) return 0;
  const tp = new Int32Array(e.k);
  const fp = new Int32Array(e.k);
  const fn = new Int32Array(e.k);
  for (const i of indices) {
    const g = e.gold[i];
    const p = e.pred[i];
    if (p === g) {
      tp[g]++;
    } else {
      fn[g]++;
      // abstain은 FP를 더하지 않는다
      if (p !== ABSTAIN) fp[p]++;
    }
  }
  let sum = 0;
  for (let c = 0; c < e.k; c++) sum += f1(tp[c], fp[c], fn[c]);
  return sum / e.k;
}

function positiveCode<L extends GoldValue>(cases: ScoredCases<L>): number {
  if (cases.positive === undefined) throw new RangeError("f1_positive에는 positive 라벨이 필요하다");
  const code = cases.labels.indexOf(cases.positive);
  if (code < 0) throw new RangeError(`양성 라벨이 라벨 체계에 없다: ${String(cases.positive)}`);
  return code;
}

/** 지표를 재표집 인덱스의 함수로 만든다(라벨 부호화는 한 번만). bootstrap용 */
export function metricStatistic<L extends GoldValue>(metric: PrimaryMetric, cases: ScoredCases<L>): Statistic {
  const e = encode(cases);
  switch (metric) {
    case "accuracy":
      return (indices) => accuracyOf(e, indices);
    case "f1_positive": {
      const positive = positiveCode(cases);
      return (indices) => binaryF1Of(e, positive, indices);
    }
    case "macro_f1":
      return (indices) => macroF1Of(e, indices);
  }
}

/** 0..n-1 */
export function allIndices(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** accuracy(abstain = 오답) */
export function accuracy<L extends GoldValue>(gold: readonly L[], pred: readonly (L | null)[]): number {
  if (gold.length !== pred.length) throw new RangeError("gold와 pred 길이가 다르다");
  if (gold.length === 0) return 0;
  let hit = 0;
  gold.forEach((g, i) => {
    if (pred[i] === g) hit++;
  });
  return hit / gold.length;
}

/** 이진 F1(양성 클래스). abstain은 gold가 양성일 때만 FN */
export function binaryF1<L extends GoldValue>(
  gold: readonly L[],
  pred: readonly (L | null)[],
  positive: L,
): number {
  if (gold.length !== pred.length) throw new RangeError("gold와 pred 길이가 다르다");
  let tp = 0;
  let fp = 0;
  let fn = 0;
  gold.forEach((g, i) => {
    const p = pred[i];
    if (g === positive && p === positive) tp++;
    else if (p === positive) fp++;
    else if (g === positive) fn++;
  });
  return f1(tp, fp, fn);
}

/** macro-F1(라벨 체계 전체를 고정 클래스로, 빈 클래스 F1=0 포함) */
export function macroF1<L extends GoldValue>(
  labels: readonly L[],
  gold: readonly L[],
  pred: readonly (L | null)[],
): number {
  return metricStatistic("macro_f1", { labels, gold, pred })(allIndices(gold.length));
}

/** 주지표(ITT)와 성공 기준 수치, 실패율을 함께 낸다 */
export function summarizeMetric<L extends GoldValue>(metric: PrimaryMetric, cases: ScoredCases<L>): MetricSummary {
  const n = cases.gold.length;
  const value = metricStatistic(metric, cases)(allIndices(n));
  const succeeded = allIndices(n).filter((i) => cases.pred[i] !== null);
  const successOnly =
    succeeded.length === 0
      ? null
      : metricStatistic(metric, {
          ...cases,
          gold: succeeded.map((i) => cases.gold[i]),
          pred: succeeded.map((i) => cases.pred[i]),
        })(allIndices(succeeded.length));
  const failures = n - succeeded.length;
  return { metric, value, successOnly, n, failures, failureRate: n === 0 ? 0 : failures / n };
}
