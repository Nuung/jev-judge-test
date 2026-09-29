// 제공자 생성·사용 가능 여부·결과 조립.
import { MODELS, PROVIDER_API_KEY_ENV } from "../models";
import type { RetryResult } from "../retry";
import type { Attempt, JudgeOutcome, ModelAlias, Provider, ProviderId, RawResponse, TaskDefinition } from "../types";
import { createAnthropicProvider } from "./anthropic";
import { createJevProvider } from "./jev";
import { createOpenAIProvider } from "./openai";

export function createProvider(id: ProviderId): Provider {
  switch (id) {
    case "jev":
      return createJevProvider();
    case "anthropic":
      return createAnthropicProvider();
    case "openai":
      return createOpenAIProvider();
  }
}

export type Availability = { readonly available: true } | { readonly available: false; readonly reason: string };

/** 키가 없으면 unavailable(사유). 키 값은 읽지 않고 존재 여부만 본다 */
export function providerAvailability(id: ProviderId, env: NodeJS.ProcessEnv = process.env): Availability {
  const name = PROVIDER_API_KEY_ENV[id];
  const value = env[name];
  if (value === undefined || value.trim() === "") return { available: false, reason: `${name}가 설정되지 않았습니다` };
  return { available: true };
}

export function modelAvailability(alias: ModelAlias, env: NodeJS.ProcessEnv = process.env): Availability {
  return providerAvailability(MODELS[alias].provider, env);
}

/** 원 응답(새 호출 또는 캐시)을 파싱해 JudgeOutcome으로 만든다 */
export function outcomeFromRaw(
  provider: Provider,
  raw: RawResponse,
  tasks: readonly TaskDefinition[],
  meta: { readonly attempts: readonly Attempt[]; readonly cached: boolean; readonly measuredAt: string },
): JudgeOutcome {
  const usage = raw.kind === "response" ? raw.usage : null;
  const parsed = provider.parse(raw, tasks);
  const base = { ...meta, usage, raw };
  if (parsed.ok) return { ...base, ok: true, answers: parsed.answers };
  return { ...base, ok: false, errorKind: parsed.errorKind, detail: parsed.detail };
}

/** bench/retry.ts의 결과를 JudgeOutcome으로 만든다(새 호출) */
export function outcomeFromRetry(
  provider: Provider,
  result: RetryResult,
  tasks: readonly TaskDefinition[],
  measuredAt: string,
): JudgeOutcome {
  if (result.status === "response") {
    return outcomeFromRaw(provider, result.raw, tasks, { attempts: result.attempts, cached: false, measuredAt });
  }
  return {
    ok: false,
    errorKind: result.errorKind,
    detail: result.detail,
    attempts: result.attempts,
    usage: null,
    raw: null,
    cached: false,
    measuredAt,
  };
}
