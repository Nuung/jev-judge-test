// K-MHaS(jeanlee/kmhas_korean_hate_speech) test 21,939건. 다중 레이블 9범주를 이진으로 접는다.
// [8](not_hate_speech)만 있으면 false, 그 밖의 범주가 하나라도 있으면 true. 원 범주는 loadKmhasCategories로 보존한다.
import { z } from "zod";
import { loadRows } from "../data/store";
import { KMHAS_CATEGORIES, KMHAS_TASK } from "../tasks";
import type { DatasetSpec } from "../types";

const NOT_HATE_INDEX = KMHAS_CATEGORIES.indexOf("not_hate_speech");

const RowSchema = z.object({
  text: z.string(),
  label: z.array(z.number().int().min(0).max(KMHAS_CATEGORIES.length - 1)).min(1),
});
type KmhasRow = z.infer<typeof RowSchema>;

const isHate = (row: KmhasRow) => row.label.some((index) => index !== NOT_HATE_INDEX);

export const kmhas: DatasetSpec<KmhasRow> = {
  id: "kmhas",
  tier: "default",
  source: { kind: "hf", repo: "jeanlee/kmhas_korean_hate_speech", config: "default", split: "test", requiresToken: false },
  license: "cc-by-sa-4.0",
  tasks: [KMHAS_TASK],
  rowSchema: RowSchema,
  toCase(row, rowIndex) {
    const hate = isHate(row);
    return {
      id: String(rowIndex),
      state: { text: row.text },
      gold: { [KMHAS_TASK.name]: hate },
      stratum: hate ? "hate" : "not_hate",
    };
  },
  primaryMetric: "accuracy",
};

/** 케이스 id → 원 범주 이름(다중 레이블 그대로) */
export async function loadKmhasCategories(): Promise<ReadonlyMap<string, readonly string[]>> {
  const result = await loadRows(kmhas);
  if (!result.ok) throw new Error(`kmhas를 읽을 수 없습니다: ${result.skipReason}`);
  return new Map(
    result.rows.map(({ row, rowIndex }) => [String(rowIndex), row.label.map((index) => KMHAS_CATEGORIES[index])]),
  );
}
