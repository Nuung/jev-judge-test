// SST-2(stanfordnlp/sst2) validation 872건. 영화 리뷰 문장 감성 2클래스. test는 라벨이 -1이라 쓰지 않는다.
import { z } from "zod";
import { SST2_LABELS, SST2_TASK } from "../tasks";
import type { DatasetSpec } from "../types";

const RowSchema = z.object({
  sentence: z.string(),
  label: z.number().int().min(0).max(SST2_LABELS.length - 1),
});
type Sst2Row = z.infer<typeof RowSchema>;

export const sst2: DatasetSpec<Sst2Row> = {
  id: "sst2",
  tier: "default",
  source: { kind: "hf", repo: "stanfordnlp/sst2", config: "default", split: "validation", requiresToken: false },
  license: "unknown",
  tasks: [SST2_TASK],
  rowSchema: RowSchema,
  toCase(row, rowIndex) {
    const label = SST2_LABELS[row.label];
    return { id: String(rowIndex), state: { text: row.sentence }, gold: { [SST2_TASK.name]: label }, stratum: label };
  },
  primaryMetric: "accuracy",
};
