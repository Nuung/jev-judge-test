// 결과 폴더 읽기와 쓰기. bench/results/<YYYY-MM-DDTHH-mm-ss>/ 구조와 각 파일의 zod 스키마(계획 §3).
//   run.json                       실행 설정과 재현 정보(실행 시각은 여기에만 둔다)
//   requests/<데이터셋>/<모델>.jsonl  케이스별 기록(입력 텍스트 없음)
//   metrics.json                   통계 결과. summary.md와 차트의 유일한 입력
//   summary.md                     한국어 요약(생성 시각 미포함)
//   charts/*.{svg,png}
// 파일은 사람이 고칠 수도 있는 외부 데이터라 읽을 때 zod로 검증한다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DATASET_IDS, MODEL_ALIASES, REASONING_MODES } from "../types";
import type { CaseRecord, DatasetId, ModelAlias } from "../types";

// ── 폴더와 경로 ──

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 결과 폴더 이름(로컬 시각, 파일명에 쓸 수 없는 콜론 대신 하이픈) */
export function resultFolderName(date: Date): string {
  const d = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const t = `${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`;
  return `${d}T${t}`;
}

export interface ResultPaths {
  readonly root: string;
  readonly run: string;
  readonly metrics: string;
  readonly summary: string;
  readonly chartsDir: string;
  requests(dataset: DatasetId, model: ModelAlias): string;
}

export function resultPaths(root: string): ResultPaths {
  return {
    root,
    run: path.join(root, "run.json"),
    metrics: path.join(root, "metrics.json"),
    summary: path.join(root, "summary.md"),
    chartsDir: path.join(root, "charts"),
    requests: (dataset, model) => path.join(root, "requests", dataset, `${model}.jsonl`),
  };
}

// ── 공용 스키마 ──

const datasetIdSchema = z.enum(DATASET_IDS);
const modelAliasSchema = z.enum(MODEL_ALIASES);
const providerSchema = z.enum(["jev", "anthropic", "openai"]);
const reasoningSchema = z.enum(REASONING_MODES);
const probabilitySourceSchema = z.enum(["jev-direct", "verbalized"]);
export const ERROR_KINDS = ["refusal", "format", "max_tokens", "range", "client_4xx", "api", "config"] as const;
const errorKindSchema = z.enum(ERROR_KINDS);
const primaryMetricSchema = z.enum(["accuracy", "macro_f1", "f1_positive"]);
const isoSchema = z.string();
const hashRecordSchema = z.record(z.string(), z.string());

const pricingSchema = z.object({
  inputPerMTok: z.number(),
  outputPerMTok: z.number(),
  source: z.string(),
});

const laneSchema = z.object({
  provider: providerSchema,
  /** 레인 안에서 순차 실행한 모델 순서 */
  models: z.array(modelAliasSchema),
  start: isoSchema.nullable(),
  end: isoSchema.nullable(),
});

// ── requests/<데이터셋>/<모델>.jsonl ──

const tokenUsageSchema = z.object({ inputTokens: z.number(), outputTokens: z.number() });

const attemptSchema = z.object({
  start: isoSchema,
  ms: z.number(),
  outcome: z.union([
    z.literal("ok"),
    z.templateLiteral(["retryable:", z.string()]),
    z.templateLiteral(["deterministic:", z.string()]),
    z.templateLiteral(["config:", z.string()]),
  ]),
});

const answerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("choice"),
    choice: z.string(),
    probability: z.number(),
    probabilities: z.record(z.string(), z.number()).nullable(),
  }),
  z.object({ kind: z.literal("noul"), probability: z.number() }),
]);

export const caseRecordSchema: z.ZodType<CaseRecord> = z.object({
  id: z.string(),
  dataset: datasetIdSchema,
  model: modelAliasSchema,
  cached: z.boolean(),
  output: z.json().nullable(),
  stop: z.string().nullable(),
  answers: z.record(z.string(), answerSchema).nullable(),
  errorKind: errorKindSchema.nullable(),
  detail: z.string().nullable(),
  usage: tokenUsageSchema.nullable(),
  attempts: z.array(attemptSchema),
  measuredAt: isoSchema,
});

