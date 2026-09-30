// 데이터셋 로컬 캐시: `bench/.cache/datasets/<id>/<revision>/rows.jsonl` + meta.json.
// 실행마다 첫 페이지로 현재 revision을 확인하고, 같은 revision이 캐시에 있으면 네트워크 없이 읽는다.
// 받는 중에는 rows.partial.jsonl에 페이지 단위로 덧붙여 끊겨도 이어받는다. meta.json은 완료 표시다.
// 원본 텍스트는 이 캐시에만 두고 저장소에 커밋하지 않는다(.gitignore).
import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { BenchCase, DatasetId, DatasetSpec } from "../types";
import { fetchRowsPage, HfAuthError, PAGE_SIZE, type HfLocation, type HfPage } from "./hf";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CACHE_ROOT = fileURLToPath(new URL("../.cache/datasets/", import.meta.url));

const ROWS_FILE = "rows.jsonl";
const PARTIAL_FILE = "rows.partial.jsonl";
const META_FILE = "meta.json";

const HfMetaSchema = z.object({
  kind: z.literal("hf"),
  id: z.string(),
  repo: z.string(),
  config: z.string(),
  split: z.string(),
  revision: z.string(),
  num_rows: z.number().int().nonnegative(),
  license: z.string(),
  /** 받은 시각(ISO 8601) */
  downloaded_at: z.string(),
  /** datasets-server가 응답 크기 제한으로 잘라 보낸 셀 수 */
  truncated_cells: z.number().int().nonnegative(),
});

export type HfDatasetMeta = z.infer<typeof HfMetaSchema>;

export interface LocalDatasetMeta {
  readonly kind: "local";
  readonly id: DatasetId;
  /** 저장소 루트 기준 경로 */
  readonly path: string;
  /** 파일 내용 sha256 */
  readonly revision: string;
  readonly num_rows: number;
  readonly license: string;
}

export type DatasetMeta = HfDatasetMeta | LocalDatasetMeta;

const CachedRowSchema = z.object({
  row_idx: z.number().int().nonnegative(),
  row: z.record(z.string(), z.unknown()),
  truncated_cells: z.array(z.string()),
});

export interface IndexedRow<Row> {
  /** 원본 행 번호(HF row_idx, 로컬은 배열 인덱스) */
  readonly rowIndex: number;
  readonly row: Row;
  /** datasets-server가 잘라 보낸 셀 이름 */
  readonly truncatedCells: readonly string[];
}

/** 건너뜀(gated 데이터셋의 토큰 없음, 401, 403)은 오류가 아니라 사유와 함께 돌려준다 */
export type RowsResult<Row> =
  | { readonly ok: true; readonly meta: DatasetMeta; readonly rows: readonly IndexedRow<Row>[] }
  | { readonly ok: false; readonly skipReason: string };

export type DatasetLoad =
  | {
      readonly ok: true;
      readonly meta: DatasetMeta;
      /** toCase가 null이 아닌 케이스(표본 추출 모집단) */
      readonly cases: readonly BenchCase[];
      /** toCase가 null을 돌려 모집단에서 뺀 행 수(예: 라벨 null) */
      readonly excluded: number;
    }
  | { readonly ok: false; readonly skipReason: string };

function hfToken(): string | null {
  const token = process.env.HF_TOKEN;
  return token === undefined || token.trim() === "" ? null : token.trim();
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readMeta(dir: string): Promise<HfDatasetMeta | null> {
  const text = await readText(join(dir, META_FILE));
  if (text === null) return null;
  return HfMetaSchema.parse(JSON.parse(text));
}

/** 완료된(meta.json이 있는) 캐시 중 가장 최근에 받은 것. 네트워크가 안 될 때 쓴다 */
async function latestCachedDir(id: DatasetId): Promise<string | null> {
  const root = join(CACHE_ROOT, id);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return null;
  }
  let best: { dir: string; at: string } | null = null;
  for (const entry of entries) {
    const dir = join(root, entry);
    const meta = await readMeta(dir);
    if (meta !== null && (best === null || meta.downloaded_at > best.at)) best = { dir, at: meta.downloaded_at };
  }
  return best === null ? null : best.dir;
}

function parseCachedLines(text: string, file: string): z.infer<typeof CachedRowSchema>[] {
  const out: z.infer<typeof CachedRowSchema>[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (line === "") continue;
    const parsed = CachedRowSchema.safeParse(JSON.parse(line));
    if (!parsed.success) throw new Error(`${file}:${i + 1} 캐시 행 형식 오류: ${parsed.error.message}`);
    out.push(parsed.data);
  }
  return out;
}

