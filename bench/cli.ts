// 벤치 진입점(pnpm bench). 공개 벤치마크로 Jev, Claude, OpenAI 모델을 같은 질문 정의와 입력, 표본으로 비교한다.
// 흐름: 인자 해석 → 키 확인 → 데이터셋 준비와 표본 → 캐시 조회 → 미리보기와 확인 → 제공자별 레인 실행 → 결과 폴더.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { DEFAULT_DATASET_IDS } from "./datasets";
import { loadEnronTruncatedIds } from "./datasets/enron-spam";
import { JBB_STATE_NOTE } from "./datasets/jbb-judge";
import { loadKmhasCategories } from "./datasets/kmhas";
import { MODELS } from "./models";
import {
  COST_SAFETY_FACTOR,
  costUsd,
  lookupCache,
  planCell,
  prepareDatasets,
  renderPreview,
  selectModels,
  TIMEOUT_MS,
  type CacheLookup,
  type PlannedCell,
  type PlannedDataset,
  type Skipped,
} from "./plan";
import { createProvider } from "./providers";
import { outputSchemaHash, sha256, systemPromptHash } from "./providers/prompt";
import { buildMetrics } from "./report/build";
import { resultFolderName, resultPaths, writeJson, writeJsonl, type RunInfo } from "./report/raw";
import { writeReport } from "./report-cli";
import { RETRY_POLICY } from "./retry";
import { LANE_INTERPRETATION, lookupId, runBench, type Outcomes } from "./run";
import { BENCH_SEED } from "./stats/prng";
import {
  DATASET_IDS,
  MODEL_ALIASES,
  REASONING_MODES,
  type BenchOptions,
  type CaseRecord,
  type DatasetId,
  type ModelAlias,
  type Provider,
  type ProviderId,
  type ReasoningMode,
} from "./types";

const DEFAULT_LIMIT = 300;
const BENCH_DIR = fileURLToPath(new URL("./", import.meta.url));
const RESULTS_ROOT = path.join(BENCH_DIR, "results");
/** 파서 해시에 넣는 소스(원 응답 → 답 변환 규칙) */
const PARSER_SOURCES = ["providers/prompt.ts", "providers/jev.ts", "providers/anthropic.ts", "providers/openai.ts"];

const HELP = `사용법: pnpm bench [옵션]

공개 벤치마크로 Jev와 Claude, OpenAI 모델을 비교한다.
실행 전에 호출 수, 예상 캐시 적중, 토큰, 비용, 시간을 보여 주고 확인을 받는다.
결과는 bench/results/<시각>/에 저장한다.

옵션:
  --models <별칭,...>     비교할 모델(기본: 키가 있는 모든 모델)
                          별칭: ${MODEL_ALIASES.join(", ")}
  --datasets <id,...>     데이터셋(기본: 기본 세트 ${DEFAULT_DATASET_IDS.length}개)
                          id: ${DATASET_IDS.join(", ")}
  --limit <n>             데이터셋당 표본 수(기본 ${DEFAULT_LIMIT}, 층화, 시드 고정)
  --reasoning <모드>      추론 모드: ${REASONING_MODES.join(" | ")}(기본 off)
  -y, --yes               미리보기 확인을 건너뛴다(비TTY에서는 필수)
  --no-cache              요청 캐시 읽기와 쓰기를 모두 끈다
  -h, --help              이 도움말을 출력한다

진행 표시: . 성공, x 실패, c 캐시 적중

관련 명령:
  pnpm bench:report <폴더>  저장된 결과로 요약과 차트 재생성(API 호출 없음)
`;

class UsageError extends Error {}

function parseList<T extends string>(raw: string | undefined, allowed: readonly T[], what: string, fallback: readonly T[]): T[] {
  if (raw === undefined) return [...fallback];
  const out: T[] = [];
  for (const item of raw.split(",").map((s) => s.trim()).filter((s) => s !== "")) {
    const found = allowed.find((a) => a === item);
    if (found === undefined) throw new UsageError(`알 수 없는 ${what}: ${item} (가능: ${allowed.join(", ")})`);
    if (!out.includes(found)) out.push(found);
  }
  if (out.length === 0) throw new UsageError(`${what} 목록이 비어 있습니다. 하나 이상 지정하세요.`);
  return out;
}

function parseOptions(argv: readonly string[]): BenchOptions | "help" {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      models: { type: "string" },
      datasets: { type: "string" },
      limit: { type: "string" },
      reasoning: { type: "string" },
      yes: { type: "boolean", short: "y" },
      "no-cache": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help === true) return "help";

  const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new UsageError(`--limit은 1 이상의 정수여야 합니다: ${values.limit}`);
  const reasoningRaw = values.reasoning ?? "off";
  const reasoning: ReasoningMode | undefined = REASONING_MODES.find((m) => m === reasoningRaw);
  if (reasoning === undefined) throw new UsageError(`--reasoning은 ${REASONING_MODES.join(" | ")} 중 하나여야 합니다: ${reasoningRaw}`);

  return {
    models: parseList<ModelAlias>(values.models, MODEL_ALIASES, "모델 별칭", MODEL_ALIASES),
    datasets: parseList<DatasetId>(values.datasets, DATASET_IDS, "데이터셋 id", DEFAULT_DATASET_IDS),
    limit,
    reasoning,
    yes: values.yes === true,
    noCache: values["no-cache"] === true,
  };
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(question);
    return /^(y|yes|예|네)$/iu.test(answer.trim());
  } finally {
    rl.close();
  }
}

