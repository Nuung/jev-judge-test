// summary.md 렌더링 — metrics.json만 입력으로 받는다(통계 계산은 bench/stats 몫).
// 같은 metrics.json이면 같은 문서가 나오도록 생성 시각은 넣지 않는다(시각은 run.json에만).
import type { DatasetId, ModelAlias } from "../types";
import { ERROR_KINDS } from "./raw";
import type { DatasetMetrics, Estimate, Metrics, ModelResult } from "./raw";

export const DATASET_LABELS: Readonly<Record<DatasetId, string>> = {
  sst2: "SST-2",
  "ag-news": "AG News",
  banking77: "Banking77",
  "enron-spam": "Enron 스팸",
  "jbb-judge": "JBB judge",
  "klue-ynat": "KLUE-YNAT",
  kmhas: "K-MHaS",
  wildguardmix: "WildGuardMix",
  toxicchat: "ToxicChat",
  "demo-smoke": "demo-smoke",
};

export const METRIC_LABELS = {
  accuracy: "정확도",
  macro_f1: "macro-F1",
  f1_positive: "F1(양성)",
} as const;

const ERROR_LABELS: Readonly<Record<(typeof ERROR_KINDS)[number], string>> = {
  refusal: "거절",
  format: "형식",
  max_tokens: "토큰 한도",
  range: "범위",
  client_4xx: "입력 4xx",
  api: "일시 실패",
  config: "설정",
};

const SOURCE_LABELS = { "jev-direct": "Jev 직접", verbalized: "말로 답함(verbalized)" } as const;
const MODE_LABELS = { choice: "Choice 선택 라벨(top-label)", noul: "Noul p(true)" } as const;

// ── 숫자 형식 ──

const pct = (x: number): string => `${(x * 100).toFixed(1)}`;
const pctOrDash = (x: number | null): string => (x === null ? "—" : pct(x));
const signedPct = (x: number): string => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x * 100).toFixed(1)}`;
const dec3 = (x: number | null): string => (x === null ? "—" : x.toFixed(3));
const ms = (x: number | null): string => (x === null ? "—" : `${Math.round(x).toLocaleString("en-US")}`);
const pValue = (p: number): string => (p < 0.001 ? "<0.001" : p.toFixed(3));

function usd(x: number | null): string {
  if (x === null) return "—";
  if (x === 0) return "$0";
  if (x < 0.01) return `$${x.toPrecision(2)}`;
  return `$${x.toFixed(2)}`;
}

const estimate = (e: Estimate): string => `${pct(e.value)} [${pct(e.ci[0])}, ${pct(e.ci[1])}]`;
const diffEstimate = (e: Estimate): string => `${signedPct(e.value)} [${signedPct(e.ci[0])}, ${signedPct(e.ci[1])}]`;

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.map((c) => c.replaceAll("|", "\\|")).join(" | ")} |`;
  return [line(header), `|${header.map(() => "---").join("|")}|`, ...rows.map(line)].join("\n");
}

// ── 해석 문구 ──

/** McNemar 방향 문구. b = Jev만 정답, c = LLM만 정답(계획 §4). 유의하지 않으면 방향만 괄호로 적는다 */
function mcnemarVerdict(m: NonNullable<NonNullable<ModelResult["vsJev"]>["mcnemar"]>): string {
  const p = m.pHolm ?? m.p;
  const direction = m.b > m.c ? "Jev 우세" : m.b < m.c ? "LLM 우세" : "동률";
  if (m.b === m.c) return direction;
  return p < 0.05 ? direction : `유의하지 않음(${direction} 방향)`;
}

function modelName(metrics: Metrics, alias: ModelAlias): string {
  const spec = metrics.models.find((m) => m.alias === alias);
  return spec === undefined ? alias : `${alias} (${spec.apiModel})`;
}

// ── 절별 렌더 ──