// ── run.json ──

export const runInfoSchema = z.object({
  schemaVersion: z.literal(1),
  startedAt: isoSchema,
  finishedAt: isoSchema.nullable(),
  /** git 커밋(없으면 null) */
  commit: z.string().nullable(),
  options: z.object({
    models: z.array(modelAliasSchema),
    datasets: z.array(datasetIdSchema),
    limit: z.number().int(),
    reasoning: reasoningSchema,
    yes: z.boolean(),
    noCache: z.boolean(),
  }),
  seed: z.number().int(),
  timeoutMs: z.number().int(),
  /** 설정하지 않았으면 "unset" */
  temperature: z.union([z.number(), z.literal("unset")]),
  /** bench/retry.ts의 분류표, 헤더 처리, 백오프 파라미터, 상한 */
  retryPolicy: z.json(),
  parserHash: z.string(),
  /** 제공자 → 시스템 프롬프트 해시 / 출력 스키마 해시 */
  systemPromptHash: hashRecordSchema,
  outputSchemaHash: hashRecordSchema,
  sdkVersions: hashRecordSchema,
  /** "순차 호출" 해석 문구(같은 제공자에 동시 요청 없음) */
  laneInterpretation: z.string(),
  lanes: z.array(laneSchema),
  models: z.array(
    z.object({
      alias: modelAliasSchema,
      provider: providerSchema,
      apiModel: z.string(),
      pricing: pricingSchema,
      tokenizerFactor: z.number(),
      /** 재보정 전 결과(출력 계수 없음)도 읽을 수 있게 선택 필드로 둔다 */
      outputTokenFactor: z.number().optional(),
      probabilitySource: probabilitySourceSchema,
    }),
  ),
  datasets: z.array(
    z.object({
      id: datasetIdSchema,
      tier: z.enum(["default", "optional", "smoke"]),
      license: z.string(),
      source: z.union([
        z.object({ kind: z.literal("hf"), repo: z.string(), config: z.string(), split: z.string() }),
        z.object({ kind: z.literal("local"), path: z.string() }),
      ]),
      revision: z.string().nullable(),
      numRows: z.number().int().nullable(),
      sampleIds: z.array(z.string()),
      /** 층 이름 → 배분 수 */
      strata: z.record(z.string(), z.number().int()),
      maxInputChars: z.number().int().nullable(),
      notes: z.array(z.string()),
    }),
  ),
  /** 건너뛴 모델, 데이터셋과 사유(키 없음, HF_TOKEN 없음, config 실패 등) */
  skipped: z.array(z.object({ target: z.string(), reason: z.string() })),
});
export type RunInfo = z.infer<typeof runInfoSchema>;

// ── metrics.json ──

const ciSchema = z.tuple([z.number(), z.number()]);
/** 점추정 + 95% paired bootstrap CI(inverted_cdf) */
const estimateSchema = z.object({ value: z.number(), ci: ciSchema });
export type Estimate = z.infer<typeof estimateSchema>;

const binSchema = z.object({
  /** 0..bins-1, index = min(⌊conf×bins⌋, bins−1) */
  index: z.number().int(),
  n: z.number().int(),
  /** bin 안 평균 확률(n=0이면 null) */
  meanConfidence: z.number().nullable(),
  /** Choice는 정답률, Noul은 실제 true 비율(n=0이면 null) */
  observed: z.number().nullable(),
});
export type ReliabilityBin = z.infer<typeof binSchema>;

/** Choice는 선택 라벨 확률(top-label), Noul은 p(true) */
const calibrationModeSchema = z.enum(["choice", "noul"]);
export type CalibrationMode = z.infer<typeof calibrationModeSchema>;

