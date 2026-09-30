// 정확 이항 McNemar(양측)와 Holm 보정(계획 §4).
// 방향 고정: b = Jev만 정답, c = LLM만 정답. p = min(1, 2×P(X ≤ min(b, c))), X ~ Bin(b + c, 0.5), b + c = 0이면 1.

const logFactorials: number[] = [0];

function logFactorial(n: number): number {
  for (let k = logFactorials.length; k <= n; k++) logFactorials[k] = logFactorials[k - 1] + Math.log(k);
  return logFactorials[n];
}

/** P(X ≤ k), X ~ Bin(n, 0.5). 로그 팩토리얼로 이항계수를 계산한다 */
export function binomCdfHalf(k: number, n: number): number {
  const logHalfPow = n * Math.log(0.5);
  let sum = 0;
  for (let i = 0; i <= k; i++) {
    sum += Math.exp(logFactorial(n) - logFactorial(i) - logFactorial(n - i) + logHalfPow);
  }
  return Math.min(1, sum);
}

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name}는 0 이상 정수여야 한다: ${value}`);
}

/** 정확 이항 McNemar 양측 p */
export function mcnemarExact(b: number, c: number): number {
  assertCount("b", b);
  assertCount("c", c);
  const n = b + c;
  if (n === 0) return 1;
  return Math.min(1, 2 * binomCdfHalf(Math.min(b, c), n));
}

export type McNemarVerdict = "jev" | "llm" | "tie";

export const VERDICT_TEXT: Readonly<Record<McNemarVerdict, string>> = {
  jev: "Jev 우세",
  llm: "LLM 우세",
  tie: "우열 없음",
};

export interface McNemarResult {
  /** Jev만 정답 */
  readonly b: number;
  /** LLM만 정답 */
  readonly c: number;
  readonly n: number;
  readonly p: number;
  /** (LLM − Jev) accuracy 차이 = (c − b) / n. 부호가 verdict와 일치한다 */
  readonly accuracyDiff: number;
  /** b > c면 jev, b < c면 llm */
  readonly verdict: McNemarVerdict;
  readonly verdictText: string;
}

/** 케이스별 정오(실패 = 오답)로 McNemar를 계산한다. 두 배열은 같은 케이스 순서 */
export function mcnemar(jevCorrect: readonly boolean[], llmCorrect: readonly boolean[]): McNemarResult {
  if (jevCorrect.length !== llmCorrect.length) throw new RangeError("Jev와 LLM의 케이스 수가 다르다");
  let b = 0;
  let c = 0;
  jevCorrect.forEach((jev, i) => {
    const llm = llmCorrect[i];
    if (jev && !llm) b++;
    else if (!jev && llm) c++;
  });
  const n = jevCorrect.length;
  const verdict: McNemarVerdict = b > c ? "jev" : b < c ? "llm" : "tie";
  return {
    b,
    c,
    n,
    p: mcnemarExact(b, c),
    accuracyDiff: n === 0 ? 0 : (c - b) / n,
    verdict,
    verdictText: VERDICT_TEXT[verdict],
  };
}

/** Holm 보정 p(단조 증가 보장, 1 상한). 입력과 같은 순서로 돌려준다 */
export function holm(pValues: readonly number[]): number[] {
  pValues.forEach((p) => {
    if (!(p >= 0 && p <= 1)) throw new RangeError(`p는 [0, 1]이어야 한다: ${p}`);
  });
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p || x.i - y.i);
  const adjusted = new Array<number>(m);
  let running = 0;
  order.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    adjusted[i] = running;
  });
  return adjusted;
}