function mainTable(metrics: Metrics, ds: DatasetMetrics): string {
  const metricLabel = METRIC_LABELS[ds.primaryMetric];
  const header = [
    "모델",
    `${metricLabel} [95% CI]`,
    "성공 기준 (n)",
    "Jev 대비 차이 [95% CI]",
    "McNemar b/c",
    "p (Holm)",
    "판정",
    "성공률",
    "거절률",
    "p50/p95 ms",
    "1천 건당",
    "이번 실행 청구",
  ];
  const rows = ds.results.map((r) => {
    const mc = r.vsJev?.mcnemar ?? null;
    return [
      modelName(metrics, r.model),
      estimate(r.primary),
      `${pctOrDash(r.successOnly.value)} (${r.successOnly.n})`,
      r.vsJev === null ? "—" : diffEstimate(r.vsJev.diff),
      mc === null ? "—" : `${mc.b}/${mc.c}`,
      mc === null ? "—" : `${pValue(mc.p)} (${mc.pHolm === null ? "탐색적" : pValue(mc.pHolm)})`,
      mc === null ? "—" : mcnemarVerdict(mc),
      pct(r.successRate),
      pct(r.refusalRate),
      `${ms(r.latency.p50)} / ${ms(r.latency.p95)}`,
      usd(r.cost.per1kUsd),
      usd(r.cost.billedUsd),
    ];
  });
  for (const b of ds.referenceBaselines) {
    const f1 = b.f1Positive === null ? "" : `, F1 ${pct(b.f1Positive)}`;
    const published = b.published === null ? "" : ` · 공개 보고 ${b.published}`;
    rows.push([
      `기준: ${b.name}`,
      `${pct(b.accuracy)}${f1} (n=${b.n}${published})`,
      ...Array.from({ length: header.length - 2 }, () => "—"),
    ]);
  }
  return table(header, rows);
}

function secondaryTable(metrics: Metrics, ds: DatasetMetrics): string {
  const rows = ds.results.map((r) => [
    modelName(metrics, r.model),
    pct(r.secondary.accuracy),
    pctOrDash(r.secondary.f1Positive),
    pctOrDash(r.secondary.macroF1),
    r.cost.meanInputTokens === null ? "—" : Math.round(r.cost.meanInputTokens).toString(),
    r.cost.meanOutputTokens === null ? "—" : Math.round(r.cost.meanOutputTokens).toString(),
    usd(r.cost.perCallUsd),
    `${r.latency.n} (재시도 ${r.latency.retriedCalls}, 이전 실행 ${pct(r.latency.priorRunShare)}%)`,
  ]);
  return table(
    ["모델", "정확도", "F1(양성)", "macro-F1", "평균 입력 토큰", "평균 출력 토큰", "호출당", "지연 표본 n"],
    rows,
  );
}

function calibrationTable(metrics: Metrics, ds: DatasetMetrics): string | null {
  const rows = ds.results.flatMap((r) =>
    r.calibration.map((c) => [
      modelName(metrics, r.model),
      c.task,
      MODE_LABELS[c.mode],
      SOURCE_LABELS[c.source],
      `${dec3(c.brier)} (교집합 n=${c.intersectionN})`,
      `${dec3(c.ece)} (n=${c.n})`,
    ]),
  );
  if (rows.length === 0) return null;
  return table(["모델", "과제", "확률 모드", "확률 출처", "Brier (교집합 n)", "ECE 보조 (n)"], rows);
}

