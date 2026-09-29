// 러너 — 제공자별 레인 3개(jev · anthropic · openai)를 동시에 돌리고, 레인 안은 데이터셋 → 모델 → 케이스 순서로 순차 호출한다(D3).
// "순차 호출"을 "같은 제공자에 동시 요청 없음"으로 해석한다. config 실패가 나면 그 모델만 멈추고 나머지 케이스는 config로 기록한다.
import { writeCache, cacheKey } from "./cache";
import { LANE_ORDER, TIMEOUT_MS, type CacheLookup, type PlannedDataset, type Skipped } from "./plan";
import { outcomeFromRaw, outcomeFromRetry } from "./providers";
import { judgeWithRetry } from "./retry";
import type { BenchOptions, DatasetId, JudgeOutcome, ModelAlias, ModelSpec, Provider, ProviderId } from "./types";

export const LANE_INTERPRETATION =
  "스펙의 \"순차 호출\"을 \"같은 제공자에 동시 요청 없음\"으로 해석했다. 제공자별 레인 3개(jev · anthropic[haiku → sonnet] · openai[luna → sol])를 동시에 돌리고, 레인 안에서는 데이터셋 → 모델 → 케이스 순서로 한 건씩 호출한다.";

/** 진행 표시를 몇 건마다 찍을지 */
const PROGRESS_EVERY = 50;

export interface LaneRun {
  readonly provider: ProviderId;
  readonly models: readonly ModelAlias[];
  readonly start: string | null;
  readonly end: string | null;
}

/** 데이터셋 → 모델 → 케이스 id → 결과 */
export type Outcomes = Map<DatasetId, Map<ModelAlias, Map<string, JudgeOutcome>>>;

export interface RunResult {
  readonly outcomes: Outcomes;
  readonly lanes: readonly LaneRun[];
  /** 실행 중 멈춘 모델(config 실패) */
  readonly skipped: readonly Skipped[];
}

export interface RunInput {
  readonly options: BenchOptions;
  readonly models: readonly ModelSpec[];
  readonly providers: ReadonlyMap<ProviderId, Provider>;
  readonly datasets: readonly PlannedDataset[];
  /** `${dataset}/${model}` → 미리보기 때 조회한 캐시 */
  readonly lookups: ReadonlyMap<string, CacheLookup>;
}

export const lookupId = (dataset: DatasetId, model: ModelAlias): string => `${dataset}/${model}`;

function record(outcomes: Outcomes, dataset: DatasetId, model: ModelAlias, id: string, outcome: JudgeOutcome): void {
  let byModel = outcomes.get(dataset);
  if (byModel === undefined) {
    byModel = new Map();
    outcomes.set(dataset, byModel);
  }
  let byCase = byModel.get(model);
  if (byCase === undefined) {
    byCase = new Map();
    byModel.set(model, byCase);
  }
  byCase.set(id, outcome);
}

/** 멈춘 모델의 남은 케이스 — 호출하지 않았으므로 시도 기록이 없다 */
function abortedOutcome(detail: string): JudgeOutcome {
  return {
    ok: false,
    errorKind: "config",
    detail,
    attempts: [],
    usage: null,
    raw: null,
    cached: false,
    measuredAt: new Date().toISOString(),
  };
}

function progressChar(outcome: JudgeOutcome): string {
  if (outcome.cached) return "c";
  return outcome.ok ? "." : "x";
}

async function runLane(
  input: RunInput,
  provider: Provider,
  models: readonly ModelSpec[],
  outcomes: Outcomes,
  skipped: Skipped[],
): Promise<LaneRun> {
  const start = new Date().toISOString();
  /** 모델 → 멈춘 사유 */
  const aborted = new Map<ModelAlias, string>();

  for (const dataset of input.datasets) {
    const tasks = dataset.spec.tasks;
    for (const model of models) {
      const tag = `[${provider.id}] ${dataset.spec.id}/${model.alias}`;
      const lookup = input.lookups.get(lookupId(dataset.spec.id, model.alias));
      let marks = "";
      let done = 0;
      for (const c of dataset.cases) {
        const stopped = aborted.get(model.alias);
        let outcome: JudgeOutcome;
        const cached = lookup?.get(c.id) ?? null;
        if (stopped !== undefined) {
          outcome = abortedOutcome(`레인 중단: ${stopped}`);
        } else if (cached !== null) {
          outcome = outcomeFromRaw(provider, cached.raw, tasks, {
            attempts: cached.attempts,
            cached: true,
            measuredAt: cached.measuredAt,
          });
        } else {
          const measuredAt = new Date().toISOString();
          const request = { model, tasks, state: c.state, reasoning: input.options.reasoning, timeoutMs: TIMEOUT_MS };
          const result = await judgeWithRetry(provider, request);
          outcome = outcomeFromRetry(provider, result, tasks, measuredAt);
          // 원 응답이 있는 호출(성공 + 결정적 실패)만 저장한다
          if (result.status === "response" && !input.options.noCache) {
            const key = cacheKey({
              provider,
              model,
              reasoning: input.options.reasoning,
              timeoutMs: TIMEOUT_MS,
              tasks,
              state: c.state,
            });
            await writeCache(provider.id, { key, raw: result.raw, attempts: result.attempts, measuredAt });
          }
          if (!outcome.ok && outcome.errorKind === "config") {
            aborted.set(model.alias, outcome.detail);
            skipped.push({ target: `model:${model.alias}`, reason: `설정 오류로 중단(${dataset.spec.id}): ${outcome.detail}` });
            console.error(`${tag} 설정 오류로 이 모델을 멈춥니다: ${outcome.detail}`);
          }
        }
        record(outcomes, dataset.spec.id, model.alias, c.id, outcome);
        marks += progressChar(outcome);
        done++;
        if (done % PROGRESS_EVERY === 0 && done < dataset.cases.length) {
          console.error(`${tag} ${done}/${dataset.cases.length}`);
        }
      }
      console.error(`${tag} ${done}/${dataset.cases.length} ${marks}`);
    }
  }
  return { provider: provider.id, models: models.map((m) => m.alias), start, end: new Date().toISOString() };
}

/** 레인을 동시에 돌린다. 진행 표시: . 성공 · x 실패 · c 캐시 적중 */
export async function runBench(input: RunInput): Promise<RunResult> {
  const outcomes: Outcomes = new Map();
  const skipped: Skipped[] = [];
  const lanes = LANE_ORDER.flatMap((providerId) => {
    const models = input.models.filter((m) => m.provider === providerId);
    const provider = input.providers.get(providerId);
    if (models.length === 0 || provider === undefined) return [];
    return [runLane(input, provider, models, outcomes, skipped)];
  });
  const laneRuns = await Promise.all(lanes);
  return { outcomes, lanes: laneRuns, skipped };
}
