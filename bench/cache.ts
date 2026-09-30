// 요청 캐시: `bench/.cache/responses/<제공자>/<sha256>.json`(계획 §3 캐시 H1, M5, L4).
// 키는 요청을 결정하는 모든 값(모델, 추론, 출력 상한, 타임아웃, 프롬프트/스키마 해시, SDK 버전, 질문, state)의 정규 JSON 해시다.
// 파서 해시는 키에 넣지 않는다. 원 응답을 저장하고 읽을 때 파싱하므로 파서가 바뀌어도 재호출하지 않는다.
// 저장 대상은 원 응답이 있는 호출(성공 + 결정적 실패)뿐이고, 일시 실패(api)와 설정 실패(config)는 저장하지 않는다.
import type { JsonValue } from "@typesafe-ai/sdk";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { MAX_TOKENS_DEFAULT, MAX_TOKENS_OFF } from "./providers/anthropic";
import { MAX_OUTPUT_TOKENS_DEFAULT, MAX_OUTPUT_TOKENS_OFF } from "./providers/openai";
import { outputSchemaHash, sha256, systemPromptHash, toQuestions } from "./providers/prompt";
import type { BenchState, CacheEntry, ModelSpec, Provider, ProviderId, ReasoningMode, TaskDefinition } from "./types";

/** 캐시 형식이나 키 구성이 바뀌면 올린다(이전 항목은 자연히 무효) */
export const CACHE_VERSION = 1;

const CACHE_ROOT = fileURLToPath(new URL("./.cache/responses/", import.meta.url));

/** 출력 토큰 상한(요청 본문에 들어가는 값). Jev는 상한 옵션이 없다 */
export function maxTokensFor(provider: ProviderId, reasoning: ReasoningMode): number | null {
  const off = reasoning === "off";
  switch (provider) {
    case "jev":
      return null;
    case "anthropic":
      return off ? MAX_TOKENS_OFF : MAX_TOKENS_DEFAULT;
    case "openai":
      return off ? MAX_OUTPUT_TOKENS_OFF : MAX_OUTPUT_TOKENS_DEFAULT;
  }
}

/** 객체 키를 정렬한 JSON(같은 값이면 같은 문자열) */
function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

export interface CacheKeyInput {
  readonly provider: Provider;
  readonly model: ModelSpec;
  readonly reasoning: ReasoningMode;
  readonly timeoutMs: number;
  readonly tasks: readonly TaskDefinition[];
  readonly state: BenchState;
}

// 질문 정의와 state는 JSON 값이지만 SDK 타입(EntryType 등)이라 JSON 스키마로 한 번 좁혀 키에 넣는다
const JsonValueSchema = z.json();

export function cacheKey(input: CacheKeyInput): string {
  const { provider, model, reasoning, timeoutMs, tasks, state } = input;
  // Jev는 system 프롬프트와 출력 스키마가 없다(질문 JSON이 그대로 요청에 들어간다)
  const llm = provider.id !== "jev";
  const key: JsonValue = {
    cacheVersion: CACHE_VERSION,
    provider: provider.id,
    model: model.apiModel,
    reasoning: provider.id === "jev" ? "n/a" : reasoning,
    maxTokens: maxTokensFor(provider.id, reasoning),
    timeoutMs,
    systemPromptHash: llm ? systemPromptHash(tasks) : null,
    outputSchemaHash: llm ? outputSchemaHash(tasks) : null,
    sdkVersion: provider.sdkVersion,
    tasks: JsonValueSchema.parse(toQuestions(tasks)),
    state: JsonValueSchema.parse(state),
  };
  return sha256(canonicalJson(key));
}

function entryPath(provider: ProviderId, key: string): string {
  return path.join(CACHE_ROOT, provider, `${key}.json`);
}

const tokenUsageSchema = z.object({ inputTokens: z.number(), outputTokens: z.number() });

const cacheEntrySchema: z.ZodType<CacheEntry> = z.object({
  key: z.string(),
  raw: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("response"),
      model: z.string().nullable(),
      output: z.json(),
      stop: z.string().nullable(),
      usage: tokenUsageSchema.nullable(),
    }),
    z.object({ kind: z.literal("http_error"), status: z.number(), body: z.string() }),
  ]),
  attempts: z.array(
    z.object({
      start: z.string(),
      ms: z.number(),
      outcome: z.union([
        z.literal("ok"),
        z.templateLiteral(["retryable:", z.string()]),
        z.templateLiteral(["deterministic:", z.string()]),
        z.templateLiteral(["config:", z.string()]),
      ]),
    }),
  ),
  measuredAt: z.string(),
});

/** 캐시 항목(없으면 null). 형식이 깨진 파일은 없는 것으로 보고 경고한다 */
export async function readCache(provider: ProviderId, key: string): Promise<CacheEntry | null> {
  const file = entryPath(provider, key);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  const parsed = cacheEntrySchema.safeParse(JSON.parse(text));
  if (!parsed.success || parsed.data.key !== key) {
    console.warn(`경고: 캐시 항목 형식이 올바르지 않아 무시합니다: ${file}`);
    return null;
  }
  return parsed.data;
}

/** 원자적으로 쓴다(임시 파일 → rename). 중단돼도 반쯤 쓴 항목이 남지 않는다 */
export async function writeCache(provider: ProviderId, entry: CacheEntry): Promise<void> {
  const file = entryPath(provider, entry.key);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(entry)}\n`, "utf8");
  await rename(tmp, file);
}