function datasetSection(metrics: Metrics, ds: DatasetMetrics): string {
  const parts = [
    `### ${DATASET_LABELS[ds.id]} (\`${ds.id}\`)${ds.task === null ? "" : ` · 과제 \`${ds.task}\``}`,
    `표본 ${ds.n}건 · 주지표 ${METRIC_LABELS[ds.primaryMetric]} · 출처 \`${ds.source}\`${ds.revision === null ? "" : ` @ \`${ds.revision.slice(0, 12)}\``} · 라이선스 ${ds.license}`,
    "",
    mainTable(metrics, ds),
    "",
    "<details><summary>보조 지표·토큰</summary>",
    "",
    secondaryTable(metrics, ds),
    "",
    "</details>",
  ];
  const calib = calibrationTable(metrics, ds);
  if (calib !== null) parts.push("", "보정(Brier는 모든 모델이 성공한 케이스 교집합, ECE는 모델별 성공 케이스 전체):", "", calib);
  const notes = [...ds.notes];
  if (ds.primaryMetric === "macro_f1") {
    notes.push(
      `macro-F1은 라벨 체계 전체(${ds.labels?.length ?? 0}종)를 고정 클래스로 쓴다. 표본·재표집에 없는 클래스는 F1=0으로 평균에 들어가 소수 클래스가 빠지면 낮게 나올 수 있다.`,
      "McNemar는 정오답 일치 검정이며 F1 차이 검정이 아니다.",
    );
  }
  if (notes.length > 0) parts.push("", ...notes.map((n) => `- ${n}`));
  return parts.join("\n");
}

function failureSection(metrics: Metrics): string {
  const rows: string[][] = [];
  for (const ds of metrics.datasets) {
    for (const r of ds.results) {
      const counts = ERROR_KINDS.filter((k) => r.errorCounts[k] > 0).map((k) => `${ERROR_LABELS[k]} ${r.errorCounts[k]}`);
      if (counts.length === 0) continue;
      rows.push([DATASET_LABELS[ds.id], modelName(metrics, r.model), pct(1 - r.successRate), counts.join(", ")]);
    }
  }
  const parts = ["## 실패 요약", ""];
  parts.push(rows.length === 0 ? "실패한 호출이 없다." : table(["데이터셋", "모델", "실패율 %", "종류별 건수"], rows));
  if (metrics.warnings.length > 0) parts.push("", "경고:", "", ...metrics.warnings.map((w) => `- ${w}`));
  if (metrics.skipped.length > 0) {
    parts.push("", "건너뜀:", "", ...metrics.skipped.map((s) => `- ${s.target}: ${s.reason}`));
  }
  return parts.join("\n");
}

function settingsSection(metrics: Metrics): string {
  const s = metrics.settings;
  const modelRows = metrics.models.map((m) => [
    m.alias,
    m.provider,
    `\`${m.apiModel}\``,
    `$${m.pricing.inputPerMTok} / $${m.pricing.outputPerMTok}`,
    SOURCE_LABELS[m.probabilitySource],
    m.pricing.source,
  ]);
  const datasetRows = metrics.datasets.map((d) => [
    d.task === null ? DATASET_LABELS[d.id] : `${DATASET_LABELS[d.id]} · ${d.task}`,
    d.tier,
    `\`${d.source}\``,
    d.revision === null ? "—" : `\`${d.revision.slice(0, 12)}\``,
    d.n.toString(),
    d.maxInputChars === null ? "—" : `${d.maxInputChars}자`,
    d.license,
  ]);
  const laneRows = s.lanes.map((l) => [l.provider, l.models.join(" → "), l.start ?? "—", l.end ?? "—"]);
  const sdk = Object.entries(s.sdkVersions)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  return [
    "## 설정",
    "",
    `- 추론: \`${s.reasoning}\` · 시도당 타임아웃 ${s.timeoutMs.toLocaleString("en-US")}ms · 최대 재시도 ${s.maxRetries}회 · temperature ${s.temperature === "unset" ? "설정 안 함(제공자 기본값)" : s.temperature}`,
    `- 시드 ${metrics.seed}(mulberry32, 용도·데이터셋·모델 문자열 해시로 파생) · paired bootstrap B=${metrics.bootstrap.iterations.toLocaleString("en-US")}, ${Math.round(metrics.bootstrap.level * 100)}% CI(percentile \`${metrics.bootstrap.percentile}\`) · ECE ${metrics.eceBins} bin`,
    `- 실패는 abstain으로 센다(ITT): 정확도에서는 오답, F1에서는 정답 클래스의 FN으로만 센다. 성공 기준 열은 성공 케이스만으로 계산했다.`,
    `- McNemar: 정확 이항 양측, b = Jev만 정답, c = LLM만 정답. Holm은 이번 실행의 비교 ${metrics.holm.familySize}개에 적용(사전 선언 집합 ${metrics.holm.preregisteredSize}개${metrics.holm.familySize < metrics.holm.preregisteredSize ? "의 부분 집합 — 해석에 주의" : ""}).${metrics.holm.jevIncluded ? "" : " Jev가 실행에 없어 McNemar를 생략했다."}`,
    `- Noul 판정은 모든 모델에 p(true)≥0.5 → true를 적용한다. 지연 p50/p95는 첫 시도에 성공한 호출만(nearest-rank).`,
    `- 비용: "1천 건당"은 토큰 사용량 기준 단가(캐시 여부 무관), "이번 실행 청구"는 캐시 미스 호출만 합친 추정.`,
    `- 레인: ${s.laneInterpretation}`,
    `- SDK: ${sdk}${s.commit === null ? "" : ` · 커밋 \`${s.commit.slice(0, 12)}\``} · 파서 해시 \`${s.parserHash.slice(0, 12)}\``,
    "",
    table(["별칭", "제공자", "API 모델", "단가 in/out ($/M)", "확률 출처", "단가 출처"], modelRows),
    "",
    table(["데이터셋", "구분", "출처", "revision", "n", "입력 절단", "라이선스(HF 카드)"], datasetRows),
    "",
    table(["레인(제공자)", "모델 순서", "시작", "종료"], laneRows),
  ].join("\n");
}

