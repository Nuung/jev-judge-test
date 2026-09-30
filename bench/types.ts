// 벤치 공용 타입. 데이터셋, 제공자, 러너, 리포트가 공유하는 인터페이스(계획 §3).
// 질문 정의는 SDK의 plain JSON 형식(ChoiceQuestion/NoulQuestion)을 그대로 쓴다. 모든 모델이 같은 정의를 받는다.
import type { ChoiceQuestion, JsonValue, NoulQuestion } from "@typesafe-ai/sdk";
import type { z } from "zod";

// ── 식별자 ──

/** CLI 모델 별칭(미등록 별칭은 단가가 없어 오류) */
export const MODEL_ALIASES = ["jev", "haiku", "sonnet", "luna", "sol"] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const DATASET_IDS = [
  "sst2",
  "ag-news",
  "banking77",
  "enron-spam",
  "jbb-judge",
  "klue-ynat",
  "kmhas",
  "wildguardmix",
  "toxicchat",
  "demo-smoke",
] as const;
export type DatasetId = (typeof DATASET_IDS)[number];

export type ProviderId = "jev" | "anthropic" | "openai";

/** off = 추론 끔(기본), default = 제공자 기본값(비용 상한 4096 토큰) */
export const REASONING_MODES = ["off", "default"] as const;
export type ReasoningMode = (typeof REASONING_MODES)[number];

/** 보정 확률의 출처. Jev는 모델이 직접 낸 확률, LLM은 말로 답한(verbalized) 확률 */
export type ProbabilitySource = "jev-direct" | "verbalized";

// ── 질문과 케이스 ──

/** Choice 과제. labels는 라벨 체계 전체(macro-F1 고정 클래스 목록, criteria 키와 같은 순서) */
export interface ChoiceTask {
  readonly name: string;
  readonly kind: "choice";
  readonly labels: readonly string[];
  readonly question: ChoiceQuestion;
}

/** Noul(예/아니오) 과제 */
export interface NoulTask {
  readonly name: string;
  readonly kind: "noul";
  readonly question: NoulQuestion;
}

export type TaskDefinition = ChoiceTask | NoulTask;

/** 모델에 보내는 state(JSON 객체) */
export type BenchState = { readonly [key: string]: JsonValue };

/** 과제별 정답. Choice는 라벨, Noul은 boolean */
export type GoldValue = string | boolean;

export interface BenchCase {
  /** 데이터셋 안에서 유일한 id(원본 행 번호 등). 결과 파일에는 id만 남기고 입력 텍스트는 남기지 않는다 */
  readonly id: string;
  readonly state: BenchState;
  /** 과제 이름 → 정답 */
  readonly gold: Readonly<Record<string, GoldValue>>;
  /** 층화 추출 층 이름 */
  readonly stratum: string;
}

// ── 데이터셋 ──

export type DatasetTier = "default" | "optional" | "smoke";

export type DatasetSource =
  | {
      readonly kind: "hf";
      readonly repo: string;
      readonly config: string;
      readonly split: string;
      /** gated 데이터셋이면 HF_TOKEN 필요(없거나 401, 403이면 건너뜀) */
      readonly requiresToken: boolean;
    }
  | { readonly kind: "local"; readonly path: string };

export type PrimaryMetric = "accuracy" | "macro_f1" | "f1_positive";

export interface DatasetSpec<Row = unknown> {
  readonly id: DatasetId;
  readonly tier: DatasetTier;
  readonly source: DatasetSource;
  /** HF 카드 값 그대로(unknown, 표기 없음 포함) */
  readonly license: string;
  readonly tasks: readonly TaskDefinition[];
  /** 원본 행 검증(경계에서 zod로 좁힌다) */
  readonly rowSchema: z.ZodType<Row>;
  /**
   * 검증된 행을 케이스로 바꾼다. null이면 모집단에서 제외(예: 라벨 null).
   * 메서드 표기라 매개변수가 쌍변(bivariant)이어서 DatasetSpec<Row>를 DatasetSpec<unknown> 목록에 담을 수 있다.
   */
  toCase(row: Row, rowIndex: number): BenchCase | null;
  readonly primaryMetric: PrimaryMetric;
  /** 입력 텍스트 절단 길이(모든 모델에 동일 적용) */
  readonly maxInputChars?: number;
}

