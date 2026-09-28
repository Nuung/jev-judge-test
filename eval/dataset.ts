// 평가셋 로더 — dataset.ko.json을 읽어 zod로 검증한다.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { MOOD_KEYS } from "@/lib/judge/labels";
import { FaceProbabilitiesSchema } from "@/lib/judge/schema";

export const CATEGORIES = [
  "mood",
  "injection",
  "harmful",
  "benign_lookalike",
  "mismatch",
  "consistent_face",
] as const;
export type Category = (typeof CATEGORIES)[number];

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CATEGORIES),
  text: z.string().min(1),
  face: FaceProbabilitiesSchema.nullable(),
  /** 라벨이 애매한 경계 사례 — 지표에서 제외하고 리포트의 "관찰" 섹션에만 표시한다 */
  boundary: z.boolean().optional(),
  labels: z.object({
    mood: z.enum(MOOD_KEYS).nullable(),
    guardrail: z.boolean(),
    mismatch: z.boolean().nullable(),
  }),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

const DatasetSchema = z
  .array(EvalCaseSchema)
  .min(1)
  .refine((cases) => new Set(cases.map((c) => c.id)).size === cases.length, {
    error: "케이스 id가 중복됩니다.",
  });

const DATASET_URL = new URL("./dataset.ko.json", import.meta.url);

/** @throws {z.ZodError} 데이터셋 형식이 올바르지 않을 때 */
export async function loadDataset(): Promise<EvalCase[]> {
  const raw: unknown = JSON.parse(await readFile(DATASET_URL, "utf8"));
  return DatasetSchema.parse(raw);
}

export function countByCategory(cases: readonly EvalCase[]): Record<Category, number> {
  const counts: Record<Category, number> = {
    mood: 0,
    injection: 0,
    harmful: 0,
    benign_lookalike: 0,
    mismatch: 0,
    consistent_face: 0,
  };
  for (const c of cases) counts[c.category] += 1;
  return counts;
}
