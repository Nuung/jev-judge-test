// 실행 계획 — 데이터셋을 받아 표본을 뽑고, 모델×데이터셋별 호출 수·예상 캐시 적중·토큰·비용·시간을 추정한다(계획 §6 U4, §7).
// 토큰 추정은 o200k 근사(영어 문자÷4, 한글 문자÷1.5)에 모델별 입력 계수를, 출력 기준선(과제당 25)에 출력 계수를 곱한다(models.ts).
import { loadDataset, type DatasetMeta } from "./data/store";
import { stratifiedSample } from "./data/sample";
import { DATASETS } from "./datasets";
import { loadDemoSmokeBoundaryIds } from "./datasets/demo-smoke";
import { cacheKey, readCache } from "./cache";
import { MODELS } from "./models";
import { modelAvailability } from "./providers";
import { buildSystemPrompt, buildUserMessage, toQuestions } from "./providers/prompt";
import type {
  BenchCase,
  BenchOptions,
  BenchState,
  CacheEntry,
  DatasetId,
  DatasetSpec,
  ModelAlias,
  ModelSpec,
  Provider,
  ProviderId,
  TaskDefinition,
} from "./types";

/** 시도당 타임아웃(ms) — 세 제공자 공통 */
export const TIMEOUT_MS = 60_000;

/** 미리보기 표시값 = 추정 × 안전계수 */
export const COST_SAFETY_FACTOR = 1.3;

/** 과제 하나당 출력 토큰 기준선(§7 표의 25) */
const OUTPUT_TOKENS_PER_TASK = 25;

/** `--reasoning default`의 출력 상한(비용 상한 열) */
const DEFAULT_REASONING_MAX_OUTPUT = 4096;

/** 호출당 가정 지연(초, §7 시간 추정) — 스모크 실측으로 다시 본다 */
const ASSUMED_LATENCY_S: Readonly<Record<ModelAlias, number>> = {
  jev: 0.5,
  haiku: 1.5,
  sonnet: 3,
  luna: 1,
  sol: 2,
};

/** 제공자 레인 순서와 레인 안 모델 순서(D3) */
export const LANE_ORDER: readonly ProviderId[] = ["jev", "anthropic", "openai"];

export interface Skipped {
  readonly target: string;
  readonly reason: string;
}

export interface PlannedDataset {
  readonly spec: DatasetSpec;
  readonly meta: DatasetMeta;
  /** 표본(모집단 순서) */
  readonly cases: readonly BenchCase[];
  /** 층 이름 → 표본 수 */
  readonly strata: Readonly<Record<string, number>>;
  /** 모집단 크기(toCase가 null인 행 제외 후) */
  readonly population: number;
  /** toCase가 null을 돌려 모집단에서 뺀 행 수 */
  readonly excluded: number;
  /** 지표에서 뺄 케이스 id(demo-smoke 경계 사례) */
  readonly metricExcludedIds: ReadonlySet<string>;
}

/** 모델 × 데이터셋 한 칸의 호출 계획 */
export interface PlannedCell {
  readonly dataset: DatasetId;
  readonly model: ModelAlias;
  readonly calls: number;
  readonly cacheHits: number;
  /** 캐시 미스 호출의 추정 토큰(c 적용) */
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** 캐시 미스 호출의 추정 비용(안전계수 적용 전) */
  readonly costUsd: number;
  /** 출력이 상한(4096)까지 나올 때의 비용(`--reasoning default`, 안전계수 미적용) */
  readonly upperCostUsd: number;
  readonly seconds: number;
}

// ── 데이터셋 ──

/** 선택한 데이터셋을 받고(캐시 우선) 표본을 뽑는다. gated·인증 실패는 건너뜀 사유로 돌려준다 */
export async function prepareDatasets(
  ids: readonly DatasetId[],
  limit: number,
): Promise<{ datasets: PlannedDataset[]; skipped: Skipped[] }> {
  const datasets: PlannedDataset[] = [];
  const skipped: Skipped[] = [];
  // HF 요청 제한 때문에 데이터셋은 하나씩 받는다
  for (const id of ids) {
    const spec = DATASETS[id];
    console.error(`[data] ${id} 준비 중…`);
    const load = await loadDataset(spec);
    if (!load.ok) {
      skipped.push({ target: `dataset:${id}`, reason: load.skipReason });
      continue;
    }
    const sample = stratifiedSample(load.cases, limit, id);
    const strata: Record<string, number> = {};
    for (const [name, a] of Object.entries(sample.allocation)) strata[name] = a.sampled;
    const metricExcludedIds = id === "demo-smoke" ? await loadDemoSmokeBoundaryIds() : new Set<string>();
    datasets.push({
      spec,
      meta: load.meta,
      cases: sample.cases,
      strata,
      population: load.cases.length,
      excluded: load.excluded,
      metricExcludedIds,
    });
  }
  return { datasets, skipped };
}

