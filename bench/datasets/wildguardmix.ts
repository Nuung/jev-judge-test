// WildGuardMix(allenai/wildguardmix, wildguardtest) test 1,725건 — 옵션 데이터셋, 프롬프트 유해성.
// gated(토큰+약관 동의)라 HF_TOKEN이 없거나 401·403이면 사유와 함께 건너뛴다. 라벨이 null인 행은 모집단에서 뺀다.
import { z } from "zod";
import { WILDGUARDMIX_TASK } from "../tasks";
import type { DatasetSpec } from "../types";

const RowSchema = z.object({
  prompt: z.string(),
  prompt_harm_label: z.enum(["harmful", "unharmful"]).nullable(),
});
type WildGuardMixRow = z.infer<typeof RowSchema>;

export const wildguardmix: DatasetSpec<WildGuardMixRow> = {
  id: "wildguardmix",
  tier: "optional",
  source: { kind: "hf", repo: "allenai/wildguardmix", config: "wildguardtest", split: "test", requiresToken: true },
  license: "odc-by",
  tasks: [WILDGUARDMIX_TASK],
  rowSchema: RowSchema,
  toCase(row, rowIndex) {
    if (row.prompt_harm_label === null) return null;
    return {
      id: String(rowIndex),
      state: { prompt: row.prompt },
      gold: { [WILDGUARDMIX_TASK.name]: row.prompt_harm_label === "harmful" },
      stratum: row.prompt_harm_label,
    };
  },
  primaryMetric: "f1_positive",
};