const LIMITATIONS = [
  "LLM의 확률은 말로 답한(verbalized) 값이라 0.9·0.95 같은 값에 몰리는 양자화가 있다. Jev는 모델이 직접 낸 확률이라 출처가 다르다(표의 확률 출처 열).",
  "LLM 시스템 프롬프트에만 과신 경고 문구가 있다. 보정 지표 비교에 이 개입이 섞여 있다.",
  "추론은 기본으로 껐다(`--reasoning off`). 추론을 켜면 정확도·비용·지연이 달라질 수 있다.",
  "제공자별 레인을 동시에 돌려 모델마다 측정 시간대가 다르다. 레인 시작·종료 시각은 설정 절과 run.json에 있다. 캐시 적중 호출의 지연은 이전 실행에서 잰 값이다.",
  "Enron 스팸 본문은 모든 모델에 같은 길이로 잘라 보냈다(입력 절단 열).",
  "공개 데이터셋이라 학습 데이터 오염 가능성을 배제할 수 없다. JBB judge는 탈옥 프롬프트를 빼고 요청(goal)과 응답만 보냈다.",
  "SST-2·AG News·Enron은 라이선스가 unknown/표기 없음이라 입력 텍스트를 재배포하지 않는다. 결과 파일에는 id·예측·확률·토큰·지연만 있다.",
  "입력 기인 4xx(client_4xx)는 재과금을 막으려고 결정적 실패로 캐시한다. 설정 버그로 생긴 400도 같은 경로로 캐시될 수 있어 비율이 5%를 넘으면 경고한다.",
];

/** metrics.json → summary.md(한국어). 입력이 같으면 출력도 같다 */
export function renderSummary(metrics: Metrics): string {
  const defaults = metrics.datasets.filter((d) => d.tier === "default");
  const others = metrics.datasets.filter((d) => d.tier !== "default");
  const parts = [
    "# 벤치마크 요약",
    "",
    `모델: ${metrics.models.map((m) => m.alias).join(", ")} · 데이터셋: ${metrics.datasets.map((d) => d.id).join(", ")}`,
    "",
    "수치는 %(정확도·F1)이고 대괄호는 95% paired bootstrap CI다. 차이는 (모델 − Jev), 판정은 Holm 보정 p<0.05 기준이다.",
  ];
  if (defaults.length > 0) {
    parts.push("", "## 기본 데이터셋");
    for (const ds of defaults) parts.push("", datasetSection(metrics, ds));
  }
  if (others.length > 0) {
    parts.push("", "## 옵션·스모크 데이터셋(탐색적, Holm 집합 밖)");
    for (const ds of others) parts.push("", datasetSection(metrics, ds));
  }
  parts.push(
    "",
    "## 차트",
    "",
    "- `charts/cost-accuracy.png` — 데이터셋별 1천 건당 비용(로그축)과 주지표·95% CI",
    ...metrics.models.map((m) => `- \`charts/reliability-${m.alias}.png\` — ${m.alias} 신뢰도 곡선(Choice·Noul 분리, bin별 n)`),
    "",
    settingsSection(metrics),
    "",
    "## 한계",
    "",
    ...LIMITATIONS.map((l) => `- ${l}`),
    "",
    failureSection(metrics),
    "",
  );
  return parts.join("\n");
}