function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: BENCH_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

async function parserHash(): Promise<string> {
  const texts = await Promise.all(PARSER_SOURCES.map((file) => readFile(path.join(BENCH_DIR, file), "utf8")));
  return sha256(texts.join("\u0000"));
}

// ── 결과 파일 ──

function caseRecords(dataset: PlannedDataset, model: ModelAlias, outcomes: Outcomes): CaseRecord[] {
  const byCase = outcomes.get(dataset.spec.id)?.get(model);
  if (byCase === undefined) return [];
  return dataset.cases.flatMap((c): CaseRecord[] => {
    const o = byCase.get(c.id);
    if (o === undefined) return [];
    const raw = o.raw;
    // 입력 텍스트(state)는 담지 않는다
    return [
      {
        id: c.id,
        dataset: dataset.spec.id,
        model,
        cached: o.cached,
        output: raw !== null && raw.kind === "response" ? raw.output : null,
        stop: raw !== null && raw.kind === "response" ? raw.stop : null,
        answers: o.ok ? o.answers : null,
        errorKind: o.ok ? null : o.errorKind,
        detail: o.ok ? null : o.detail,
        usage: o.usage,
        attempts: o.attempts,
        measuredAt: o.measuredAt,
      },
    ];
  });
}

/** run.json 데이터셋 노트. 표본 규칙, 제외, 절단, 원 범주 등 재현과 해석에 필요한 기록 */
async function datasetNotes(d: PlannedDataset): Promise<string[]> {
  const notes = [`표본 시드: 층마다 deriveSeed(${BENCH_SEED}, "sample", "${d.spec.id}", <층 이름>)로 mulberry32 셔플 후 최대 나머지법 배분`];
  if (d.excluded > 0) notes.push(`toCase 제외 ${d.excluded}행(라벨 없음 등)`);
  if (d.meta.kind === "hf" && d.meta.truncated_cells > 0) {
    notes.push(`datasets-server 응답 크기 제한으로 잘린 셀 ${d.meta.truncated_cells}개(모집단 전체)`);
  }
  const inSample = (ids: ReadonlySet<string>) => d.cases.filter((c) => ids.has(c.id)).length;
  switch (d.spec.id) {
    case "jbb-judge":
      notes.push(JBB_STATE_NOTE);
      break;
    case "enron-spam": {
      const truncated = await loadEnronTruncatedIds();
      if (truncated !== null) notes.push(`본문 절단(${d.spec.maxInputChars ?? 0}자 또는 셀 잘림) 표본 ${inSample(truncated)}건`);
      break;
    }
    case "kmhas": {
      // 다중 레이블을 이진으로 접었으므로 표본의 원 범주 분포를 남긴다
      const categories = await loadKmhasCategories();
      const counts = new Map<string, number>();
      for (const c of d.cases) for (const name of categories.get(c.id) ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
      const text = [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(", ");
      notes.push(`원 범주 분포(다중 레이블, [not_hate_speech]만이면 false): ${text}`);
      break;
    }
    case "demo-smoke":
      notes.push(`지표 제외 경계 사례 표본 ${inSample(d.metricExcludedIds)}건, 과제별 정답이 없는 케이스는 그 과제 채점에서 제외`);
      break;
    default:
      break;
  }
  return notes;
}

// ── 본체 ──

async function main(): Promise<void> {
  const parsed = parseOptions(process.argv.slice(2));
  if (parsed === "help") {
    console.log(HELP);
    return;
  }
  const options = parsed;

  const selected = selectModels(options.models);
  const skipped: Skipped[] = [...selected.skipped];
  if (selected.models.length === 0) {
    for (const s of skipped) console.error(`건너뜀 ${s.target}: ${s.reason}`);
    throw new UsageError("실행할 수 있는 모델이 없습니다(.env의 API 키를 확인하세요).");
  }

  const prepared = await prepareDatasets(options.datasets, options.limit);
  skipped.push(...prepared.skipped);
  const datasets = prepared.datasets;
  if (datasets.length === 0) throw new UsageError("실행할 수 있는 데이터셋이 없습니다.");

  const providers = new Map<ProviderId, Provider>();
  for (const m of selected.models) if (!providers.has(m.provider)) providers.set(m.provider, createProvider(m.provider));
  const providerOf = (provider: ProviderId): Provider => {
    const p = providers.get(provider);
    if (p === undefined) throw new Error(`제공자가 준비되지 않았습니다: ${provider}`);
    return p;
  };

  const lookups = new Map<string, CacheLookup>();
  const cells: PlannedCell[] = [];
  for (const m of selected.models) {
    for (const d of datasets) {
      const lookup = await lookupCache(providerOf(m.provider), m, d, options);
      lookups.set(lookupId(d.spec.id, m.alias), lookup);
      cells.push(planCell(m, d, lookup));
    }
  }

  console.log(renderPreview(cells, options, skipped));
  console.log("");

  if (!options.yes) {
    if (!process.stdin.isTTY) {
      console.error("대화형 터미널이 아니어서 확인을 받을 수 없습니다. 미리보기를 확인한 뒤 --yes를 붙여 다시 실행하세요.");
      process.exitCode = 1;
      return;
    }
    const total = cells.reduce((s, c) => s + c.costUsd, 0) * COST_SAFETY_FACTOR;
    if (!(await confirm(`예상 비용 약 $${total.toFixed(2)}. 실행할까요? [y/N] `))) {
      console.error("취소했습니다.");
      return;
    }
  }

  const startedAt = new Date();
  const run = await runBench({ options, models: selected.models, providers, datasets, lookups });
  const finishedAt = new Date();
  skipped.push(...run.skipped);

  const root = path.join(RESULTS_ROOT, resultFolderName(startedAt));
  const paths = resultPaths(root);
  for (const d of datasets) {
    for (const m of selected.models) {
      const records = caseRecords(d, m.alias, run.outcomes);
      if (records.length > 0) await writeJsonl(paths.requests(d.spec.id, m.alias), records);
    }
  }

  const promptHashes: Record<string, string> = {};
  const schemaHashes: Record<string, string> = {};
  for (const d of datasets) {
    promptHashes[d.spec.id] = systemPromptHash(d.spec.tasks);
    schemaHashes[d.spec.id] = outputSchemaHash(d.spec.tasks);
  }
  const sdkVersions: Record<string, string> = {};
  for (const [id, p] of providers) sdkVersions[id] = p.sdkVersion;

  const runInfo: RunInfo = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    commit: gitCommit(),
    options: { ...options, models: [...options.models], datasets: [...options.datasets] },
    seed: BENCH_SEED,
    timeoutMs: TIMEOUT_MS,
    temperature: "unset",
    retryPolicy: z.json().parse(RETRY_POLICY),
    parserHash: await parserHash(),
    systemPromptHash: promptHashes,
    outputSchemaHash: schemaHashes,
    sdkVersions,
    laneInterpretation: LANE_INTERPRETATION,
    lanes: run.lanes.map((l) => ({ provider: l.provider, models: [...l.models], start: l.start, end: l.end })),
    models: selected.models.map((m) => ({
      alias: m.alias,
      provider: m.provider,
      apiModel: m.apiModel,
      pricing: m.pricing,
      tokenizerFactor: m.tokenizerFactor,
      outputTokenFactor: m.outputTokenFactor,
      probabilitySource: providerOf(m.provider).probabilitySource,
    })),
    datasets: await Promise.all(
      datasets.map(async (d) => ({
        id: d.spec.id,
        tier: d.spec.tier,
        license: d.spec.license,
        source:
          d.spec.source.kind === "hf"
            ? { kind: "hf" as const, repo: d.spec.source.repo, config: d.spec.source.config, split: d.spec.source.split }
            : { kind: "local" as const, path: d.spec.source.path },
        revision: d.meta.revision,
        numRows: d.meta.num_rows,
        sampleIds: d.cases.map((c) => c.id),
        strata: { ...d.strata },
        maxInputChars: d.spec.maxInputChars ?? null,
        notes: await datasetNotes(d),
      })),
    ),
    skipped,
  };
  await writeJson(paths.run, runInfo);

  const metrics = await buildMetrics({
    runInfo,
    models: selected.models,
    probabilitySources: new Map(selected.models.map((m) => [m.alias, providerOf(m.provider).probabilitySource] as const)),
    datasets,
    outcomes: run.outcomes,
    skipped,
  });
  await writeJson(paths.metrics, metrics);
  await writeReport(root, metrics);

  // 청구 추정은 호출 단위로 센다(과제가 여럿인 데이터셋도 호출은 한 번)
  let calls = 0;
  let hits = 0;
  let billed = 0;
  for (const byModel of run.outcomes.values()) {
    for (const [alias, byCase] of byModel) {
      for (const o of byCase.values()) {
        calls++;
        if (o.cached) hits++;
        else if (o.usage !== null) billed += costUsd(MODELS[alias], o.usage.inputTokens, o.usage.outputTokens);
      }
    }
  }
  console.log("");
  console.log(`완료: 호출 ${calls}건(캐시 적중 ${hits}건), 이번 실행 청구 추정 $${billed.toFixed(4)}`);
  console.log(`결과: ${root}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof UsageError ? `오류: ${error.message}` : error);
  process.exitCode = 1;
});
