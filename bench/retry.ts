// 공통 재시도(계획 §3 N1, F2). SDK 재시도는 끄고(maxRetries 0) 세 제공자에 같은 규칙을 적용한다.
// 에러 분류는 제공자별 classify가 하고(타임아웃 클래스가 SDK마다 다르다), 여기서는 대기와 재시도만 결정한다.
import type { Attempt, ErrorClassification, JudgeRequest, Provider, RawResponse } from "./types";

const RETRYABLE_STATUSES: readonly number[] = [408, 409, 429];
const CONFIG_STATUSES: readonly number[] = [401, 403, 404];
const MAX_RETRIES = 2;
const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MULTIPLIER = 2;
const BACKOFF_MAX_MS = 5000;
const BACKOFF_JITTER = 0.25;
const RETRY_AFTER_MAX_MS = 60_000;
const BODY_SUMMARY_MAX_CHARS = 500;

/** run.json `retryPolicy`에 그대로 기록하는 규칙 설명 */
export const RETRY_POLICY = {
  sdkMaxRetries: 0,
  maxRetries: MAX_RETRIES,
  maxAttempts: MAX_RETRIES + 1,
  classification: {
    retryable: "408, 409, 429, 5xx(529 포함), 타임아웃, 연결 오류",
    deterministic: "그 외 4xx(입력 기인, 예: Jev 422, Anthropic과 OpenAI 400) → client_4xx, 캐시",
    config: "401, 403, 404(키, 권한, 모델명), API 키 없음 등 설정 오류 → 해당 모델 레인 중단, 미캐시",
    modelLevel: "refusal, format, max_tokens, range는 응답 수준의 결정적 실패로 재시도하지 않는다",
  },
  retryableStatuses: [...RETRYABLE_STATUSES, "500-599"],
  configStatuses: CONFIG_STATUSES,
  timeoutClasses: {
    jev: "APITimeoutError(APIConnectionError의 하위 클래스)",
    anthropic: "APIConnectionTimeoutError(APIConnectionError의 하위 클래스)",
    openai: "APIConnectionTimeoutError(APIConnectionError의 하위 클래스)",
  },
  headers: {
    "x-should-retry": "true면 상태 코드와 무관하게 재시도 대상, false면 재시도하지 않는다(분류는 상태 코드 규칙 유지)",
    wait: "retry-after-ms → Retry-After(초 또는 HTTP 날짜) → 지수 백오프 순",
  },
  backoff: {
    initialMs: BACKOFF_INITIAL_MS,
    multiplier: BACKOFF_MULTIPLIER,
    maxMs: BACKOFF_MAX_MS,
    jitter: `±${BACKOFF_JITTER * 100}%`,
  },
  retryAfterMaxMs: RETRY_AFTER_MAX_MS,
} as const;

// ── 분류 보조(각 제공자의 classify가 쓴다) ──

