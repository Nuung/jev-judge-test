// 추정 비용 계산용 단가(USD / 100만 토큰). 가격은 바뀔 수 있으므로 출처와 확인일을 함께 둔다.
import type { ClaudeModel } from "./claude";

export interface Pricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /** 출처 · 확인일 */
  source: string;
}

// 출처: https://docs.typesafe.ai/models.md (2026-09-28 확인). 출력 토큰은 과금하지 않는다.
export const JEV_PRICING: Pricing = {
  inputPerMTok: 0.042,
  outputPerMTok: 0,
  source: "docs.typesafe.ai/models.md (2026-09-28 확인)",
};

// 출처: 2026-09-28 공식 가격 페이지 확인(https://platform.claude.com/docs/en/about-claude/pricing)
export const CLAUDE_PRICING = {
  "claude-haiku-4-5-20251001": {
    inputPerMTok: 1,
    outputPerMTok: 5,
    source: "platform.claude.com/docs/en/about-claude/pricing (2026-09-28 확인)",
  },
  "claude-sonnet-5": {
    inputPerMTok: 2,
    outputPerMTok: 10,
    source: "platform.claude.com/docs/en/about-claude/pricing (2026-09-28 확인)",
  },
} satisfies Record<ClaudeModel, Pricing>;

export function estimateCost(pricing: Pricing, inputTokens: number, outputTokens: number): number {
  return (inputTokens * pricing.inputPerMTok + outputTokens * pricing.outputPerMTok) / 1_000_000;
}
