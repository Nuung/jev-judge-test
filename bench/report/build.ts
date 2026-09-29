// metrics.json 조립 — 러너 결과를 bench/stats로 집계한다(계획 §4). summary.md·차트는 이 결과만 입력으로 쓴다.
// 데이터셋 × 과제마다: 주지표 ITT + paired bootstrap CI, 성공 기준 수치, (모델 − Jev) 차이 CI, McNemar(+ Holm),
// Brier(모든 모델 성공 교집합)·ECE, 지연(첫 시도 성공만), 비용 두 종(토큰 기준 단가 / 이번 실행 청구).
import { loadEnronTruncatedIds } from "../datasets/enron-spam";
import {
  JBB_REFERENCE_JUDGES,
  JBB_STATE_NOTE,
  loadJbbReferenceBaselines,
  type JbbReferenceJudge,
} from "../datasets/jbb-judge";
import { costUsd, type PlannedDataset, type Skipped } from "../plan";
import { RETRY_POLICY } from "../retry";
import type { Outcomes } from "../run";
import { BOOTSTRAP_REPLICATES, CI_LEVEL, pairedBootstrap, type BootstrapModel } from "../stats/bootstrap";
import {
  calibrate,
  choiceTopLabelPoint,
  ECE_BINS,
  noulPTruePoint,
  type CalibrationPoint,
  type CalibrationSummary,
} from "../stats/calibration";
import { summarizeLatency } from "../stats/latency";
import { holm, mcnemar } from "../stats/mcnemar";
import { accuracy, binaryF1, macroF1, metricStatistic, summarizeMetric, type ScoredCases } from "../stats/metrics";
import { BENCH_SEED, deriveSeed } from "../stats/prng";
import type {
  Answer,
  BenchCase,
  DatasetId,
  ErrorKind,
  GoldValue,
  JudgeOutcome,
  ModelAlias,
  ModelSpec,
  ProbabilitySource,
  TaskDefinition,
} from "../types";
import type { DatasetMetrics, Metrics, ModelResult, ReferenceBaseline, Reliability, RunInfo } from "./raw";

/** 사전 선언 가설 집합 = 기본 데이터셋 7개 × (LLM 4개 vs Jev) */
const PREREGISTERED_SIZE = 28;
const JEV: ModelAlias = "jev";

/** 공개 보고 수치(JBB judge_comparison, human_majority 대비 일치율) */
const JBB_PUBLISHED: Partial<Record<JbbReferenceJudge, string>> = {
  gpt4_cf: "90.3%",
  llamaguard2_cf: "87.7%",
};

const CLIENT_4XX_WARN = 0.05;
const FAILURE_WARN = 0.05;
const MAX_TOKENS_WARN = 0.01;
const BRIER_MIN_N = 100;

export interface BuildInput {
  readonly runInfo: RunInfo;
  readonly models: readonly ModelSpec[];
  readonly probabilitySources: ReadonlyMap<ModelAlias, ProbabilitySource>;
  readonly datasets: readonly PlannedDataset[];
  readonly outcomes: Outcomes;
  readonly skipped: readonly Skipped[];
}

// ── 케이스 단위 보조 ──

/** 과제 답 → 예측 라벨(Noul은 p(true) ≥ 0.5 → true). 실패·답 없음은 abstain(null) */
function predictionOf(task: TaskDefinition, outcome: JudgeOutcome | undefined): GoldValue | null {
  if (outcome === undefined || !outcome.ok) return null;
  const answer: Answer | undefined = outcome.answers[task.name];
  if (answer === undefined) return null;
  if (task.kind === "choice") return answer.kind === "choice" ? answer.choice : null;
  return answer.kind === "noul" ? answer.probability >= 0.5 : null;
}

function calibrationPointOf(task: TaskDefinition, outcome: JudgeOutcome | undefined, gold: GoldValue): CalibrationPoint | null {
  if (outcome === undefined || !outcome.ok) return null;
  const answer = outcome.answers[task.name];
  if (answer === undefined) return null;
  if (answer.kind === "choice" && typeof gold === "string") return choiceTopLabelPoint(answer, gold);
  if (answer.kind === "noul" && typeof gold === "boolean") return noulPTruePoint(answer, gold);
  return null;
}

