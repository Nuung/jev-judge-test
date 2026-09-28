// 결과 출력 — 터미널 표(console.table) + eval/results/<타임스탬프>.md
import { mkdir, writeFile } from "node:fs/promises";
import { JEV_TIMEOUT_MS } from "@/lib/jev/client";
import { MOOD_LABEL_KO } from "@/lib/judge/labels";
import { GUARDRAIL_BLOCK, GUARDRAIL_REVIEW, MISMATCH_ALERT, MOOD_MIN_CONFIDENCE } from "@/lib/judge/policy";
import type { Category, EvalCase } from "./dataset";
import {
  caseErrors,
  computeMetrics,
  isBoundary,
  type CaseResult,
  type Metrics,
  type ModelRun,
  type Ratio,
} from "./metrics";

export interface ReportInput {
  startedAt: Date;
  categoryCounts: Record<Category, number>;
  runs: ModelRun[];
  /** 실행하지 않은 모델과 사유 */
  skipped: { models: readonly string[]; reason: string } | null;
}

const SKIPPED = "건너뜀";

const COLUMNS = [
  "모델",
  "성공/전체",
  "기분 정확도",
  "가드레일 TPR(차단)",
  "FPR(차단·전체)",
  "FPR(차단·유사)",
  "TPR(주의+)",
  "FPR(주의+·전체)",
  "FPR(주의+·유사)",
  "불일치 정확도",
  "p50(ms)",
  "p95(ms)",
  "입력 토큰",
  "출력 토큰",
  "추정 비용($)",
  "실패",
  "과신 격차",
] as const;
type Row = Record<(typeof COLUMNS)[number], string>;

function pct(r: Ratio): string {
  return r.rate === null ? "-" : `${(r.rate * 100).toFixed(1)}% (${r.hit}/${r.total})`;
}

function num(value: number | null, digits = 0): string {
  return value === null ? "-" : value.toFixed(digits);
}

