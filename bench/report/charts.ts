// 차트. SVG 문자열을 직접 만들고 @resvg/resvg-js로 PNG를 굽는다(글꼴은 Pretendard OTF 주입).
// 입력은 metrics.json뿐이다. resvg를 못 쓰면 SVG만 남기고 경고한다.
//   cost-accuracy.svg      기본 데이터셋 패널(x = 1천 건당 비용 로그축, y = 주지표 + 95% CI 막대)
//   reliability-<모델>.svg  Choice(top-label)와 Noul(p(true)) 분리 신뢰도 곡선, 대각선, bin별 n
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_ALIASES } from "../types";
import type { ModelAlias } from "../types";
import { DATASET_LABELS, METRIC_LABELS } from "./markdown";
import type { CalibrationMode, DatasetMetrics, Metrics, Reliability } from "./raw";

// ── 스타일 ──
// 중립 표면과 잉크 + 범주형 5색(모델 고정 순서, 순위가 아니라 모델을 따라간다).
// 5계열은 색만으로 구분이 어려운 쌍이 있어 모양(원, 사각, 마름모, 삼각, 역삼각)을 함께 쓰고 범례를 항상 둔다.
const SURFACE = "#fcfcfb";
const INK = "#0b0b0b";
const INK_2 = "#52514e";
const INK_3 = "#8a8984";
const GRID = "#e6e5e1";
const AXIS = "#b9b8b2";
const FONT = "Pretendard";

const MODEL_STYLE: Readonly<Record<ModelAlias, { readonly color: string; readonly shape: Shape }>> = {
  jev: { color: "#2a78d6", shape: "circle" },
  haiku: { color: "#eb6834", shape: "square" },
  sonnet: { color: "#1baf7a", shape: "diamond" },
  luna: { color: "#eda100", shape: "triangle" },
  sol: { color: "#e87ba4", shape: "triangle-down" },
};

type Shape = "circle" | "square" | "diamond" | "triangle" | "triangle-down";

const FONT_DIR = fileURLToPath(new URL("../../node_modules/pretendard/dist/public/static/", import.meta.url));
const FONT_FILES = ["Regular", "Medium", "SemiBold", "Bold"].map((w) => path.join(FONT_DIR, `Pretendard-${w}.otf`));

// ── SVG 조각 ──

const esc = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const r1 = (x: number): string => (Math.round(x * 10) / 10).toString();

interface TextOptions {
  readonly size?: number;
  readonly weight?: number;
  readonly fill?: string;
  readonly anchor?: "start" | "middle" | "end";
  readonly rotate?: number;
}

function text(x: number, y: number, content: string, o: TextOptions = {}): string {
  const rotate = o.rotate === undefined ? "" : ` transform="rotate(${o.rotate} ${r1(x)} ${r1(y)})"`;
  return `<text x="${r1(x)}" y="${r1(y)}" font-family="${FONT}" font-size="${o.size ?? 12}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? INK_2}" text-anchor="${o.anchor ?? "start"}"${rotate}>${esc(content)}</text>`;
}

const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, width = 1, dash?: string): string =>
  `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${stroke}" stroke-width="${width}"${dash === undefined ? "" : ` stroke-dasharray="${dash}"`}/>`;

/** 마커. 겹칠 때 구분되도록 표면색 테두리(2px)를 두른다 */
function marker(shape: Shape, x: number, y: number, color: string, size = 5): string {
  const ring = `stroke="${SURFACE}" stroke-width="2" fill="${color}"`;
  switch (shape) {
    case "circle":
      return `<circle cx="${r1(x)}" cy="${r1(y)}" r="${size}" ${ring}/>`;
    case "square":
      return `<rect x="${r1(x - size)}" y="${r1(y - size)}" width="${size * 2}" height="${size * 2}" rx="1.5" ${ring}/>`;
    case "diamond": {
      const d = size * 1.35;
      return `<polygon points="${r1(x)},${r1(y - d)} ${r1(x + d)},${r1(y)} ${r1(x)},${r1(y + d)} ${r1(x - d)},${r1(y)}" ${ring}/>`;
    }
    case "triangle": {
      const d = size * 1.3;
      return `<polygon points="${r1(x)},${r1(y - d)} ${r1(x + d)},${r1(y + d * 0.8)} ${r1(x - d)},${r1(y + d * 0.8)}" ${ring}/>`;
    }
    case "triangle-down": {
      const d = size * 1.3;
      return `<polygon points="${r1(x)},${r1(y + d)} ${r1(x + d)},${r1(y - d * 0.8)} ${r1(x - d)},${r1(y - d * 0.8)}" ${ring}/>`;
    }
  }
}