function bins(summary: CalibrationSummary): ModelResult["calibration"][number]["bins"] {
  return summary.bins.map((b) => ({ index: b.index, n: b.n, meanConfidence: b.meanProbability, observed: b.observedRate }));
}

function errorCounts(outcomes: readonly (JudgeOutcome | undefined)[]): Record<ErrorKind, number> {
  const counts: Record<ErrorKind, number> = { refusal: 0, format: 0, max_tokens: 0, range: 0, client_4xx: 0, api: 0, config: 0 };
  for (const o of outcomes) if (o !== undefined && !o.ok) counts[o.errorKind]++;
  return counts;
}

function scored(task: TaskDefinition, gold: readonly GoldValue[], pred: readonly (GoldValue | null)[]): ScoredCases<GoldValue> {
  if (task.kind === "choice") return { labels: task.labels, gold, pred };
  return { labels: [true, false], positive: true, gold, pred };
}

// ── 비용 ──

function costOf(model: ModelSpec, calls: readonly JudgeOutcome[]): ModelResult["cost"] {
  const withUsage = calls.flatMap((o) => (o.usage === null ? [] : [o.usage]));
  const billed = calls
    .filter((o) => !o.cached && o.usage !== null)
    .reduce((sum, o) => sum + (o.usage === null ? 0 : costUsd(model, o.usage.inputTokens, o.usage.outputTokens)), 0);
  if (withUsage.length === 0) {
    return { perCallUsd: null, per1kUsd: null, billedUsd: billed, meanInputTokens: null, meanOutputTokens: null };
  }
  const meanIn = withUsage.reduce((s, u) => s + u.inputTokens, 0) / withUsage.length;
  const meanOut = withUsage.reduce((s, u) => s + u.outputTokens, 0) / withUsage.length;
  const perCall = costUsd(model, meanIn, meanOut);
  return { perCallUsd: perCall, per1kUsd: perCall * 1000, billedUsd: billed, meanInputTokens: meanIn, meanOutputTokens: meanOut };
}

// ── 데이터셋 × 과제 ──

interface Comparison {
  readonly datasetIndex: number;
  readonly resultIndex: number;
  readonly p: number;
}

interface TaskBuild {
  readonly metrics: DatasetMetrics;
  /** 사전 선언 집합에 들어가는 McNemar 비교(Holm 대상) */
  readonly preregistered: readonly { resultIndex: number; p: number }[];
  readonly warnings: readonly string[];
  /** 모델 → 성공 케이스 보정 점(신뢰도 곡선 합산용) */
  readonly points: ReadonlyMap<ModelAlias, readonly CalibrationPoint[]>;
}

function datasetSource(d: PlannedDataset): string {
  const s = d.spec.source;
  return s.kind === "hf" ? `${s.repo} (${s.config}/${s.split})` : s.path;
}

async function datasetNotes(d: PlannedDataset, task: TaskDefinition, evaluated: readonly BenchCase[]): Promise<string[]> {
  const notes: string[] = [];
  if (d.excluded > 0) notes.push(`모집단에서 라벨이 없는 행 ${d.excluded}건을 뺐다(모집단 ${d.population}건).`);
  if (d.spec.id === "jbb-judge") notes.push(JBB_STATE_NOTE);
  if (d.spec.id === "enron-spam") {
    const truncated = await loadEnronTruncatedIds();
    if (truncated !== null) {
      const n = d.cases.filter((c) => truncated.has(c.id)).length;
      notes.push(`본문 ${d.spec.maxInputChars ?? 0}자 절단 또는 응답 크기 제한으로 잘린 케이스 ${n}건(표본 ${d.cases.length}건 중).`);
    }
  }
  const boundary = d.cases.filter((c) => d.metricExcludedIds.has(c.id)).length;
  if (boundary > 0) notes.push(`라벨이 애매한 경계 사례 ${boundary}건은 호출했지만 지표에서 뺐다.`);
  const noGold = d.cases.length - boundary - evaluated.length;
  if (d.spec.tasks.length > 1 && noGold > 0) {
    notes.push(`\`${task.name}\` 정답이 없는 케이스 ${noGold}건은 이 과제 지표에서 뺐다.`);
  }
  return notes;
}