function signed(value: number | null): string {
  if (value === null) return "-";
  const points = value * 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)}%p`;
}

function metricsRow(name: string, m: Metrics): Row {
  return {
    모델: name,
    "성공/전체": `${m.succeeded}/${m.total}`,
    "기분 정확도": pct(m.moodAccuracy),
    "가드레일 TPR(차단)": pct(m.blockedTpr),
    "FPR(차단·전체)": pct(m.blockedFprAll),
    "FPR(차단·유사)": pct(m.blockedFprLookalike),
    "TPR(주의+)": pct(m.flaggedTpr),
    "FPR(주의+·전체)": pct(m.flaggedFprAll),
    "FPR(주의+·유사)": pct(m.flaggedFprLookalike),
    "불일치 정확도": pct(m.mismatchAccuracy),
    "p50(ms)": num(m.p50LatencyMs),
    "p95(ms)": num(m.p95LatencyMs),
    "입력 토큰": String(m.inputTokens),
    "출력 토큰": String(m.outputTokens),
    "추정 비용($)": m.costUsd.toFixed(6),
    실패: String(m.failures),
    "과신 격차": signed(m.overconfidenceGap),
  };
}

function skippedRow(name: string): Record<string, string> {
  return { ...Object.fromEntries(COLUMNS.map((c) => [c, SKIPPED])), 모델: name };
}

function buildRows(input: ReportInput): Record<string, string>[] {
  const rows: Record<string, string>[] = input.runs.map((run) => metricsRow(run.name, computeMetrics(run)));
  for (const model of input.skipped?.models ?? []) rows.push(skippedRow(model));
  return rows;
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.map(escapeCell).join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

function expected(c: EvalCase): string {
  const { mood, guardrail, mismatch } = c.labels;
  const parts = [];
  if (mood !== null) parts.push(`기분 ${mood}(${MOOD_LABEL_KO[mood]})`);
  parts.push(`가드레일 ${guardrail ? "차단" : "통과"}`);
  if (mismatch !== null) parts.push(`불일치 ${mismatch ? "예" : "아니오"}`);
  return parts.join(", ");
}

function predicted(r: Extract<CaseResult, { ok: true }>): string {
  const p = r.prediction;
  const parts = [`기분 ${p.mood}(${MOOD_LABEL_KO[p.mood]})`, `가드레일 ${p.guardrail}`];
  if (p.mismatchAlert !== null) parts.push(`불일치 ${p.mismatchAlert ? "예" : "아니오"}`);
  return parts.join(", ");
}

function probabilities(r: Extract<CaseResult, { ok: true }>): string {
  const p = r.prediction;
  const f = (v: number) => v.toFixed(2);
  return `기분확신 ${f(p.moodConfidence)} · 인젝션 ${f(p.injection)} · 유해 ${f(p.harmful)} · 불일치 ${f(p.mismatch)}`;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

function modelSection(run: ModelRun): string {
  const lines: string[] = [`### ${run.name}`, ""];

  const boundary = run.results.filter((r) => isBoundary(r.case));
  lines.push("**관찰: 경계 사례** (라벨이 애매해 지표·오답 목록에서 제외)", "");
  if (boundary.length === 0) lines.push("- 없음");
  for (const r of boundary) {
    lines.push(
      r.ok
        ? `- \`${r.case.id}\` "${r.case.text}" → 예측: ${predicted(r)} / ${probabilities(r)} (정답: ${expected(r.case)})`
        : `- \`${r.case.id}\` "${r.case.text}" → 실패: ${r.error}`,
    );
  }
  lines.push("");

  const wrong = run.results.flatMap((r) => {
    if (!r.ok || isBoundary(r.case)) return [];
    const errors = caseErrors(r);
    return errors.length === 0 ? [] : [{ r, errors }];
  });
  lines.push(`**오답 목록** (${wrong.length}건, 가드레일은 차단 기준)`, "");
  if (wrong.length === 0) lines.push("- 없음");
  else
    lines.push(
      markdownTable(
        ["id", "틀린 항목", "문장", "정답", "예측", "주요 확률"],
        wrong.map(({ r, errors }) => [
          r.case.id,
          errors.join("·"),
          r.case.text,
          expected(r.case),
          predicted(r),
          probabilities(r),
        ]),
      ),
    );
  lines.push("");

  const failed = run.results.filter((r) => !r.ok);
  lines.push(`**실패 목록** (${failed.length}건)`, "");
  if (failed.length === 0) lines.push("- 없음");
  for (const r of failed) {
    if (!r.ok) lines.push(`- \`${r.case.id}\` stop_reason=${r.stopReason ?? "-"} · ${r.error}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildMarkdown(input: ReportInput, rows: readonly Record<string, string>[]): string {
  const counts = Object.entries(input.categoryCounts)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const total = Object.values(input.categoryCounts).reduce((a, b) => a + b, 0);
  const boundaryIds = (input.runs[0]?.results ?? []).filter((r) => isBoundary(r.case)).map((r) => `\`${r.case.id}\``);
  const versions = input.runs.map((r) => `${r.name}: ${r.versions.join(", ") || "-"}`).join(" / ");
  const pricing = input.runs
    .map((r) => `${r.name} 입력 $${r.pricing.inputPerMTok}/Mtok · 출력 $${r.pricing.outputPerMTok}/Mtok (${r.pricing.source})`)
    .map((s) => `  - ${s}`);

  return [
    `# Jev vs Claude 평가 결과 (${formatTimestamp(input.startedAt)})`,
    "",
    "## 요약",
    "",
    markdownTable(
      COLUMNS,
      rows.map((row) => COLUMNS.map((c) => row[c])),
    ),
    "",
    "- 가드레일 주 지표는 `blocked`(차단)를 양성 예측으로 본다. 보조 지표 `주의+`는 `safe`가 아닌 모든 상태(caution·blocked).",
    "- FPR 전체 = 가드레일 음성 전체 기준, 유사 = `benign_lookalike` 부분집합 기준.",
    "- 과신 격차 = 평균 기분 확신도 − 기분 정확도(기분 라벨이 있는 성공 케이스 기준). 양수면 과신.",
    `- 기분 정확도·가드레일·불일치·과신 격차는 경계 사례 ${boundaryIds.length}건(${boundaryIds.join(", ") || "-"})을 제외하고 계산했다. 경계 사례는 모델별 상세의 "관찰" 섹션에만 표시한다. 성공/전체·지연·토큰·비용은 포함.`,
    "- 지연은 성공 호출 기준 nearest-rank 백분위수. 토큰·추정 비용은 성공+실패 전체 호출 기준(아래 단가).",
    "- 작업량 비대칭: Jev는 반응 선택 6문항을 포함한 10문항을 1회 호출로 판정하고(데모와 동일), Claude는 비교 대상 4문항만 판정한다. 토큰·비용은 같은 작업량 기준이 아니다.",
    "- 언어 caveat: Jev는 영어가 1차 학습 언어이며 CJK(한국어 등) 입력은 정확도가 낮을 수 있다(docs.typesafe.ai/concepts/state.md).",
    "",
    "## 설정",
    "",
    `- 데이터셋: eval/dataset.ko.json ${total}건 (${counts})`,
    `- 응답 모델 버전: ${versions}`,
    `- Claude 모델: ${input.skipped ? `${input.skipped.models.join(", ")} — ${SKIPPED} (${input.skipped.reason})` : input.runs.filter((r) => r.name.startsWith("claude")).map((r) => r.name).join(", ")}`,
    `- 임계값: GUARDRAIL_REVIEW=${GUARDRAIL_REVIEW}, GUARDRAIL_BLOCK=${GUARDRAIL_BLOCK}, MISMATCH_ALERT=${MISMATCH_ALERT}, MOOD_MIN_CONFIDENCE=${MOOD_MIN_CONFIDENCE}`,
    `- 재시도: Jev SDK 기본값(최대 2회 재시도, 시도당 타임아웃 ${JEV_TIMEOUT_MS}ms), Claude SDK 기본값(최대 2회 재시도). 호출은 모두 순차.`,
    "- 단가(출처·확인일은 각 항목 괄호):",
    ...pricing,
    "",
    "## 모델별 상세",
    "",
    ...input.runs.map(modelSection),
  ].join("\n");
}

/** 표를 터미널에 출력하고 md 파일을 쓴 뒤 그 경로를 돌려준다 */
export async function writeReport(input: ReportInput): Promise<string> {
  const rows = buildRows(input);
  console.table(rows);

  const dir = new URL("./results/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const file = new URL(`${formatTimestamp(input.startedAt)}.md`, dir);
  await writeFile(file, buildMarkdown(input, rows), "utf8");
  return file.pathname;
}
