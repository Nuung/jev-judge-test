// 비교 모델 등록부 — 별칭 → 제공자·API 모델명·단가(출처)·토크나이저 계수(계획 §7).
// 여기 없는 별칭은 단가가 없어 실행할 수 없다.
import type { ModelAlias, ModelSpec, ProviderId } from "./types";

const JEV_PRICING_SOURCE = "https://docs.typesafe.ai/models.md (2026-09-29 조회)";
const ANTHROPIC_PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing (2026-09-28 조회)";
const OPENAI_PRICING_SOURCE = "https://developers.openai.com/api/docs/models (2026-09-29 조회)";

/**
 * 토큰 추정 계수 — o200k 근사 기준선(plan.ts estimateTokens, 출력은 과제당 25)에 곱한다.
 * 본 실행(bench/results/2026-09-29T13-57-11) 실측 usage 합 ÷ 기준선 합으로 맞췄다. 입력과 출력은 비율이 달라 따로 둔다.
 * 같은 프롬프트라도 Sonnet 5의 입력 토큰이 Haiku 4.5보다 약 34% 많아 제공자가 아니라 모델 단위로 둔다.
 */
const TOKEN_FACTORS: Readonly<Record<ModelAlias, { readonly input: number; readonly output: number }>> = {
  // 입력 1,248,880 / 기준선 593,543(n=2,100), 출력은 SDK usage 기준(단가 0이라 비용 무관)
  jev: { input: 2.1, output: 6.0 },
  // 입력 1,836,608 / 1,049,243(n=2,100), 출력 35,233 / 52,500
  haiku: { input: 1.75, output: 0.67 },
  // 입력 2,467,056 / 1,049,243(n=2,100), 출력 44,207 / 52,500
  sonnet: { input: 2.35, output: 0.84 },
  // 입력 1,202,387 / 1,049,243(n=2,100), 출력 43,311 / 52,500
  luna: { input: 1.15, output: 0.83 },
  // 입력 1,202,387 / 1,049,243(n=2,100), 출력 43,367 / 52,500
  sol: { input: 1.15, output: 0.83 },
};

export const MODELS: Readonly<Record<ModelAlias, ModelSpec>> = {
  jev: {
    alias: "jev",
    provider: "jev",
    apiModel: "jev-1.13.0",
    // 출력 토큰은 무료
    pricing: { inputPerMTok: 0.042, outputPerMTok: 0, source: JEV_PRICING_SOURCE },
    tokenizerFactor: TOKEN_FACTORS.jev.input,
    outputTokenFactor: TOKEN_FACTORS.jev.output,
  },
  haiku: {
    alias: "haiku",
    provider: "anthropic",
    apiModel: "claude-haiku-4-5-20251001",
    pricing: { inputPerMTok: 1, outputPerMTok: 5, source: ANTHROPIC_PRICING_SOURCE },
    tokenizerFactor: TOKEN_FACTORS.haiku.input,
    outputTokenFactor: TOKEN_FACTORS.haiku.output,
  },
  sonnet: {
    alias: "sonnet",
    provider: "anthropic",
    apiModel: "claude-sonnet-5",
    pricing: { inputPerMTok: 2, outputPerMTok: 10, source: ANTHROPIC_PRICING_SOURCE },
    tokenizerFactor: TOKEN_FACTORS.sonnet.input,
    outputTokenFactor: TOKEN_FACTORS.sonnet.output,
  },
  luna: {
    alias: "luna",
    provider: "openai",
    apiModel: "gpt-6-luna",
    pricing: { inputPerMTok: 0.1, outputPerMTok: 0.5, source: OPENAI_PRICING_SOURCE },
    tokenizerFactor: TOKEN_FACTORS.luna.input,
    outputTokenFactor: TOKEN_FACTORS.luna.output,
  },
  sol: {
    alias: "sol",
    provider: "openai",
    apiModel: "gpt-6-sol",
    pricing: { inputPerMTok: 2, outputPerMTok: 10, source: OPENAI_PRICING_SOURCE },
    tokenizerFactor: TOKEN_FACTORS.sol.input,
    outputTokenFactor: TOKEN_FACTORS.sol.output,
  },
};

/** 제공자별로 필요한 API 키 환경변수(값은 SDK가 직접 읽는다) */
export const PROVIDER_API_KEY_ENV: Readonly<Record<ProviderId, string>> = {
  jev: "TYPESAFE_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};
