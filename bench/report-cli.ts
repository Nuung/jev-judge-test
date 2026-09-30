// pnpm bench:report <결과 폴더>: 저장된 결과로 summary.md와 차트를 다시 만든다(API 호출 없음).
// 입력은 metrics.json이고, 같은 metrics.json이면 같은 summary.md가 나온다.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { writeCharts } from "./report/charts";
import { renderSummary } from "./report/markdown";
import { readMetrics, resultPaths } from "./report/raw";
import type { Metrics } from "./report/raw";

const HELP = `사용법: pnpm bench:report <결과 폴더>

bench/results/<시각>/metrics.json을 읽어 summary.md와 charts/*.{svg,png}를 다시 만든다.
API를 호출하지 않는다.
`;

/** summary.md와 차트를 결과 폴더에 쓴다. 러너도 실행이 끝나면 이 함수를 부른다 */
export async function writeReport(root: string, metrics: Metrics): Promise<void> {
  const paths = resultPaths(root);
  await writeFile(paths.summary, renderSummary(metrics), "utf8");
  const charts = await writeCharts(paths.chartsDir, metrics);
  for (const warning of charts.warnings) console.warn(`경고: ${warning}`);
  console.log(`요약: ${paths.summary}`);
  for (const file of charts.files) console.log(`차트: ${file}`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: { help: { type: "boolean", short: "h" } },
    strict: true,
    allowPositionals: true,
  });
  const root = positionals[0];
  if (values.help === true || root === undefined) {
    console.log(HELP);
    if (root === undefined && values.help !== true) process.exitCode = 1;
    return;
  }
  await writeReport(root, await readMetrics(root));
}

// 모듈로 import될 때(러너가 writeReport를 쓸 때)는 실행하지 않는다
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