// ── 모델 ──

export function selectModels(aliases: readonly ModelAlias[]): { models: ModelSpec[]; skipped: Skipped[] } {
  const models: ModelSpec[] = [];
  const skipped: Skipped[] = [];
  for (const alias of aliases) {
    const availability = modelAvailability(alias);
    if (availability.available) models.push(MODELS[alias]);
    else skipped.push({ target: `model:${alias}`, reason: availability.reason });
  }
  return { models, skipped };
}

// ── 토큰·비용 추정 ──

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/gu;

/** o200k 근사 토큰 수(영어 문자÷4, 한글 문자÷1.5) */
export function estimateTokens(text: string): number {
  const hangul = text.match(HANGUL)?.length ?? 0;
  const other = [...text].length - hangul;
  return hangul / 1.5 + other / 4;
}

/** 호출 1건의 기준 입력 토큰(c 적용 전). LLM은 system 프롬프트 + user 턴, Jev는 질문 JSON + state */
function baseInputTokens(provider: ProviderId, tasks: readonly TaskDefinition[], state: BenchState): number {
  if (provider === "jev") return estimateTokens(JSON.stringify(toQuestions(tasks)) + JSON.stringify(state));
  return estimateTokens(buildSystemPrompt(tasks) + buildUserMessage(state));
}

export function costUsd(model: ModelSpec, inputTokens: number, outputTokens: number): number {
  return (inputTokens * model.pricing.inputPerMTok + outputTokens * model.pricing.outputPerMTok) / 1e6;
}

/** 케이스별 캐시 항목(캐시를 끄면 모두 null) — 미리보기와 러너가 같은 조회 결과를 쓴다 */
export type CacheLookup = ReadonlyMap<string, CacheEntry | null>;

export async function lookupCache(
  provider: Provider,
  model: ModelSpec,
  dataset: PlannedDataset,
  options: BenchOptions,
): Promise<CacheLookup> {
  const out = new Map<string, CacheEntry | null>();
  for (const c of dataset.cases) {
    if (options.noCache) {
      out.set(c.id, null);
      continue;
    }
    const key = cacheKey({
      provider,
      model,
      reasoning: options.reasoning,
      timeoutMs: TIMEOUT_MS,
      tasks: dataset.spec.tasks,
      state: c.state,
    });
    out.set(c.id, await readCache(provider.id, key));
  }
  return out;
}

export function planCell(model: ModelSpec, dataset: PlannedDataset, lookup: CacheLookup): PlannedCell {
  const c = model.tokenizerFactor;
  const cOut = model.outputTokenFactor;
  const tasks = dataset.spec.tasks;
  let calls = 0;
  let cacheHits = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let upperOutputTokens = 0;
  for (const bc of dataset.cases) {
    calls++;
    const hit = lookup.get(bc.id);
    if (hit !== undefined && hit !== null) {
      cacheHits++;
      continue;
    }
    inputTokens += baseInputTokens(model.provider, tasks, bc.state) * c;
    const expectedOutput = OUTPUT_TOKENS_PER_TASK * tasks.length * cOut;
    outputTokens += expectedOutput;
    // 상한은 max_tokens 자체(제공자 토큰 기준이라 계수를 곱하지 않는다). Jev는 추론 옵션이 없어 off와 같다
    upperOutputTokens += model.provider === "jev" ? expectedOutput : DEFAULT_REASONING_MAX_OUTPUT;
  }
  const misses = calls - cacheHits;
  return {
    dataset: dataset.spec.id,
    model: model.alias,
    calls,
    cacheHits,
    inputTokens,
    outputTokens,
    costUsd: costUsd(model, inputTokens, outputTokens),
    upperCostUsd: costUsd(model, inputTokens, upperOutputTokens),
    seconds: misses * ASSUMED_LATENCY_S[model.alias],
  };
}