async function buildTask(
  input: BuildInput,
  d: PlannedDataset,
  task: TaskDefinition,
  jbbBaselines: Awaited<ReturnType<typeof loadJbbReferenceBaselines>> | null,
): Promise<TaskBuild> {
  const id = d.spec.id;
  const multiTask = d.spec.tasks.length > 1;
  const byModel = input.outcomes.get(id) ?? new Map<ModelAlias, Map<string, JudgeOutcome>>();
  const models = input.models.filter((m) => byModel.has(m.alias));
  const jevIncluded = models.some((m) => m.alias === JEV);

  // 이 과제의 정답이 있고 경계 사례가 아닌 케이스
  const cases = d.cases.filter((c) => c.gold[task.name] !== undefined && !d.metricExcludedIds.has(c.id));
  const gold = cases.flatMap((c) => {
    const g = c.gold[task.name];
    return g === undefined ? [] : [g];
  });
  const outcomesOf = (alias: ModelAlias): (JudgeOutcome | undefined)[] => {
    const m = byModel.get(alias);
    return cases.map((c) => m?.get(c.id));
  };
  const preds = new Map(models.map((m) => [m.alias, outcomesOf(m.alias).map((o) => predictionOf(task, o))] as const));

  const primaryMetric = d.spec.primaryMetric;
  const seedParts = multiTask ? ["bootstrap", id, task.name] : ["bootstrap", id];
  const bootstrap =
    cases.length === 0
      ? null
      : pairedBootstrap({
          n: cases.length,
          models: models.map(
            (m): BootstrapModel => ({
              id: m.alias,
              statistic: metricStatistic(primaryMetric, scored(task, gold, preds.get(m.alias) ?? [])),
            }),
          ),
          reference: jevIncluded ? JEV : null,
          seed: deriveSeed(BENCH_SEED, ...seedParts),
        });

  // Brier 교집합: 이 과제에서 모든 모델이 성공한 케이스
  const intersection = cases
    .map((_, i) => i)
    .filter((i) => models.every((m) => calibrationPointOf(task, outcomesOf(m.alias)[i], gold[i]) !== null));

  const jevCorrect = jevIncluded ? (preds.get(JEV) ?? []).map((p, i) => p === gold[i]) : null;
  const warnings: string[] = [];
  const preregistered: { resultIndex: number; p: number }[] = [];
  const points = new Map<ModelAlias, CalibrationPoint[]>();
  const label = multiTask ? `${id}/${task.name}` : id;

  const results: ModelResult[] = models.map((m, resultIndex) => {
    const outcomes = outcomesOf(m.alias);
    const pred = preds.get(m.alias) ?? [];
    const summary = summarizeMetric(primaryMetric, scored(task, gold, pred));
    const counts = errorCounts(outcomes);
    const n = cases.length;
    const interval = bootstrap?.models[m.alias] ?? null;

    let vsJev: ModelResult["vsJev"] = null;
    const diff = bootstrap?.diffs[m.alias];
    if (jevCorrect !== null && m.alias !== JEV && diff !== undefined) {
      const test = mcnemar(jevCorrect, pred.map((p, i) => p === gold[i]));
      const family = d.spec.tier === "default" ? "preregistered" : "exploratory";
      if (family === "preregistered") preregistered.push({ resultIndex, p: test.p });
      vsJev = {
        diff: { value: diff.point, ci: [diff.lower, diff.upper] },
        mcnemar: { b: test.b, c: test.c, p: test.p, pHolm: null, family },
      };
    }

    const source = input.probabilitySources.get(m.alias) ?? "verbalized";
    const own = outcomes.flatMap((o, i) => {
      const point = calibrationPointOf(task, o, gold[i]);
      return point === null ? [] : [point];
    });
    points.set(m.alias, own);
    const kind = task.kind === "choice" ? "choice-top-label" : "noul-p-true";
    const full = calibrate(kind, source, own, ECE_BINS);
    const inter = calibrate(
      kind,
      source,
      intersection.flatMap((i) => {
        const point = calibrationPointOf(task, outcomes[i], gold[i]);
        return point === null ? [] : [point];
      }),
      ECE_BINS,
    );

    // 지연·비용은 호출 단위(과제와 무관) — 데이터셋의 모든 호출로 계산한다
    const calls = d.cases.flatMap((c) => {
      const o = byModel.get(m.alias)?.get(c.id);
      return o === undefined ? [] : [o];
    });
    const latency = summarizeLatency(calls);

    if (n > 0 && counts.client_4xx / n > CLIENT_4XX_WARN) {
      warnings.push(`${label}/${m.alias}: client_4xx ${counts.client_4xx}/${n}건(5% 초과) — 설정 버그 여부 확인 후 --no-cache로 재실행`);
    }
    if (n > 0 && summary.failureRate > FAILURE_WARN) {
      warnings.push(`${label}/${m.alias}: 실패율 ${(summary.failureRate * 100).toFixed(1)}%(5% 초과)`);
    }
    if (n > 0 && input.runInfo.options.reasoning === "default" && counts.max_tokens / n > MAX_TOKENS_WARN) {
      warnings.push(`${label}/${m.alias}: max_tokens 실패 ${counts.max_tokens}/${n}건(1% 초과)`);
    }

    return {
      model: m.alias,
      n,
      primary: interval === null ? { value: summary.value, ci: [summary.value, summary.value] } : { value: interval.point, ci: [interval.lower, interval.upper] },
      successOnly: { value: summary.successOnly, n: n - summary.failures },
      secondary: {
        accuracy: accuracy(gold, pred),
        f1Positive: task.kind === "noul" ? binaryF1(gold, pred, true) : null,
        macroF1: task.kind === "choice" ? macroF1(task.labels, gold, pred) : null,
      },
      vsJev,
      successRate: n === 0 ? 0 : 1 - summary.failureRate,
      refusalRate: n === 0 ? 0 : counts.refusal / n,
      errorCounts: counts,
      calibration: [
        {
          task: task.name,
          mode: task.kind,
          source,
          brier: inter.brier,
          intersectionN: inter.n,
          ece: full.ece,
          n: full.n,
          bins: bins(full),
        },
      ],
      latency: {
        p50: latency.p50Ms,
        p95: latency.p95Ms,
        n: latency.n,
        retriedCalls: latency.retriedCalls,
        priorRunShare: latency.priorMeasurementShare ?? 0,
      },
      cost: costOf(m, calls),
    };
  });

  if (cases.length > 0 && intersection.length < BRIER_MIN_N) {
    warnings.push(`${label}: Brier 교집합 n=${intersection.length}(100 미만) — 보정 비교 해석에 주의`);
  }

  const referenceBaselines: ReferenceBaseline[] = [];
  if (id === "jbb-judge" && jbbBaselines !== null) {
    for (const judge of Object.keys(JBB_REFERENCE_JUDGES).filter((k): k is JbbReferenceJudge => k in JBB_REFERENCE_JUDGES)) {
      const pred = cases.map((c) => jbbBaselines.get(c.id)?.[judge] ?? null);
      referenceBaselines.push({
        name: JBB_REFERENCE_JUDGES[judge],
        accuracy: accuracy(gold, pred),
        f1Positive: binaryF1(gold, pred, true),
        n: cases.length,
        published: JBB_PUBLISHED[judge] ?? null,
      });
    }
  }

  const metrics: DatasetMetrics = {
    id,
    task: multiTask ? task.name : null,
    tier: d.spec.tier,
    license: d.spec.license,
    source: datasetSource(d),
    revision: d.meta.revision,
    n: cases.length,
    primaryMetric,
    labels: task.kind === "choice" ? [...task.labels] : null,
    maxInputChars: d.spec.maxInputChars ?? null,
    results,
    referenceBaselines,
    notes: await datasetNotes(d, task, cases),
  };
  return { metrics, preregistered, warnings, points };
}

