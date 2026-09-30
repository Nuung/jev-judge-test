// 층화 추출. 층별로 시드 셔플한 뒤 최대 나머지법으로 비례 배분한 수만큼 앞에서 뽑는다(계획 §5).
// 층마다 시드를 따로 파생하므로 n이 커져도 앞선 표본을 그대로 포함한다(부분집합 경향).
import { BENCH_SEED, deriveSeed, mulberry32, shuffled } from "../stats/prng";
import type { BenchCase, DatasetId } from "../types";

export interface StratumAllocation {
  /** 모집단 안 층 크기 */
  readonly population: number;
  readonly sampled: number;
}

export interface SampleResult {
  /** 뽑힌 케이스(모집단 순서 유지) */
  readonly cases: readonly BenchCase[];
  /** 층 이름 → 배분(층 이름 정렬) */
  readonly allocation: Readonly<Record<string, StratumAllocation>>;
  readonly baseSeed: number;
}

/** 최대 나머지법: 몫의 내림을 먼저 주고, 남는 수는 나머지가 큰 층부터(같으면 층 이름 순) 1씩 준다 */
function allocate(sizes: readonly (readonly [string, number])[], n: number): Map<string, number> {
  const total = sizes.reduce((sum, [, size]) => sum + size, 0);
  const quotas = sizes.map(([name, size]) => {
    const exact = (n * size) / total;
    return { name, base: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = n - quotas.reduce((sum, q) => sum + q.base, 0);
  const byRemainder = [...quotas].sort((a, b) => b.remainder - a.remainder || (a.name < b.name ? -1 : 1));
  const out = new Map(quotas.map((q) => [q.name, q.base]));
  for (const q of byRemainder) {
    if (left === 0) break;
    out.set(q.name, q.base + 1);
    left -= 1;
  }
  return out;
}

/** 케이스 모집단에서 n건을 층화 추출한다. n이 모집단 이상이면 전부 */
export function stratifiedSample(
  population: readonly BenchCase[],
  n: number,
  datasetId: DatasetId,
  baseSeed: number = BENCH_SEED,
): SampleResult {
  if (!Number.isInteger(n) || n < 1) throw new Error(`표본 수는 1 이상의 정수여야 합니다(받은 값 ${n}).`);

  const strata = new Map<string, BenchCase[]>();
  for (const c of population) {
    const members = strata.get(c.stratum);
    if (members === undefined) strata.set(c.stratum, [c]);
    else members.push(c);
  }
  const names = [...strata.keys()].sort();
  const target = Math.min(n, population.length);
  const counts = allocate(
    names.map((name) => [name, strata.get(name)?.length ?? 0] as const),
    target,
  );

  const picked = new Set<string>();
  const allocation: Record<string, StratumAllocation> = {};
  for (const name of names) {
    const members = strata.get(name) ?? [];
    const take = counts.get(name) ?? 0;
    const rng = mulberry32(deriveSeed(baseSeed, "sample", datasetId, name));
    for (const c of shuffled(members, rng).slice(0, take)) picked.add(c.id);
    allocation[name] = { population: members.length, sampled: take };
  }

  return { cases: population.filter((c) => picked.has(c.id)), allocation, baseSeed };
}