// ── 미리보기 표 ──

function fmtInt(x: number): string {
  return Math.round(x).toLocaleString("en-US");
}

function fmtUsd(x: number): string {
  if (x === 0) return "$0";
  if (x < 0.01) return `$${x.toFixed(4)}`;
  return `$${x.toFixed(2)}`;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}초`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const width = (s: string) => [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힣]/u.test(ch) ? 2 : 1), 0);
  const widths = header.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ""))));
  const pad = (s: string, w: number, right: boolean) => {
    const fill = " ".repeat(Math.max(0, w - width(s)));
    return right ? fill + s : s + fill;
  };
  const line = (cells: readonly string[]) => cells.map((c, i) => pad(c, widths[i], i > 1)).join("  ");
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

/** 레인별 예상 시간(레인 안 순차 합)과 벽시계(레인 최댓값) */
export function laneSeconds(cells: readonly PlannedCell[]): { lanes: Map<ProviderId, number>; wall: number } {
  const lanes = new Map<ProviderId, number>();
  for (const cell of cells) {
    const provider = MODELS[cell.model].provider;
    lanes.set(provider, (lanes.get(provider) ?? 0) + cell.seconds);
  }
  return { lanes, wall: Math.max(0, ...lanes.values()) };
}

export function renderPreview(cells: readonly PlannedCell[], options: BenchOptions, skipped: readonly Skipped[]): string {
  const showUpper = options.reasoning === "default";
  const header = [
    "모델",
    "데이터셋",
    "호출",
    "캐시 적중",
    "입력 토큰",
    "출력 토큰",
    `비용(×${COST_SAFETY_FACTOR})`,
    "시간",
    ...(showUpper ? ["default 상한"] : []),
  ];
  const row = (model: string, dataset: string, cs: readonly PlannedCell[]): string[] => {
    const sum = (f: (c: PlannedCell) => number) => cs.reduce((acc, c) => acc + f(c), 0);
    return [
      model,
      dataset,
      fmtInt(sum((c) => c.calls)),
      fmtInt(sum((c) => c.cacheHits)),
      fmtInt(sum((c) => c.inputTokens)),
      fmtInt(sum((c) => c.outputTokens)),
      fmtUsd(sum((c) => c.costUsd) * COST_SAFETY_FACTOR),
      fmtDuration(sum((c) => c.seconds)),
      ...(showUpper ? [fmtUsd(sum((c) => c.upperCostUsd))] : []),
    ];
  };
  const rows: string[][] = [];
  const models = [...new Set(cells.map((c) => c.model))];
  for (const model of models) {
    const mine = cells.filter((c) => c.model === model);
    for (const cell of mine) rows.push(row(model, cell.dataset, [cell]));
    rows.push(row(model, "(소계)", mine));
  }
  rows.push(row("합계", "", cells));

  const { lanes, wall } = laneSeconds(cells);
  const laneText = LANE_ORDER.filter((p) => lanes.has(p))
    .map((p) => `${p} ${fmtDuration(lanes.get(p) ?? 0)}`)
    .join(" · ");
  const lines = [
    `미리보기 — 추론 ${options.reasoning} · 데이터셋당 최대 ${options.limit}건 · 캐시 ${options.noCache ? "끔" : "켬"}`,
    "",
    renderTable(header, rows),
    "",
    `비용은 캐시 미스 호출만 추정해 안전계수 ${COST_SAFETY_FACTOR}을 곱한 값이다(토큰은 o200k 근사 × 모델별 입력·출력 계수).`,
    ...(showUpper
      ? ["default 상한은 출력이 max_tokens 4096을 모두 쓸 때의 비용이다(안전계수 미적용)."]
      : []),
    `예상 시간(가정 지연 기준): ${laneText} → 벽시계 약 ${fmtDuration(wall)}(제공자별 레인 동시 실행, 레인 안 순차)`,
  ];
  if (skipped.length > 0) {
    lines.push("", "건너뜀:", ...skipped.map((s) => `  - ${s.target}: ${s.reason}`));
  }
  return lines.join("\n");
}