function svgDocument(width: number, height: number, body: readonly string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="${SURFACE}"/>`,
    ...body,
    "</svg>",
    "",
  ].join("\n");
}

function legend(x: number, y: number, models: readonly ModelAlias[], names: ReadonlyMap<ModelAlias, string>): string[] {
  const out = [text(x, y, "모델", { size: 13, weight: 600, fill: INK })];
  models.forEach((m, i) => {
    const cy = y + 26 + i * 24;
    out.push(marker(MODEL_STYLE[m].shape, x + 7, cy - 4, MODEL_STYLE[m].color));
    out.push(text(x + 22, cy, names.get(m) ?? m, { size: 12, fill: INK }));
  });
  return out;
}

// ── 축 눈금 ──

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

function linearTicks(lo: number, hi: number, target: number): number[] {
  const step = niceStep(hi - lo, target);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function usdTick(x: number): string {
  if (x >= 1) return `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${Number(x.toPrecision(1))}`;
}

// ── cost-accuracy ──

const PANEL_W = 360;
const PANEL_H = 270;
const PANEL_GAP_X = 36;
const PANEL_GAP_Y = 44;
const PLOT_PAD = { left: 52, right: 14, top: 34, bottom: 44 };

interface Domain {
  readonly min: number;
  readonly max: number;
}

function costDomain(datasets: readonly DatasetMetrics[]): Domain | null {
  const values = datasets.flatMap((d) => d.results.map((r) => r.cost.per1kUsd)).filter((v): v is number => v !== null && v > 0);
  if (values.length === 0) return null;
  return {
    min: 10 ** Math.floor(Math.log10(Math.min(...values))),
    max: 10 ** Math.ceil(Math.log10(Math.max(...values)) + 1e-9),
  };
}

function yDomain(ds: DatasetMetrics): Domain {
  const lows = ds.results.map((r) => r.primary.ci[0]);
  const highs = ds.results.map((r) => r.primary.ci[1]);
  if (lows.length === 0) return { min: 0, max: 1 };
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  const pad = Math.max(0.02, (hi - lo) * 0.15);
  const step = niceStep(Math.max(hi - lo + 2 * pad, 0.05), 4);
  return {
    min: Math.max(0, Math.floor((lo - pad) / step) * step),
    max: Math.min(1, Math.ceil((hi + pad) / step) * step),
  };
}

function costPanel(ds: DatasetMetrics, ox: number, oy: number, xd: Domain | null): string[] {
  const out: string[] = [];
  const left = ox + PLOT_PAD.left;
  const right = ox + PANEL_W - PLOT_PAD.right;
  const top = oy + PLOT_PAD.top;
  const bottom = oy + PANEL_H - PLOT_PAD.bottom;
  const title = ds.task === null ? DATASET_LABELS[ds.id] : `${DATASET_LABELS[ds.id]} (${ds.task})`;
  out.push(text(ox, oy + 14, title, { size: 15, weight: 700, fill: INK }));
  out.push(text(right, oy + 14, `${METRIC_LABELS[ds.primaryMetric]}, n=${ds.n}`, { size: 11, fill: INK_2, anchor: "end" }));

  const yd = yDomain(ds);
  const sy = (v: number): number => bottom - ((v - yd.min) / (yd.max - yd.min)) * (bottom - top);
  for (const t of linearTicks(yd.min, yd.max, 4)) {
    out.push(line(left, sy(t), right, sy(t), GRID));
    out.push(text(left - 8, sy(t) + 4, `${Math.round(t * 1000) / 10}`, { size: 11, anchor: "end", fill: INK_3 }));
  }
  out.push(line(left, bottom, right, bottom, AXIS));

  if (xd === null) {
    out.push(text((left + right) / 2, (top + bottom) / 2, "비용 정보 없음", { size: 12, anchor: "middle", fill: INK_3 }));
    return out;
  }
  const lmin = Math.log10(xd.min);
  const lmax = Math.log10(xd.max);
  const sx = (v: number): number => left + ((Math.log10(v) - lmin) / (lmax - lmin)) * (right - left);
  for (let e = Math.round(lmin); e <= Math.round(lmax); e++) {
    const v = 10 ** e;
    out.push(line(sx(v), bottom, sx(v), bottom + 4, AXIS));
    out.push(text(sx(v), bottom + 17, usdTick(v), { size: 11, anchor: "middle", fill: INK_3 }));
  }

  const ordered = [...ds.results].sort((a, b) => MODEL_ALIASES.indexOf(a.model) - MODEL_ALIASES.indexOf(b.model));
  for (const r of ordered) {
    if (r.cost.per1kUsd === null || r.cost.per1kUsd <= 0) continue;
    const x = sx(r.cost.per1kUsd);
    const style = MODEL_STYLE[r.model];
    out.push(line(x, sy(r.primary.ci[0]), x, sy(r.primary.ci[1]), style.color, 2));
    out.push(line(x - 4, sy(r.primary.ci[0]), x + 4, sy(r.primary.ci[0]), style.color, 2));
    out.push(line(x - 4, sy(r.primary.ci[1]), x + 4, sy(r.primary.ci[1]), style.color, 2));
    out.push(marker(style.shape, x, sy(r.primary.value), style.color));
  }
  return out;
}

export function renderCostAccuracySvg(metrics: Metrics): string {
  const defaults = metrics.datasets.filter((d) => d.tier === "default");
  const datasets = defaults.length > 0 ? defaults : metrics.datasets;
  const cols = 4;
  const rows = Math.max(1, Math.ceil((datasets.length + 1) / cols));
  const marginX = 40;
  const headerH = 86;
  const width = marginX * 2 + cols * PANEL_W + (cols - 1) * PANEL_GAP_X;
  const height = headerH + rows * PANEL_H + (rows - 1) * PANEL_GAP_Y + 40;
  const xd = costDomain(datasets);

  const body = [
    text(marginX, 40, "비용 대비 주지표", { size: 24, weight: 700, fill: INK }),
    text(
      marginX,
      66,
      "x: 1천 건당 비용(USD, 로그축, 토큰 사용량 기준) / y: 주지표 %(실패는 abstain, ITT) / 세로 막대: 95% paired bootstrap CI",
      { size: 13, fill: INK_2 },
    ),
  ];
  datasets.forEach((ds, i) => {
    const ox = marginX + (i % cols) * (PANEL_W + PANEL_GAP_X);
    const oy = headerH + Math.floor(i / cols) * (PANEL_H + PANEL_GAP_Y);
    body.push(...costPanel(ds, ox, oy, xd));
  });
  const slot = datasets.length;
  const lx = marginX + (slot % cols) * (PANEL_W + PANEL_GAP_X) + 16;
  const ly = headerH + Math.floor(slot / cols) * (PANEL_H + PANEL_GAP_Y) + 40;
  const models = MODEL_ALIASES.filter((m) => metrics.models.some((s) => s.alias === m));
  const names = new Map(metrics.models.map((m) => [m.alias, `${m.alias} (${m.apiModel})`] as const));
  body.push(...legend(lx, ly, models, names));
  body.push(
    text(lx, ly + 26 + models.length * 24 + 16, "y축 범위는 패널마다 다르다.", { size: 11, fill: INK_3 }),
    text(lx, ly + 26 + models.length * 24 + 34, "x축(비용)은 모든 패널이 같다.", { size: 11, fill: INK_3 }),
  );
  return svgDocument(width, height, body);
}

// ── reliability ──

const REL_PLOT = 400;
const MODE_TITLES: Readonly<Record<CalibrationMode, string>> = {
  choice: "Choice: 선택 라벨 확률(top-label)",
  noul: "Noul: p(true)",
};
const MODE_Y: Readonly<Record<CalibrationMode, string>> = {
  choice: "실제 정답률",
  noul: "실제 true 비율",
};
const SOURCE_TEXT = { "jev-direct": "Jev 직접 확률", verbalized: "말로 답한 확률(verbalized)" } as const;

function reliabilityPanel(rel: Reliability | undefined, mode: CalibrationMode, ox: number, oy: number, color: string, bins: number): string[] {
  const out: string[] = [];
  const left = ox + 64;
  const top = oy + 58;
  const right = left + REL_PLOT;
  const bottom = top + REL_PLOT;
  const sx = (v: number): number => left + v * REL_PLOT;
  const sy = (v: number): number => bottom - v * REL_PLOT;

  out.push(text(ox, oy + 16, MODE_TITLES[mode], { size: 16, weight: 700, fill: INK }));
  const sub =
    rel === undefined
      ? "해당 형식 데이터셋 없음"
      : `${SOURCE_TEXT[rel.source]}, n=${rel.n}, ECE ${rel.ece === null ? "없음" : rel.ece.toFixed(3)}, ${rel.datasets.map((d) => DATASET_LABELS[d]).join(", ")}`;
  out.push(text(ox, oy + 38, sub, { size: 12, fill: INK_2 }));

  for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
    out.push(line(left, sy(t), right, sy(t), GRID));
    out.push(line(sx(t), top, sx(t), bottom, GRID));
    out.push(text(left - 8, sy(t) + 4, t.toFixed(1), { size: 11, anchor: "end", fill: INK_3 }));
    out.push(text(sx(t), bottom + 18, t.toFixed(1), { size: 11, anchor: "middle", fill: INK_3 }));
  }
  out.push(line(left, bottom, right, bottom, AXIS));
  out.push(line(left, top, left, bottom, AXIS));
  out.push(line(sx(0), sy(0), sx(1), sy(1), INK_3, 1.5, "5 4"));
  out.push(text(sx(0.93), sy(0.93) - 8, "완전 보정", { size: 11, anchor: "end", fill: INK_3 }));
  out.push(text((left + right) / 2, bottom + 40, "예측 확률(bin 평균)", { size: 12, anchor: "middle", fill: INK_2 }));
  out.push(text(ox + 16, (top + bottom) / 2, MODE_Y[mode], { size: 12, anchor: "middle", fill: INK_2, rotate: -90 }));

  // bin별 n. x축 아래 한 줄, 그리고 표본 분포를 보여 주는 옅은 막대
  const binW = REL_PLOT / bins;
  out.push(text(left - 8, bottom + 62, "n", { size: 11, anchor: "end", fill: INK_2, weight: 600 }));
  if (rel === undefined) return out;
  const maxN = Math.max(1, ...rel.bins.map((b) => b.n));
  for (const b of rel.bins) {
    const cx = left + (b.index + 0.5) * binW;
    out.push(text(cx, bottom + 62, b.n.toString(), { size: 10, anchor: "middle", fill: b.n === 0 ? INK_3 : INK_2 }));
    if (b.n > 0) {
      const h = (b.n / maxN) * 56;
      out.push(`<rect x="${r1(left + b.index * binW + 1)}" y="${r1(bottom - h)}" width="${r1(binW - 2)}" height="${r1(h)}" fill="${color}" fill-opacity="0.14"/>`);
    }
  }
  const points = rel.bins
    .filter((b) => b.n > 0 && b.meanConfidence !== null && b.observed !== null)
    .map((b) => ({ x: sx(b.meanConfidence ?? 0), y: sy(b.observed ?? 0) }));
  if (points.length > 1) {
    out.push(`<polyline points="${points.map((p) => `${r1(p.x)},${r1(p.y)}`).join(" ")}" fill="none" stroke="${color}" stroke-width="2"/>`);
  }
  for (const p of points) out.push(`<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="4.5" fill="${color}" stroke="${SURFACE}" stroke-width="2"/>`);
  return out;
}

export function renderReliabilitySvg(metrics: Metrics, model: ModelAlias): string {
  const spec = metrics.models.find((m) => m.alias === model);
  const color = MODEL_STYLE[model].color;
  const width = 40 + 2 * (REL_PLOT + 64 + 40) + 40;
  const height = 100 + 58 + REL_PLOT + 90;
  const find = (mode: CalibrationMode): Reliability | undefined =>
    metrics.reliability.find((r) => r.model === model && r.mode === mode);
  return svgDocument(width, height, [
    text(40, 40, `신뢰도 곡선: ${model}${spec === undefined ? "" : ` (${spec.apiModel})`}`, { size: 22, weight: 700, fill: INK }),
    text(40, 66, `${metrics.eceBins}개 등간격 bin(확률 1.0은 마지막 bin). 점은 bin 평균 확률 대 실제 비율, 옅은 막대는 bin별 표본 수`, {
      size: 13,
      fill: INK_2,
    }),
    ...reliabilityPanel(find("choice"), "choice", 40, 100, color, metrics.eceBins),
    ...reliabilityPanel(find("noul"), "noul", 40 + REL_PLOT + 64 + 40, 100, color, metrics.eceBins),
  ]);
}

// ── PNG와 파일 ──

/** SVG → PNG(2배). resvg를 불러오지 못하거나 렌더에 실패하면 null과 사유 */
export async function svgToPng(svg: string): Promise<{ png: Buffer | null; warning: string | null }> {
  // 글꼴이 없으면 resvg는 글자를 조용히 빼고 그리므로, 한글이 빠진 PNG 대신 SVG만 남긴다
  const missing = FONT_FILES.filter((f) => !existsSync(f));
  if (missing.length > 0) return { png: null, warning: `Pretendard 글꼴 없음(SVG만 남김): ${missing.join(", ")}` };
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const resvg = new Resvg(svg, {
      font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: FONT, sansSerifFamily: FONT },
      fitTo: { mode: "zoom", value: 2 },
      background: SURFACE,
    });
    return { png: resvg.render().asPng(), warning: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { png: null, warning: `PNG 변환 실패(SVG만 남김): ${reason}` };
  }
}

export interface ChartResult {
  readonly files: readonly string[];
  readonly warnings: readonly string[];
}

/** charts/ 아래에 cost-accuracy와 모델별 reliability를 SVG와 PNG로 쓴다 */
export async function writeCharts(chartsDir: string, metrics: Metrics): Promise<ChartResult> {
  await mkdir(chartsDir, { recursive: true });
  const charts: { name: string; svg: string }[] = [
    { name: "cost-accuracy", svg: renderCostAccuracySvg(metrics) },
    ...metrics.models.map((m) => ({ name: `reliability-${m.alias}`, svg: renderReliabilitySvg(metrics, m.alias) })),
  ];
  const files: string[] = [];
  const warnings = new Set<string>();
  for (const chart of charts) {
    const svgPath = path.join(chartsDir, `${chart.name}.svg`);
    await writeFile(svgPath, chart.svg, "utf8");
    files.push(svgPath);
    const { png, warning } = await svgToPng(chart.svg);
    if (png === null) {
      if (warning !== null) warnings.add(warning);
      continue;
    }
    const pngPath = path.join(chartsDir, `${chart.name}.png`);
    await writeFile(pngPath, png);
    files.push(pngPath);
  }
  return { files, warnings: [...warnings] };
}
