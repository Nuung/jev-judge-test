// AG News(fancyzhx/ag_news) test 7,600건 — 뉴스 섹션 4클래스(각 1,900).
import { z } from "zod";
import { AG_NEWS_LABELS, AG_NEWS_TASK } from "../tasks";
import type { DatasetSpec } from "../types";

const RowSchema = z.object({
  text: z.string(),
  label: z.number().int().min(0).max(AG_NEWS_LABELS.length - 1),
});
type AgNewsRow = z.infer<typeof RowSchema>;

export const agNews: DatasetSpec<AgNewsRow> = {
  id: "ag-news",
  tier: "default",
  source: { kind: "hf", repo: "fancyzhx/ag_news", config: "default", split: "test", requiresToken: false },
  license: "unknown",
  tasks: [AG_NEWS_TASK],
  rowSchema: RowSchema,
  toCase(row, rowIndex) {
    const label = AG_NEWS_LABELS[row.label];
    return { id: String(rowIndex), state: { text: row.text }, gold: { [AG_NEWS_TASK.name]: label }, stratum: label };
  },
  primaryMetric: "accuracy",
};
