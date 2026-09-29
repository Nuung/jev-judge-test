// 결정적 난수 — mulberry32. 표본 추출·bootstrap 재표집이 같은 생성기를 쓴다(계획 §4 PRNG).
// 시드는 BENCH_SEED에서 (용도, 데이터셋, 모델) 문자열 해시로 파생한다.

/** 벤치 전체 기준 시드(summary.md에 명시) */
export const BENCH_SEED = 20260929;

/** [0, 1) 균등 난수를 내는 함수 */
export type Rng = () => number;

/** mulberry32 — 32비트 상태, 같은 시드면 같은 수열 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32비트(UTF-8 바이트 기준) — 다른 언어에서도 같은 값을 재현할 수 있다 */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}

/** 기준 시드와 용도·데이터셋·모델 등 문자열로 하위 시드를 파생한다(구분자 U+001F) */
export function deriveSeed(baseSeed: number, ...parts: readonly string[]): number {
  return hashString([String(baseSeed), ...parts].join("\u001f"));
}

/** [0, n) 정수 */
export function randomInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Fisher–Yates로 섞은 새 배열(원본 불변) */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