const calibrationSchema = z.object({
  task: z.string(),
  mode: calibrationModeSchema,
  source: probabilitySourceSchema,
  /** 이 데이터셋에서 모든 모델이 성공한 케이스 교집합의 Brier(교집합이 비면 null) */
  brier: z.number().nullable(),
  intersectionN: z.number().int(),
  /** 이 모델의 성공 케이스 전체로 계산한 ECE(보조) */
  ece: z.number().nullable(),
  n: z.number().int(),
  bins: z.array(binSchema),
});

const mcnemarSchema = z.object({
  /** Jev만 정답 */
  b: z.number().int(),
  /** LLM만 정답 */
  c: z.number().int(),
  p: z.number(),
  /** 사전 선언 집합(기본 7개 × LLM 4개)에서 Holm 보정한 p. 탐색적 비교면 null */
  pHolm: z.number().nullable(),
  family: z.enum(["preregistered", "exploratory"]),
});

const modelResultSchema = z.object({
  model: modelAliasSchema,
  n: z.number().int(),
  /** ITT 주지표(실패 = abstain) */
  primary: estimateSchema,
  /** 성공 케이스만으로 계산한 주지표 */
  successOnly: z.object({ value: z.number().nullable(), n: z.number().int() }),
  secondary: z.object({
    accuracy: z.number(),
    f1Positive: z.number().nullable(),
    macroF1: z.number().nullable(),
  }),
  /** Jev 대비(모델 − Jev). Jev 자신이거나 Jev 미포함 실행이면 null */
  vsJev: z
    .object({
      diff: estimateSchema,
      /** 정오답 일치 검정. Jev 미포함이면 null */
      mcnemar: mcnemarSchema.nullable(),
    })
    .nullable(),
  successRate: z.number(),
  refusalRate: z.number(),
  errorCounts: z.record(errorKindSchema, z.number().int()),
  calibration: z.array(calibrationSchema),
  latency: z.object({
    /** 성공 && 첫 시도 성공 호출만(nearest-rank, ms) */
    p50: z.number().nullable(),
    p95: z.number().nullable(),
    n: z.number().int(),
    retriedCalls: z.number().int(),
    /** 지연 표본 중 이전 실행(캐시 적중)에서 측정된 비율 */
    priorRunShare: z.number(),
  }),
  cost: z.object({
    /** 토큰 기준 호출당 단가(캐시 여부 무관, usage 평균 × 단가). usage가 없으면 null */
    perCallUsd: z.number().nullable(),
    per1kUsd: z.number().nullable(),
    /** 이번 실행 청구 추정(캐시 미스만) */
    billedUsd: z.number(),
    meanInputTokens: z.number().nullable(),
    meanOutputTokens: z.number().nullable(),
  }),
});
export type ModelResult = z.infer<typeof modelResultSchema>;

const referenceBaselineSchema = z.object({
  name: z.string(),
  accuracy: z.number(),
  f1Positive: z.number().nullable(),
  n: z.number().int(),
  /** 공개 보고 수치(예: "90.3%"), 없으면 null */
  published: z.string().nullable(),
});
export type ReferenceBaseline = z.infer<typeof referenceBaselineSchema>;

const datasetMetricsSchema = z.object({
  id: datasetIdSchema,
  /** 과제가 여럿인 데이터셋(demo-smoke)은 과제마다 항목을 따로 두고 과제 이름을 적는다. 과제가 하나면 null */
  task: z.string().nullable(),
  tier: z.enum(["default", "optional", "smoke"]),
  license: z.string(),
  source: z.string(),
  revision: z.string().nullable(),
  n: z.number().int(),
  primaryMetric: primaryMetricSchema,
  /** Choice 라벨 체계 전체(macro-F1 고정 클래스 목록), Noul이면 null */
  labels: z.array(z.string()).nullable(),
  maxInputChars: z.number().int().nullable(),
  results: z.array(modelResultSchema),
  /** JBB judge 공개 기준(같은 표본에서 재계산), 그 외 빈 배열 */
  referenceBaselines: z.array(referenceBaselineSchema),
  notes: z.array(z.string()),
});
export type DatasetMetrics = z.infer<typeof datasetMetricsSchema>;

