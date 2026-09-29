// JailbreakBench judge_comparison(JailbreakBench/JBB-Behaviors) test 300건 — 응답이 유해 요청을 조력했는가.
// state는 {request: goal, response: target_response}이고 탈옥 프롬프트(prompt)는 넣지 않는다(오염·길이 방지, run.json·summary에 기록).
// 정답은 사람 3인 다수결(human_majority). 공개 judge 판정 열은 이 파일만 기준 행용으로 내보낸다.
import { z } from "zod";
import { loadRows } from "../data/store";
import { JBB_JUDGE_TASK } from "../tasks";
import type { DatasetSpec } from "../types";

const binary = z.union([z.literal(0), z.literal(1)]);

/** 공개 기준 judge 열 → 표시 이름 */
export const JBB_REFERENCE_JUDGES = {
  harmbench_cf: "HarmBench classifier",
  gpt4_cf: "GPT-4",
  llamaguard2_cf: "Llama Guard 2",
  llama3_cf: "Llama 3 70B",
} as const;
export type JbbReferenceJudge = keyof typeof JBB_REFERENCE_JUDGES;

/** run.json·summary에 남길 state 구성 설명 */
export const JBB_STATE_NOTE = "state = {request: goal, response: target_response}, 탈옥 프롬프트(prompt) 열은 제외";

const RowSchema = z.object({
  goal: z.string(),
  target_response: z.string(),
  human_majority: binary,
  harmbench_cf: binary,
  gpt4_cf: binary,
  llamaguard2_cf: binary,
  llama3_cf: binary,
});
type JbbRow = z.infer<typeof RowSchema>;

export const jbbJudge: DatasetSpec<JbbRow> = {
  id: "jbb-judge",
  tier: "default",
  source: {
    kind: "hf",
    repo: "JailbreakBench/JBB-Behaviors",
    config: "judge_comparison",
    split: "test",
    requiresToken: false,
  },
  license: "MIT",
  tasks: [JBB_JUDGE_TASK],
  rowSchema: RowSchema,
  toCase(row, rowIndex) {
    const harmful = row.human_majority === 1;
    return {
      id: String(rowIndex),
      state: { request: row.goal, response: row.target_response },
      gold: { [JBB_JUDGE_TASK.name]: harmful },
      stratum: harmful ? "jailbroken" : "not_jailbroken",
    };
  },
  primaryMetric: "accuracy",
};

/** 케이스 id → 공개 judge별 판정(1 → true). 같은 표본에서 기준 행을 다시 계산하는 데 쓴다 */
export async function loadJbbReferenceBaselines(): Promise<
  ReadonlyMap<string, Readonly<Record<JbbReferenceJudge, boolean>>>
> {
  const result = await loadRows(jbbJudge);
  if (!result.ok) throw new Error(`jbb-judge를 읽을 수 없습니다: ${result.skipReason}`);
  return new Map(
    result.rows.map(({ row, rowIndex }) => [
      String(rowIndex),
      {
        harmbench_cf: row.harmbench_cf === 1,
        gpt4_cf: row.gpt4_cf === 1,
        llamaguard2_cf: row.llamaguard2_cf === 1,
        llama3_cf: row.llama3_cf === 1,
      },
    ]),
  );
}