const toJsonl = (rows: HfPage["rows"]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

/** 이어받기: 부분 파일에서 온전한 줄만 남기고 그 수를 돌려준다 */
async function resumePartial(partialPath: string): Promise<number> {
  const text = await readText(partialPath);
  if (text === null) return 0;
  const complete = text.slice(0, text.lastIndexOf("\n") + 1);
  if (complete !== text) await writeFile(partialPath, complete);
  return complete === "" ? 0 : complete.split("\n").length - 1;
}

async function download(
  id: DatasetId,
  location: HfLocation,
  license: string,
  first: HfPage,
  token: string | null,
): Promise<string> {
  const dir = join(CACHE_ROOT, id, first.revision);
  await mkdir(dir, { recursive: true });
  const partialPath = join(dir, PARTIAL_FILE);

  let offset = await resumePartial(partialPath);
  if (offset === 0) {
    await writeFile(partialPath, toJsonl(first.rows));
    offset = first.rows.length;
  } else {
    console.warn(`[data] ${id}: 이어받기(${offset}/${first.numRowsTotal}행부터)`);
  }

  while (offset < first.numRowsTotal) {
    const page = await fetchRowsPage(location, offset, PAGE_SIZE, token);
    if (page.revision !== first.revision) {
      throw new Error(`${id}: 받는 중 revision이 바뀌었습니다(${first.revision} → ${page.revision}). 다시 실행하세요.`);
    }
    if (page.rows.length === 0) throw new Error(`${id}: offset ${offset}에서 빈 페이지를 받았습니다.`);
    await appendFile(partialPath, toJsonl(page.rows));
    offset += page.rows.length;
  }

  const rows = parseCachedLines(await readFile(partialPath, "utf8"), partialPath);
  rows.forEach((r, i) => {
    if (r.row_idx !== i) throw new Error(`${id}: 행 번호가 연속하지 않습니다(${i}번째 줄 row_idx=${r.row_idx}).`);
  });
  if (rows.length !== first.numRowsTotal) {
    throw new Error(`${id}: 받은 행 수 ${rows.length}가 num_rows_total ${first.numRowsTotal}과 다릅니다.`);
  }

  await rename(partialPath, join(dir, ROWS_FILE));
  const meta: HfDatasetMeta = {
    kind: "hf",
    id,
    repo: location.repo,
    config: location.config,
    split: location.split,
    revision: first.revision,
    num_rows: rows.length,
    license,
    downloaded_at: new Date().toISOString(),
    truncated_cells: rows.reduce((sum, r) => sum + r.truncated_cells.length, 0),
  };
  await writeFile(join(dir, META_FILE), JSON.stringify(meta, null, 2) + "\n");
  return dir;
}

/** 현재 revision의 캐시 폴더(없으면 받는다). gated이고 인증이 안 되면 건너뜀 사유 */
async function resolveHfDir(
  id: DatasetId,
  license: string,
  location: HfLocation,
  requiresToken: boolean,
): Promise<{ ok: true; dir: string } | { ok: false; skipReason: string }> {
  const token = hfToken();
  if (requiresToken && token === null) {
    return { ok: false, skipReason: "HF_TOKEN이 없음(gated 데이터셋, 토큰과 약관 동의 필요)" };
  }

  let first: HfPage;
  try {
    first = await fetchRowsPage(location, 0, PAGE_SIZE, token);
  } catch (error) {
    if (error instanceof HfAuthError && requiresToken) {
      return { ok: false, skipReason: `HF 인증 실패(HTTP ${error.status ?? "?"}, 토큰 권한 또는 약관 동의 확인)` };
    }
    const cached = await latestCachedDir(id);
    if (cached === null) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[data] ${id}: revision 확인 실패, 캐시(${cached})를 사용합니다. 원인: ${reason}`);
    return { ok: true, dir: cached };
  }

  const dir = join(CACHE_ROOT, id, first.revision);
  if ((await readMeta(dir)) !== null) return { ok: true, dir };
  return { ok: true, dir: await download(id, location, license, first, token) };
}

function validateRow<Row>(spec: DatasetSpec<Row>, raw: unknown, rowIndex: number): Row {
  const parsed = spec.rowSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${spec.id}: ${rowIndex}번 행이 스키마와 맞지 않습니다. ${parsed.error.message}`);
  }
  return parsed.data;
}

async function loadLocalRows<Row>(spec: DatasetSpec<Row>, path: string): Promise<RowsResult<Row>> {
  const text = await readFile(join(REPO_ROOT, path), "utf8");
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error(`${spec.id}: ${path}는 JSON 배열이어야 합니다.`);
  const items: readonly unknown[] = raw;
  const rows = items.map((item, i) => ({ rowIndex: i, row: validateRow(spec, item, i), truncatedCells: [] }));
  const meta: LocalDatasetMeta = {
    kind: "local",
    id: spec.id,
    path,
    revision: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    num_rows: rows.length,
    license: spec.license,
  };
  return { ok: true, meta, rows };
}

/**
 * 검증된 원본 행 전체(모집단 이전). 데이터셋 전용 부가 정보(JBB 공개 기준 열, K-MHaS 원 범주 등)도 이걸로 읽는다.
 * @throws 네트워크 오류, 형식 오류, 행 스키마 불일치
 */
export async function loadRows<Row>(spec: DatasetSpec<Row>): Promise<RowsResult<Row>> {
  const source = spec.source;
  if (source.kind === "local") return loadLocalRows(spec, source.path);

  const location: HfLocation = { repo: source.repo, config: source.config, split: source.split };
  const resolved = await resolveHfDir(spec.id, spec.license, location, source.requiresToken);
  if (!resolved.ok) return resolved;

  const meta = await readMeta(resolved.dir);
  if (meta === null) throw new Error(`${spec.id}: ${resolved.dir}에 meta.json이 없습니다.`);
  const file = join(resolved.dir, ROWS_FILE);
  const rows = parseCachedLines(await readFile(file, "utf8"), file).map((r) => ({
    rowIndex: r.row_idx,
    row: validateRow(spec, r.row, r.row_idx),
    truncatedCells: r.truncated_cells,
  }));
  return { ok: true, meta, rows };
}

/** 데이터셋을 받아(또는 캐시에서 읽어) 케이스 모집단으로 바꾼다 */
export async function loadDataset<Row>(spec: DatasetSpec<Row>): Promise<DatasetLoad> {
  const result = await loadRows(spec);
  if (!result.ok) return result;
  const cases: BenchCase[] = [];
  for (const { row, rowIndex } of result.rows) {
    const c = spec.toCase(row, rowIndex);
    if (c !== null) cases.push(c);
  }
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) throw new Error(`${spec.id}: 케이스 id가 중복됩니다.`);
  return { ok: true, meta: result.meta, cases, excluded: result.rows.length - cases.length };
}
