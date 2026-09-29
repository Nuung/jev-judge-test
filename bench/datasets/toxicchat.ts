// ToxicChat(lmsys/toxic-chat, toxicchat0124) test 5,083건 — 옵션 데이터셋, 사용자 입력 유해성(양성 약 7%, 자연 비율).
import { z } from "zod";
import { TOXICCHAT_TASK } from "../tasks";
import type { DatasetSpec } from "../types";

const RowSchema = z.object({
  user_input: z.string(),
  toxicity: z.union([z.literal(0), z.literal(1)]),
});
type ToxicChatRow = z.infer<typeof RowSchema>;

export const toxicchat: DatasetSpec<ToxicChatRow> = {
  id: "toxicchat",
  tier: "optional",
  source: { kind: "hf", repo: "lmsys/toxic-chat", config: "toxicchat0124", split: "test", requiresToken: false },
  license: "cc-by-nc-4.0",
  tasks: [TOXICCHAT_TASK],
  rowSchema: RowSchema,
  toCase(row, rowIndex) {
    const toxic = row.toxicity === 1;
    return {
      id: String(rowIndex),
      state: { user_input: row.user_input },
      gold: { [TOXICCHAT_TASK.name]: toxic },
      stratum: toxic ? "toxic" : "non_toxic",
    };
  },
  primaryMetric: "f1_positive",
};
