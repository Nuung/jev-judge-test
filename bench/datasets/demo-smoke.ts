// demo-smoke: 데모 평가셋 41건(로컬). 질문은 lib/jev/questions.ts의 JUDGE_QUESTIONS에서 4문항만 골라 재export한다
// (반응 6문항 제외, 복제와 수정 금지). 지표는 decide() 적용 전 원시 답 기준 범용 Choice/Noul 지표다.
import { z } from "zod";
import { buildState, JUDGE_QUESTIONS } from "@/lib/jev/questions";
import { MOOD_KEYS } from "@/lib/judge/labels";
import { FaceProbabilitiesSchema } from "@/lib/judge/schema";
import { loadRows } from "../data/store";
import type { BenchCase, ChoiceTask, DatasetSpec, GoldValue, NoulTask } from "../types";

export const DEMO_SMOKE_TASKS = {
  mood: { name: "mood", kind: "choice", labels: MOOD_KEYS, question: JUDGE_QUESTIONS.mood },
  prompt_injection: { name: "prompt_injection", kind: "noul", question: JUDGE_QUESTIONS.prompt_injection },
  harmful_content: { name: "harmful_content", kind: "noul", question: JUDGE_QUESTIONS.harmful_content },
  mismatch: { name: "mismatch", kind: "noul", question: JUDGE_QUESTIONS.mismatch },
} as const satisfies Record<string, ChoiceTask | NoulTask>;

const CATEGORIES = ["mood", "injection", "harmful", "benign_lookalike", "mismatch", "consistent_face"] as const;

const RowSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CATEGORIES),
  text: z.string().min(1),
  face: FaceProbabilitiesSchema.nullable(),
  /** 라벨이 애매한 경계 사례. 지표에서 빼고 관찰로만 보여 준다 */
  boundary: z.boolean().optional(),
  labels: z.object({
    mood: z.enum(MOOD_KEYS).nullable(),
    guardrail: z.boolean(),
    mismatch: z.boolean().nullable(),
  }),
});
type DemoSmokeRow = z.infer<typeof RowSchema>;

/**
 * 기존 labels → 과제별 정답. guardrail은 차단 대상 여부 하나뿐이라 category로 나눈다:
 * injection 케이스는 prompt_injection만, harmful 케이스는 harmful_content만 true로 두고 다른 쪽은 정답을 두지 않는다
 * (탈옥성 유해 요청처럼 두 질문에 걸칠 수 있어 false로 단정하지 않는다). guardrail이 false면 둘 다 false.
 */
function goldOf(row: DemoSmokeRow): Record<string, GoldValue> {
  const gold: Record<string, GoldValue> = {};
  if (row.labels.mood !== null) gold[DEMO_SMOKE_TASKS.mood.name] = row.labels.mood;
  if (!row.labels.guardrail) {
    gold[DEMO_SMOKE_TASKS.prompt_injection.name] = false;
    gold[DEMO_SMOKE_TASKS.harmful_content.name] = false;
  } else if (row.category === "injection") {
    gold[DEMO_SMOKE_TASKS.prompt_injection.name] = true;
  } else if (row.category === "harmful") {
    gold[DEMO_SMOKE_TASKS.harmful_content.name] = true;
  }
  if (row.labels.mismatch !== null) gold[DEMO_SMOKE_TASKS.mismatch.name] = row.labels.mismatch;
  return gold;
}

export const demoSmoke: DatasetSpec<DemoSmokeRow> = {
  id: "demo-smoke",
  tier: "smoke",
  source: { kind: "local", path: "bench/datasets/demo-smoke.ko.json" },
  license: "자체 제작(저장소 포함)",
  tasks: Object.values(DEMO_SMOKE_TASKS),
  rowSchema: RowSchema,
  toCase(row): BenchCase {
    return {
      id: row.id,
      state: buildState({ text: row.text, face: row.face }),
      gold: goldOf(row),
      stratum: row.category,
    };
  },
  primaryMetric: "accuracy",
};

/** 경계 사례 id. 지표에서 빼고 summary의 관찰 섹션에만 보여 준다 */
export async function loadDemoSmokeBoundaryIds(): Promise<ReadonlySet<string>> {
  const result = await loadRows(demoSmoke);
  if (!result.ok) throw new Error(`demo-smoke를 읽을 수 없습니다: ${result.skipReason}`);
  return new Set(result.rows.filter(({ row }) => row.boundary === true).map(({ row }) => row.id));
}
