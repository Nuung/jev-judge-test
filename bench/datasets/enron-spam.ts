// Enron 스팸(SetFit/enron_spam) test 2,000건 — 스팸 여부. 본문은 모든 모델에 같은 4,000자로 자른다.
import { z } from "zod";
import { loadRows } from "../data/store";
import { ENRON_SPAM_TASK } from "../tasks";
import type { DatasetSpec } from "../types";

/** 본문 절단 길이(평균 1,481자, 최대 115,782자) */
export const ENRON_BODY_MAX_CHARS = 4_000;

const RowSchema = z.object({
  subject: z.string(),
  message: z.string(),
  label: z.union([z.literal(0), z.literal(1)]),
});
type EnronRow = z.infer<typeof RowSchema>;

export const enronSpam: DatasetSpec<EnronRow> = {
  id: "enron-spam",
  tier: "default",
  source: { kind: "hf", repo: "SetFit/enron_spam", config: "default", split: "test", requiresToken: false },
  license: "표기 없음",
  tasks: [ENRON_SPAM_TASK],
  rowSchema: RowSchema,
  toCase(row, rowIndex) {
    const spam = row.label === 1;
    return {
      id: String(rowIndex),
      state: { subject: row.subject, body: row.message.slice(0, ENRON_BODY_MAX_CHARS) },
      gold: { [ENRON_SPAM_TASK.name]: spam },
      stratum: spam ? "spam" : "ham",
    };
  },
  primaryMetric: "accuracy",
  maxInputChars: ENRON_BODY_MAX_CHARS,
};

/**
 * 본문이 잘린 케이스 id — 4,000자 절단 또는 datasets-server 응답 크기 제한으로 잘린 셀.
 * 표본 id와 교집합을 세어 run.json·summary에 기록한다. 건너뜀이면 null.
 */
export async function loadEnronTruncatedIds(): Promise<ReadonlySet<string> | null> {
  const result = await loadRows(enronSpam);
  if (!result.ok) return null;
  const ids = new Set<string>();
  for (const { row, rowIndex, truncatedCells } of result.rows) {
    if (row.message.length > ENRON_BODY_MAX_CHARS || truncatedCells.length > 0) ids.add(String(rowIndex));
  }
  return ids;
}
