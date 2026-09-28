// 평가 러너 공용 — 케이스 순차 실행과 에러 메시지 변환.
import type { EvalCase } from "./dataset";
import type { CaseResult } from "./metrics";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** 케이스를 하나씩 판정하며 진행 상황(. / x)을 출력한다. 첫 케이스 실패는 원인을 바로 보여 준다 */
export async function runSequential(
  label: string,
  cases: readonly EvalCase[],
  judge: (c: EvalCase) => Promise<CaseResult>,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const [index, c] of cases.entries()) {
    const result = await judge(c);
    if (!result.ok && index === 0) console.error(`[${label}] 첫 케이스(${c.id}) 실패: ${result.error}`);
    results.push(result);
    process.stdout.write(result.ok ? "." : "x");
  }
  process.stdout.write("\n");
  return results;
}
