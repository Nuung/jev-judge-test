// KLUE-YNAT(klue/klue, ynat) validation 9,107건. 한국 뉴스 헤드라인 섹션 7클래스(불균형, 비례 층화).
// 라벨은 영어 이름으로 묻고 기준에 원 한국어 라벨명을 병기한다(tasks.ts).
import { z } from "zod";
import { KLUE_YNAT_LABELS, KLUE_YNAT_TASK } from "../tasks";
import type { DatasetSpec } from "../types";

const RowSchema = z.object({
  title: z.string(),
  label: z.number().int().min(0).max(KLUE_YNAT_LABELS.length - 1),
});
type KlueYnatRow = z.infer<typeof RowSchema>;

export const klueYnat: DatasetSpec<KlueYnatRow> = {
  id: "klue-ynat",
  tier: "default",
  source: { kind: "hf", repo: "klue/klue", config: "ynat", split: "validation", requiresToken: false },
  license: "cc-by-sa-4.0",
  tasks: [KLUE_YNAT_TASK],
  rowSchema: RowSchema,
  toCase(row, rowIndex) {
    const label = KLUE_YNAT_LABELS[row.label];
    return { id: String(rowIndex), state: { headline: row.title }, gold: { [KLUE_YNAT_TASK.name]: label }, stratum: label };
  },
  primaryMetric: "macro_f1",
};