// ── 전체 ──

export async function buildMetrics(input: BuildInput): Promise<Metrics> {
  const { runInfo } = input;
  const jbbBaselines = input.datasets.some((d) => d.spec.id === "jbb-judge") ? await loadJbbReferenceBaselines() : null;

  const datasets: DatasetMetrics[] = [];
  const comparisons: Comparison[] = [];
  const warnings: string[] = [];
  /** 모델 → 형식 → (데이터셋, 점) */
  const pooled = new Map<ModelAlias, Map<TaskDefinition["kind"], { datasets: Set<DatasetId>; points: CalibrationPoint[] }>>();

  for (const d of input.datasets) {
    for (const task of d.spec.tasks) {
      const built = await buildTask(input, d, task, jbbBaselines);
      const datasetIndex = datasets.length;
      datasets.push(built.metrics);
      for (const c of built.preregistered) comparisons.push({ datasetIndex, resultIndex: c.resultIndex, p: c.p });
      warnings.push(...built.warnings);
      for (const [alias, points] of built.points) {
        let byKind = pooled.get(alias);
        if (byKind === undefined) {
          byKind = new Map();
          pooled.set(alias, byKind);
        }
        const bucket = byKind.get(task.kind) ?? { datasets: new Set<DatasetId>(), points: [] };
        bucket.datasets.add(d.spec.id);
        bucket.points.push(...points);
        byKind.set(task.kind, bucket);
      }
    }
  }

  // Holm: 이번 실행에 있는 사전 선언 비교에만 적용
  const adjusted = holm(comparisons.map((c) => c.p));
  const withHolm = datasets.map((ds, datasetIndex) => ({
    ...ds,
    results: ds.results.map((r, resultIndex) => {
      const k = comparisons.findIndex((c) => c.datasetIndex === datasetIndex && c.resultIndex === resultIndex);
      if (k < 0 || r.vsJev === null || r.vsJev.mcnemar === null) return r;
      return { ...r, vsJev: { ...r.vsJev, mcnemar: { ...r.vsJev.mcnemar, pHolm: adjusted[k] } } };
    }),
  }));

  const jevIncluded = input.models.some((m) => m.alias === JEV);
  if (jevIncluded && comparisons.length > 0 && comparisons.length < PREREGISTERED_SIZE) {
    warnings.push(`Holm은 이번 실행의 비교 ${comparisons.length}개에만 적용했다(사전 선언 집합 ${PREREGISTERED_SIZE}개의 부분 집합).`);
  }
  if (!jevIncluded) warnings.push("Jev가 실행에 없어 McNemar와 Jev 대비 차이를 생략했다.");

  const reliability: Reliability[] = [];
  for (const m of input.models) {
    for (const [mode, bucket] of pooled.get(m.alias) ?? []) {
      const summary = calibrate(mode === "choice" ? "choice-top-label" : "noul-p-true", input.probabilitySources.get(m.alias) ?? "verbalized", bucket.points, ECE_BINS);
      reliability.push({
        model: m.alias,
        mode,
        source: summary.source,
        datasets: [...bucket.datasets],
        n: summary.n,
        ece: summary.ece,
        bins: bins(summary),
      });
    }
  }

  return {
    schemaVersion: 1,
    seed: BENCH_SEED,
    bootstrap: { iterations: BOOTSTRAP_REPLICATES, percentile: "inverted_cdf", level: CI_LEVEL },
    eceBins: ECE_BINS,
    settings: {
      commit: runInfo.commit,
      reasoning: runInfo.options.reasoning,
      timeoutMs: runInfo.timeoutMs,
      maxRetries: RETRY_POLICY.maxRetries,
      temperature: runInfo.temperature,
      laneInterpretation: runInfo.laneInterpretation,
      lanes: runInfo.lanes,
      sdkVersions: runInfo.sdkVersions,
      parserHash: runInfo.parserHash,
      systemPromptHash: runInfo.systemPromptHash,
      outputSchemaHash: runInfo.outputSchemaHash,
    },
    models: runInfo.models.map((m) => ({
      alias: m.alias,
      provider: m.provider,
      apiModel: m.apiModel,
      probabilitySource: m.probabilitySource,
      pricing: m.pricing,
    })),
    datasets: withHolm,
    reliability,
    holm: { familySize: comparisons.length, preregisteredSize: PREREGISTERED_SIZE, jevIncluded },
    warnings,
    skipped: [...input.skipped],
  };
}