/** 응답 헤더에서 서버가 지정한 대기(ms)를 읽는다. retry-after-ms가 우선한다 */
export function readRetryAfterMs(headers: Headers, now: number = Date.now()): number | null {
  const ms = headers.get("retry-after-ms");
  if (ms !== null) {
    const value = Number.parseFloat(ms);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const retryAfter = headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  return null;
}

function readShouldRetry(headers: Headers): boolean | null {
  const value = headers.get("x-should-retry");
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function summarizeBody(body: unknown): string | null {
  if (body === undefined || body === null) return null;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > BODY_SUMMARY_MAX_CHARS ? `${text.slice(0, BODY_SUMMARY_MAX_CHARS)}…` : text;
}

/** HTTP 에러 응답(상태, 헤더, 본문)을 분류한다 */
export function classifyHttpError(status: number, headers: Headers | undefined, body: unknown): ErrorClassification {
  const shouldRetry = headers === undefined ? null : readShouldRetry(headers);
  const retryAfterMs = headers === undefined ? null : readRetryAfterMs(headers);
  const byStatus: ErrorClassification["class"] =
    RETRYABLE_STATUSES.includes(status) || status >= 500
      ? "retryable"
      : CONFIG_STATUSES.includes(status)
        ? "config"
        : "deterministic";
  return {
    class: shouldRetry === true ? "retryable" : byStatus,
    reason: String(status),
    status,
    body: summarizeBody(body),
    shouldRetry,
    retryAfterMs,
  };
}

/** HTTP 응답이 없는 실패(타임아웃, 연결, 설정 오류 등) */
export function classifyNonHttp(cls: ErrorClassification["class"], reason: string): ErrorClassification {
  return { class: cls, reason, status: null, body: null, shouldRetry: null, retryAfterMs: null };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// ── 대기 ──

/** retryIndex: 0부터(첫 재시도 전 대기가 0) */
export function backoffDelayMs(retryIndex: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_INITIAL_MS * BACKOFF_MULTIPLIER ** retryIndex, BACKOFF_MAX_MS);
  return Math.round(base * (1 + BACKOFF_JITTER * (2 * random() - 1)));
}

/** 다음 재시도 전 대기(ms). 서버 지정 대기가 있으면 60s 상한으로 우선 적용한다 */
export function retryDelayMs(
  classification: ErrorClassification,
  retryIndex: number,
  random: () => number = Math.random,
): number {
  if (classification.retryAfterMs !== null) return Math.min(classification.retryAfterMs, RETRY_AFTER_MAX_MS);
  return backoffDelayMs(retryIndex, random);
}

/** 재시도 여부. x-should-retry가 있으면 그 값이 우선한다 */
export function shouldRetry(classification: ErrorClassification): boolean {
  return classification.shouldRetry ?? classification.class === "retryable";
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ── 호출 ──

/**
 * 재시도를 거친 호출 결과.
 * - response: 원 응답(성공, 또는 결정적 4xx면 kind "http_error"). 캐시 대상
 * - failed: 재시도를 소진한 일시 실패(api) 또는 설정 오류(config). 미캐시
 */
export type RetryResult =
  | { readonly status: "response"; readonly raw: RawResponse; readonly attempts: readonly Attempt[] }
  | {
      readonly status: "failed";
      readonly errorKind: "api" | "config";
      readonly detail: string;
      readonly attempts: readonly Attempt[];
    };

export interface RetryHooks {
  /** 대기 함수(기본 setTimeout) */
  readonly sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  /** 지터용 난수(기본 Math.random) */
  readonly random?: () => number;
}

/** 제공자 호출 1건. 최대 2회 재시도하고 시도마다 Attempt를 기록한다 */
export async function judgeWithRetry(
  provider: Provider,
  request: JudgeRequest,
  hooks: RetryHooks = {},
): Promise<RetryResult> {
  const wait = hooks.sleep ?? sleep;
  const random = hooks.random ?? Math.random;
  const attempts: Attempt[] = [];

  for (let attempt = 0; ; attempt++) {
    const start = new Date();
    const started = performance.now();
    try {
      const raw = await provider.judge(request);
      attempts.push({ start: start.toISOString(), ms: Math.round(performance.now() - started), outcome: "ok" });
      return { status: "response", raw, attempts };
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      const c = provider.classify(error);
      attempts.push({ start: start.toISOString(), ms, outcome: `${c.class}:${c.reason}` });

      if (c.class === "config") {
        return { status: "failed", errorKind: "config", detail: `${c.reason}: ${c.body ?? errorMessage(error)}`, attempts };
      }
      if (c.class === "deterministic") {
        const raw: RawResponse = { kind: "http_error", status: c.status ?? 0, body: c.body ?? errorMessage(error) };
        return { status: "response", raw, attempts };
      }
      if (!shouldRetry(c) || attempt >= MAX_RETRIES) {
        return { status: "failed", errorKind: "api", detail: `${c.reason}: ${c.body ?? errorMessage(error)}`, attempts };
      }
      await wait(retryDelayMs(c, attempt, random), request.signal);
    }
  }
}
