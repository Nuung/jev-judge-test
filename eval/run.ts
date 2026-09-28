// 평가 러너 — pnpm eval. Jev(데모와 같은 judgeWithJev + decide)와 Claude 베이스라인을 같은 평가셋으로 비교한다.
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { createJevClient } from "@/lib/jev/client";
import { judgeWithJev } from "@/lib/jev/judge";
import { rankFace } from "@/lib/judge/face";
import { decide } from "@/lib/judge/policy";
import { CLAUDE_MODELS, runClaude } from "./claude";
import { countByCategory, loadDataset, type EvalCase } from "./dataset";
import { toMismatchAlert, type CaseResult, type ModelRun } from "./metrics";
import { CLAUDE_PRICING, JEV_PRICING } from "./pricing";
import { writeReport, type ReportInput } from "./report";
import { errorMessage, runSequential } from "./sequential";

const CLAUDE_SKIP_MESSAGE = `ANTHROPIC_API_KEY가 .env에 없어 Claude 베이스라인(${CLAUDE_MODELS.join(", ")})을 건너뜁니다. 키를 추가한 뒤 pnpm eval을 다시 실행하세요.`;

async function judgeJevCase(client: TypeSafeClient, c: EvalCase): Promise<{ result: CaseResult; model: string | null }> {
  try {
    const judgment = await judgeWithJev(client, { text: c.text, face: c.face });
    const decision = decide(judgment.answers, c.face === null ? null : rankFace(c.face));
    return {
      model: judgment.model,
      result: {
        case: c,
        ok: true,
        prediction: {
          mood: decision.mood.choice,
          moodConfidence: decision.mood.confidence,
          injection: decision.guardrail.injection,
          harmful: decision.guardrail.harmful,
          mismatch: decision.mismatch.probability,
          guardrail: decision.guardrail.status,
          mismatchAlert: toMismatchAlert(decision.mismatch.status),
        },
        latencyMs: judgment.latencyMs,
        inputTokens: judgment.inputTokens,
        outputTokens: judgment.outputTokens,
      },
    };
  } catch (error) {
    return { model: null, result: { case: c, ok: false, error: errorMessage(error), stopReason: null } };
  }
}

async function runJev(cases: readonly EvalCase[]): Promise<ModelRun> {
  // 재시도는 SDK 기본값(2회). 클라이언트는 여기서 지연 생성한다
  const client = createJevClient();
  const versions = new Set<string>();
  const results = await runSequential("jev", cases, async (c) => {
    const { result, model } = await judgeJevCase(client, c);
    if (model !== null) versions.add(model);
    return result;
  });
  return { name: "jev", pricing: JEV_PRICING, results, versions: [...versions] };
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const cases = await loadDataset();
  const categoryCounts = countByCategory(cases);
  console.log(`평가셋 ${cases.length}건 로드:`, categoryCounts);

  const runs: ModelRun[] = [];
  console.log(`\n[jev] ${cases.length}건 순차 판정`);
  runs.push(await runJev(cases));

  let skipped: ReportInput["skipped"] = null;
  if (process.env.ANTHROPIC_API_KEY) {
    for (const model of CLAUDE_MODELS) {
      console.log(`\n[${model}] ${cases.length}건 순차 판정`);
      const results = await runClaude(model, cases);
      runs.push({ name: model, pricing: CLAUDE_PRICING[model], results, versions: [model] });
    }
  } else {
    console.log(`\n${CLAUDE_SKIP_MESSAGE}`);
    skipped = { models: CLAUDE_MODELS, reason: "ANTHROPIC_API_KEY 없음" };
  }

  console.log("");
  const path = await writeReport({ startedAt, categoryCounts, runs, skipped });
  console.log(`\n리포트: ${path}`);
}

main().catch((error: unknown) => {
  console.error("평가 실행 실패:", error);
  process.exitCode = 1;
});
