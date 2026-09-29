// 데이터셋 레지스트리 — id → 정의. 기본 실행은 tier "default" 7개만 쓴다.
import { DATASET_IDS, type DatasetId, type DatasetSpec } from "../types";
import { agNews } from "./ag-news";
import { banking77 } from "./banking77";
import { demoSmoke } from "./demo-smoke";
import { enronSpam } from "./enron-spam";
import { jbbJudge } from "./jbb-judge";
import { klueYnat } from "./klue-ynat";
import { kmhas } from "./kmhas";
import { sst2 } from "./sst2";
import { toxicchat } from "./toxicchat";
import { wildguardmix } from "./wildguardmix";

export const DATASETS: Readonly<Record<DatasetId, DatasetSpec>> = {
  sst2,
  "ag-news": agNews,
  banking77,
  "enron-spam": enronSpam,
  "jbb-judge": jbbJudge,
  "klue-ynat": klueYnat,
  kmhas,
  wildguardmix,
  toxicchat,
  "demo-smoke": demoSmoke,
};

/** 기본 세트(사전 선언 가설 집합의 데이터셋, DATASET_IDS 순서) */
export const DEFAULT_DATASET_IDS: readonly DatasetId[] = DATASET_IDS.filter((id) => DATASETS[id].tier === "default");