// ── 모델 ──

export interface ModelPricing {
  /** 입력 100만 토큰당 달러 */
  readonly inputPerMTok: number;
  /** 출력 100만 토큰당 달러 */
  readonly outputPerMTok: number;
  /** 단가 출처(URL, 조회일) */
  readonly source: string;
}

export interface ModelSpec {
  readonly alias: ModelAlias;
  readonly provider: ProviderId;
  /** 제공자 API에 보내는 모델명 */
  readonly apiModel: string;
  readonly pricing: ModelPricing;
  /** 입력 토큰 추정 계수 c. o200k 근사 기준선에 곱한다(§7) */
  readonly tokenizerFactor: number;
  /** 출력 토큰 추정 계수. 과제당 기준선 25토큰에 곱한다 */
  readonly outputTokenFactor: number;
}

// ── 시도와 실패 분류 ──

/** 시도 1회의 결과. 사유는 콜론 뒤에 붙인다(예: "retryable:429", "deterministic:client_4xx") */
export type AttemptOutcome = "ok" | `retryable:${string}` | `deterministic:${string}` | `config:${string}`;

export interface Attempt {
  /** 시도 시작 시각(ISO 8601) */
  readonly start: string;
  readonly ms: number;
  readonly outcome: AttemptOutcome;
}

/**
 * 호출 실패 종류. refusal, format, max_tokens, range, client_4xx는 결정적(캐시),
 * api는 재시도를 소진한 일시 실패(미캐시), config는 키, 권한, 모델명 문제(레인 중단, 미캐시)
 */
export type ErrorKind = "refusal" | "format" | "max_tokens" | "range" | "client_4xx" | "api" | "config";

/** 캐시되는 결정적 실패 */
export type DeterministicErrorKind = Exclude<ErrorKind, "api" | "config">;

/** SDK 에러 분류 결과. 제공자별 classify가 만들고 bench/retry.ts가 대기와 재시도를 결정한다 */
export interface ErrorClassification {
  readonly class: "retryable" | "deterministic" | "config";
  /** 기록용 사유(예: "429", "timeout", "connection", "401") */
  readonly reason: string;
  /** HTTP 상태 코드(연결 오류나 타임아웃이면 null) */
  readonly status: number | null;
  /** 응답 본문 요약(결정적 실패 캐시용, 없으면 null) */
  readonly body: string | null;
  /** `x-should-retry` 헤더(true/false), 없으면 null */
  readonly shouldRetry: boolean | null;
  /** `retry-after-ms` → `Retry-After`(초 또는 HTTP 날짜) 순으로 해석한 대기(ms), 없으면 null */
  readonly retryAfterMs: number | null;
}

