// Banking77(legacy-datasets/banking77) test 3,080건 — 은행 앱 의도 77클래스(각 40).
// PolyAI/banking77은 스크립트형이라 datasets-server로 받을 수 없어 같은 데이터의 legacy 경로를 쓴다.
import { z } from "zod";
import { BANKING77_LABELS, BANKING77_TASK } from "../tasks";
import type { DatasetSpec } from "../types";

const RowSchema = z.object({
  text: z.string(),
  label: z.number().int().min(0).max(BANKING77_LABELS.length - 1),
});
type Banking77Row = z.infer<typeof RowSchema>;

export const banking77: DatasetSpec<Banking77Row> = {
  id: "banking77",
  tier: "default",
  source: { kind: "hf", repo: "legacy-datasets/banking77", config: "default", split: "test", requiresToken: false },
  license: "cc-by-4.0",
  tasks: [BANKING77_TASK],
  rowSchema: RowSchema,
  toCase(row, rowIndex) {
    const label = BANKING77_LABELS[row.label];
    return { id: String(rowIndex), state: { text: row.text }, gold: { [BANKING77_TASK.name]: label }, stratum: label };
  },
  primaryMetric: "accuracy",
};