const reliabilitySchema = z.object({
  model: modelAliasSchema,
  mode: calibrationModeSchema,
  source: probabilitySourceSchema,
  /** 합친 데이터셋 */
  datasets: z.array(datasetIdSchema),
  n: z.number().int(),
  ece: z.number().nullable(),
  bins: z.array(binSchema),
});
export type Reliability = z.infer<typeof reliabilitySchema>;

export const metricsSchema = z.object({
  schemaVersion: z.literal(1),
  seed: z.number().int(),
  bootstrap: z.object({
    iterations: z.number().int(),
    percentile: z.literal("inverted_cdf"),
    level: z.number(),
  }),
  eceBins: z.number().int(),
  settings: z.object({
    commit: z.string().nullable(),
    reasoning: reasoningSchema,
    timeoutMs: z.number().int(),
    maxRetries: z.number().int(),
    temperature: z.union([z.number(), z.literal("unset")]),
    laneInterpretation: z.string(),
    lanes: z.array(laneSchema),
    sdkVersions: hashRecordSchema,
    parserHash: z.string(),
    systemPromptHash: hashRecordSchema,
    outputSchemaHash: hashRecordSchema,
  }),
  models: z.array(
    z.object({
      alias: modelAliasSchema,
      provider: providerSchema,
      apiModel: z.string(),
      probabilitySource: probabilitySourceSchema,
      pricing: pricingSchema,
    }),
  ),
  datasets: z.array(datasetMetricsSchema),
  /** 모델별 신뢰도 곡선(Choice와 Noul 분리, 해당 형식 데이터셋을 합쳐 계산) */
  reliability: z.array(reliabilitySchema),
  holm: z.object({
    /** 이번 실행에서 Holm을 적용한 비교 수 */
    familySize: z.number().int(),
    /** 사전 선언 집합 크기(28) */
    preregisteredSize: z.number().int(),
    jevIncluded: z.boolean(),
  }),
  /** 통계 계산 단계에서 낸 경고(client_4xx 5% 초과, Brier 교집합 n<100, max_tokens 1% 초과 등) */
  warnings: z.array(z.string()),
  skipped: z.array(z.object({ target: z.string(), reason: z.string() })),
});
export type Metrics = z.infer<typeof metricsSchema>;

// ── 읽기와 쓰기 ──

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson<T>(file: string, schema: z.ZodType<T>): Promise<T> {
  const text = await readFile(file, "utf8");
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`${file} 형식이 올바르지 않습니다:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export async function writeJsonl(file: string, rows: readonly unknown[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, rows.map((row) => `${JSON.stringify(row)}\n`).join(""), "utf8");
}

export async function readJsonl<T>(file: string, schema: z.ZodType<T>): Promise<T[]> {
  const text = await readFile(file, "utf8");
  const rows: T[] = [];
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    if (line.trim() === "") continue;
    const parsed = schema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(`${file}:${i + 1} 형식이 올바르지 않습니다:\n${z.prettifyError(parsed.error)}`);
    }
    rows.push(parsed.data);
  }
  return rows;
}

export const readRunInfo = (root: string): Promise<RunInfo> => readJson(resultPaths(root).run, runInfoSchema);
export const readMetrics = (root: string): Promise<Metrics> => readJson(resultPaths(root).metrics, metricsSchema);
export const readCaseRecords = (root: string, dataset: DatasetId, model: ModelAlias): Promise<CaseRecord[]> =>
  readJsonl(resultPaths(root).requests(dataset, model), caseRecordSchema);