// ── 요청과 응답 ──

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface JudgeRequest {
  readonly model: ModelSpec;
  readonly tasks: readonly TaskDefinition[];
  readonly state: BenchState;
  readonly reasoning: ReasoningMode;
  /** 시도당 타임아웃(ms), 세 제공자 모두 60000 */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/**
 * 캐시에 저장하는 원 응답. 파싱은 읽을 때 하므로(parserHash는 캐시 키 밖) 파서가 바뀌어도 재호출하지 않는다.
 * - response: SDK 응답 본문의 출력 부분과 종료 사유(stop_reason / incomplete_details.reason)
 * - http_error: 결정적으로 분류된 4xx(client_4xx)
 */
export type RawResponse =
  | {
      readonly kind: "response";
      /** 응답에 적힌 모델명(없으면 null) */
      readonly model: string | null;
      readonly output: JsonValue;
      readonly stop: string | null;
      readonly usage: TokenUsage | null;
    }
  | { readonly kind: "http_error"; readonly status: number; readonly body: string };

/** Choice 답. probability는 선택한 라벨의 확률(Jev probabilities[choice], LLM은 말한 확률) */
export interface ChoiceAnswer {
  readonly kind: "choice";
  readonly choice: string;
  readonly probability: number;
  /** 라벨별 확률(Jev만, LLM은 null) */
  readonly probabilities: Readonly<Record<string, number>> | null;
}

/** Noul 답. 판정은 모든 모델에 p(true) ≥ 0.5 → true를 동일 적용한다 */
export interface NoulAnswer {
  readonly kind: "noul";
  /** p(true) */
  readonly probability: number;
}

export type Answer = ChoiceAnswer | NoulAnswer;

/** 과제 이름 → 답 */
export type Answers = Readonly<Record<string, Answer>>;

/** 원 응답 파싱 결과 */
export type ParsedResponse =
  | { readonly ok: true; readonly answers: Answers }
  | { readonly ok: false; readonly errorKind: DeterministicErrorKind; readonly detail: string };

interface JudgeOutcomeBase {
  /** 모든 시도(캐시 적중이면 캐시에 저장된 원 시도) */
  readonly attempts: readonly Attempt[];
  readonly usage: TokenUsage | null;
  /** 원 응답(일시 실패나 config면 null) */
  readonly raw: RawResponse | null;
  readonly cached: boolean;
  /** 측정 시각(ISO 8601, 캐시 적중이면 이전 실행 시각) */
  readonly measuredAt: string;
}

export type JudgeOutcome =
  | (JudgeOutcomeBase & { readonly ok: true; readonly answers: Answers })
  | (JudgeOutcomeBase & { readonly ok: false; readonly errorKind: ErrorKind; readonly detail: string });

export interface Provider {
  readonly id: ProviderId;
  /** 캐시 키와 run.json에 기록할 SDK 버전 */
  readonly sdkVersion: string;
  readonly probabilitySource: ProbabilitySource;
  /**
   * 시도 1회(SDK maxRetries 0). 성공하면 원 응답을 돌려주고, SDK 에러는 그대로 throw한다.
   * 재시도, 대기, 캐시는 bench/retry.ts와 러너 몫이다.
   */
  judge(request: JudgeRequest): Promise<RawResponse>;
  /** 원 응답을 과제별 답으로 파싱하고 범위([0,1])를 검사한다. 캐시 적중 시에도 호출된다 */
  parse(raw: RawResponse, tasks: readonly TaskDefinition[]): ParsedResponse;
  /** SDK 에러를 retryable / deterministic / config로 분류한다 */
  classify(error: unknown): ErrorClassification;
}

// ── 캐시와 기록 ──

export interface CacheEntry {
  readonly key: string;
  readonly raw: RawResponse;
  readonly attempts: readonly Attempt[];
  readonly measuredAt: string;
}

/** requests/<데이터셋>/<모델>.jsonl 한 줄. 입력 텍스트(state)는 담지 않는다 */
export interface CaseRecord {
  readonly id: string;
  readonly dataset: DatasetId;
  readonly model: ModelAlias;
  readonly cached: boolean;
  /** 원 응답의 출력 부분(없으면 null) */
  readonly output: JsonValue | null;
  readonly stop: string | null;
  readonly answers: Answers | null;
  readonly errorKind: ErrorKind | null;
  readonly detail: string | null;
  readonly usage: TokenUsage | null;
  readonly attempts: readonly Attempt[];
  readonly measuredAt: string;
}

// ── CLI 옵션 ──

export interface BenchOptions {
  readonly models: readonly ModelAlias[];
  readonly datasets: readonly DatasetId[];
  /** 데이터셋당 표본 수(기본 300) */
  readonly limit: number;
  readonly reasoning: ReasoningMode;
  readonly yes: boolean;
  readonly noCache: boolean;
}
