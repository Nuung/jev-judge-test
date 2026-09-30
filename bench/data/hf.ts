// HF datasets-server `/rows` 클라이언트. 의존성 없는 fetch, 응답은 zod로 검증한다(계획 §0.1 B1).
// 429, 5xx, 네트워크 오류는 Retry-After를 우선해 백오프하고 최대 6회 재시도한다.
import { z } from "zod";

const ROWS_ENDPOINT = "https://datasets-server.huggingface.co/rows";

/** `/rows`가 허용하는 한 페이지 최대 행 수 */
export const PAGE_SIZE = 100;

const MAX_RETRIES = 6;
// CloudFront 429는 Retry-After 없이 오고 1~2분 창으로 풀린다(2026-09-29 실측: 약 70페이지 연속 요청 후 차단)
// → 5s부터 두 배, 상한 120s(6회 합 275s)로 창 하나를 넘길 만큼 기다린다
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 120_000;
/** Retry-After 대기 상한 */
const RETRY_AFTER_MAX_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface HfLocation {
  readonly repo: string;
  readonly config: string;
  readonly split: string;
}

const RowsResponseSchema = z.object({
  rows: z.array(
    z.object({
      row_idx: z.number().int().nonnegative(),
      row: z.record(z.string(), z.unknown()),
      /** 응답 크기 제한으로 잘린 셀 이름 */
      truncated_cells: z.array(z.string()),
    }),
  ),
  num_rows_total: z.number().int().nonnegative(),
});

export interface HfRow {
  readonly row_idx: number;
  readonly row: Readonly<Record<string, unknown>>;
  readonly truncated_cells: readonly string[];
}

export interface HfPage {
  /** `x-revision` 헤더(데이터셋 커밋 sha) */
  readonly revision: string;
  readonly numRowsTotal: number;
  readonly rows: readonly HfRow[];
}

/** 인증 실패(토큰 없음, 401, 403). gated 데이터셋은 이 오류를 건너뜀 사유로 바꾼다 */
export class HfAuthError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "HfAuthError";
  }
}

/** 재시도할 수 없는 응답(4xx 등) 또는 재시도 소진 */
export class HfRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "HfRequestError";
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry-After(초 또는 HTTP 날짜) → 대기 ms. 해석할 수 없으면 null */
function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (value.trim() !== "" && Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

function backoffMs(retry: number): number {
  return Math.min(BACKOFF_START_MS * 2 ** retry, BACKOFF_MAX_MS);
}

const isRetryableStatus = (status: number) => status === 429 || status >= 500;

/**
 * `/rows` 한 페이지. token이 있으면 Authorization 헤더로 보낸다.
 * @throws {HfAuthError} 401, 403
 * @throws {HfRequestError} 그 밖의 4xx, 형식 오류, 재시도 소진
 */
export async function fetchRowsPage(
  location: HfLocation,
  offset: number,
  length: number,
  token: string | null,
): Promise<HfPage> {
  const url = new URL(ROWS_ENDPOINT);
  url.searchParams.set("dataset", location.repo);
  url.searchParams.set("config", location.config);
  url.searchParams.set("split", location.split);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(Math.min(length, PAGE_SIZE)));
  const headers: Record<string, string> = token === null ? {} : { Authorization: `Bearer ${token}` };
  const where = `${location.repo}(${location.config}/${location.split}) offset=${offset}`;

  let lastFailure = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      lastFailure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      if (attempt < MAX_RETRIES) await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) {
      const revision = response.headers.get("x-revision");
      if (revision === null || revision === "") {
        throw new HfRequestError(`${where}: x-revision 헤더가 없습니다.`, response.status);
      }
      const parsed = RowsResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new HfRequestError(`${where}: /rows 응답 형식이 예상과 다릅니다. ${parsed.error.message}`, response.status);
      }
      return { revision, numRowsTotal: parsed.data.num_rows_total, rows: parsed.data.rows };
    }

    const body = (await response.text()).slice(0, 300);
    if (response.status === 401 || response.status === 403) {
      throw new HfAuthError(`${where}: HTTP ${response.status} ${body}`, response.status);
    }
    if (!isRetryableStatus(response.status)) {
      throw new HfRequestError(`${where}: HTTP ${response.status} ${body}`, response.status);
    }
    lastFailure = `HTTP ${response.status}`;
    if (attempt < MAX_RETRIES) {
      const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
      await sleep(retryAfter === null ? backoffMs(attempt) : Math.min(retryAfter, RETRY_AFTER_MAX_MS));
    }
  }
  throw new HfRequestError(`${where}: 재시도 ${MAX_RETRIES}회 소진(${lastFailure})`, null);
}
