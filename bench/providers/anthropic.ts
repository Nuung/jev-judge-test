// Anthropic 제공자 — Messages API + 구조화 출력(zodOutputFormat). SDK 재시도 0, 시도당 타임아웃은 요청 옵션으로 준다.
// 응답은 원문으로 저장하고 parse에서 읽는다. messages.parse()는 max_tokens로 잘린 JSON에서 예외를 던져
// stop_reason·usage를 잃기 때문에, 같은 출력 형식을 create()에 넘긴다(요청 본문은 동일).
import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { VERSION } from "@anthropic-ai/sdk/version";
import { classifyHttpError, classifyNonHttp, errorMessage } from "../retry";
import type { ErrorClassification, ParsedResponse, Provider, RawResponse, TaskDefinition } from "../types";
import { buildOutputSchema, buildSystemPrompt, buildUserMessage, parseLlmOutput, textToOutput } from "./prompt";

/** 추론 끔(off)의 출력 상한 */
export const MAX_TOKENS_OFF = 512;
/** 제공자 기본 추론(default)의 출력 상한 — 비용 상한용 값 */
export const MAX_TOKENS_DEFAULT = 4096;

function parseAnthropic(raw: RawResponse, tasks: readonly TaskDefinition[]): ParsedResponse {
  if (raw.kind === "http_error") return { ok: false, errorKind: "client_4xx", detail: `${raw.status}: ${raw.body}` };
  if (raw.stop === "refusal") return { ok: false, errorKind: "refusal", detail: "stop_reason: refusal" };
  if (raw.stop === "max_tokens" || raw.stop === "model_context_window_exceeded") {
    return { ok: false, errorKind: "max_tokens", detail: `stop_reason: ${raw.stop}` };
  }
  if (raw.stop !== "end_turn") return { ok: false, errorKind: "format", detail: `stop_reason: ${raw.stop ?? "null"}` };
  return parseLlmOutput(raw.output, tasks);
}

function classifyAnthropic(error: unknown): ErrorClassification {
  // 타임아웃·중단은 APIConnectionError/APIError의 하위 클래스라 먼저 본다
  if (error instanceof APIConnectionTimeoutError) return classifyNonHttp("retryable", "timeout");
  if (error instanceof APIConnectionError) return classifyNonHttp("retryable", "connection");
  if (error instanceof APIUserAbortError) return classifyNonHttp("config", "aborted");
  if (error instanceof APIError && error.status !== undefined) {
    return classifyHttpError(error.status, error.headers, error.error);
  }
  // 키 없음(AnthropicError) 등 설정 오류와 그 밖의 예외는 레인을 멈춘다
  return classifyNonHttp("config", errorMessage(error));
}

export function createAnthropicProvider(): Provider {
  let client: Anthropic | null = null;
  return {
    id: "anthropic",
    sdkVersion: `@anthropic-ai/sdk@${VERSION}`,
    probabilitySource: "verbalized",
    async judge({ model, tasks, state, reasoning, timeoutMs, signal }) {
      // 키는 SDK가 ANTHROPIC_API_KEY에서 읽는다. 없으면 생성자가 던진다 → config
      client ??= new Anthropic({ maxRetries: 0 });
      const off = reasoning === "off";
      const message = await client.messages.create(
        {
          model: model.apiModel,
          max_tokens: off ? MAX_TOKENS_OFF : MAX_TOKENS_DEFAULT,
          // off: thinking을 명시적으로 끈다(Sonnet 5는 기본이 켜짐, Haiku 4.5는 기본이 꺼짐). default: 생략
          ...(off ? { thinking: { type: "disabled" } } : {}),
          system: buildSystemPrompt(tasks),
          messages: [{ role: "user", content: buildUserMessage(state) }],
          output_config: { format: zodOutputFormat(buildOutputSchema(tasks)) },
        },
        { timeout: timeoutMs, signal },
      );
      const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      return {
        kind: "response",
        model: message.model,
        output: textToOutput(text),
        stop: message.stop_reason,
        usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      };
    },
    parse: parseAnthropic,
    classify: classifyAnthropic,
  };
}
