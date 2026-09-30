// paired bootstrap(계획 §4). 모든 모델이 같은 재표집 인덱스를 쓰고, 매 반복 주지표를 다시 계산한다.
// 모델 CI와 (모델 − 기준(Jev)) 차이 CI를 낸다. 백분위는 inverted_cdf로 고정한다.
import { mulberry32, randomInt } from "./prng";
import { allIndices, type Statistic } from "./metrics";

export const BOOTSTRAP_REPLICATES = 10_000;
export const CI_LEVEL = 0.95;

/** 부동소수 오차 보정(q×B가 정수인데 1e-15만큼 커져 순위가 하나 밀리는 것을 막는다) */
const RANK_EPSILON = 1e-9;

/**
 * inverted_cdf 백분위(numpy percentile method='inverted_cdf'와 동일).
 * 순위 = ⌈q×n − 1e-9⌉(1-based, 최소 1). values는 정렬하지 않아도 된다.
 */
export function percentileInvertedCdf(values: readonly number[], q: number): number {
  if (values.length === 0) throw new RangeError("빈 배열은 백분위를 구할 수 없다");
  if (!(q >= 0 && q <= 1)) throw new RangeError(`q는 [0, 1]이어야 한다: ${q}`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * sorted.length - RANK_EPSILON));
  return sorted[rank - 1];
}

export interface Interval {
  /** 원 표본 전체의 값 */
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
}

export interface BootstrapModel {
  readonly id: string;
  readonly statistic: Statistic;
}

export interface BootstrapInput {
  /** 케이스 수(모든 모델이 같은 케이스 순서) */
  readonly n: number;
  readonly models: readonly BootstrapModel[];
  /** 차이 기준 모델 id(Jev). null이면 차이 CI를 내지 않는다 */
  readonly reference: string | null;
  /** 데이터셋 단위로 파생한 시드. 모델별로 나누지 않아야 같은 인덱스를 공유한다 */
  readonly seed: number;
  readonly replicates?: number;
  readonly level?: number;
}

export interface BootstrapResult {
  readonly replicates: number;
  readonly level: number;
  readonly seed: number;
  /** 모델 id → CI */
  readonly models: Readonly<Record<string, Interval>>;
  /** 모델 id → (모델 − 기준) 차이 CI(기준 모델 자신은 제외) */
  readonly diffs: Readonly<Record<string, Interval>>;
}

export function pairedBootstrap(input: BootstrapInput): BootstrapResult {
  const replicates = input.replicates ?? BOOTSTRAP_REPLICATES;
  const level = input.level ?? CI_LEVEL;
  const { n, models, reference } = input;
  if (n <= 0) throw new RangeError("bootstrap에는 케이스가 1건 이상 필요하다");
  const refIndex = reference === null ? -1 : models.findIndex((m) => m.id === reference);
  if (reference !== null && refIndex < 0) throw new RangeError(`기준 모델이 없다: ${reference}`);

  const samples = models.map(() => new Array<number>(replicates));
  const rng = mulberry32(input.seed);
  const indices = new Array<number>(n);
  for (let b = 0; b < replicates; b++) {
    for (let i = 0; i < n; i++) indices[i] = randomInt(rng, n);
    models.forEach((m, k) => {
      samples[k][b] = m.statistic(indices);
    });
  }

  const alpha = (1 - level) / 2;
  const interval = (point: number, values: readonly number[]): Interval => ({
    point,
    lower: percentileInvertedCdf(values, alpha),
    upper: percentileInvertedCdf(values, 1 - alpha),
  });
  const full = allIndices(n);
  const points = models.map((m) => m.statistic(full));

  const modelIntervals: Record<string, Interval> = {};
  const diffIntervals: Record<string, Interval> = {};
  models.forEach((m, k) => {
    modelIntervals[m.id] = interval(points[k], samples[k]);
    if (refIndex < 0 || k === refIndex) return;
    const ref = samples[refIndex];
    diffIntervals[m.id] = interval(
      points[k] - points[refIndex],
      samples[k].map((v, b) => v - ref[b]),
    );
  });
  return { replicates, level, seed: input.seed, models: modelIntervals, diffs: diffIntervals };
}
