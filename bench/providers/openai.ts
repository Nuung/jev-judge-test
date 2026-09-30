// OpenAI 제공자. Responses API + 구조화 출력(zodTextFormat). SDK 재시도 0, 시도당 타임아웃은 요청 옵션으로 준다.
// 응답은 원문으로 저장하고 parse에서 읽는다(파서가 바뀌어도 재호출하지 않도록). 같은 출력 형식을 create()에 넘긴다.
import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { VERSION } from "openai/version";
import { classifyHttpError, classifyNonHttp, errorMessage } from "../retry";
import type { ErrorClassification, ParsedResponse, Provider, RawResponse, TaskDefinition } from "../types";
import { buildOutputSchema, buildSystemPrompt, buildUserMessage, parseLlmOutput, textToOutput } from "./prompt";

/** 추론 끔(off)의 출력 상한 */
export const MAX_OUTPUT_TOKENS_OFF = 512;
/** 제공자 기본 추론(default, medium)의 출력 상한. 추론 토큰 포함, 비용 상한용 값 */
export const MAX_OUTPUT_TOKENS_DEFAULT = 4096;

/** stop 기록값: 거절 항목이 있으면 "refusal", 미완료면 "incomplete:<사유>", 그 외 응답 status */
const STOP_REFUSAL = "refusal";
const INCOMPLETE_PREFIX = "incomplete:";

function parseOpenAI(raw: RawResponse, tasks: readonly TaskDefinition[]): ParsedResponse {
  if (raw.kind === "http_error") return { ok: false, errorKind: "client_4xx", detail: `${raw.status}: ${raw.body}` };
  if (raw.stop === STOP_REFUSAL) return { ok: false, errorKind: "refusal", detail: "refusal 항목" };
  if (raw.stop === `${INCOMPLETE_PREFIX}content_filter`) {
    return { ok: false, errorKind: "refusal", detail: `status: ${raw.stop}` };
  }
  if (raw.stop === `${INCOMPLETE_PREFIX}max_output_tokens`) {
    return { ok: false, errorKind: "max_tokens", detail: `status: ${raw.stop}` };
  }
  if (raw.stop !== "completed") return { ok: false, errorKind: "format", detail: `status: ${raw.stop ?? "null"}` };
  return parseLlmOutput(raw.output, tasks);
}

function classifyOpenAI(error: unknown): ErrorClassification {
  // 타임아웃과 중단은 APIConnectionError/APIError의 하위 클래스라 먼저 본다
  if (error instanceof APIConnectionTimeoutError) return classifyNonHttp("retryable", "timeout");
  if (error instanceof APIConnectionError) return classifyNonHttp("retryable", "connection");
  if (error instanceof APIUserAbortError) return classifyNonHttp("config", "aborted");
  if (error instanceof APIError && error.status !== undefined) {
    return classifyHttpError(error.status, error.headers, error.error);
  }
  // 키 없음(OpenAIError) 등 설정 오류와 그 밖의 예외는 레인을 멈춘다
  return classifyNonHttp("config", errorMessage(error));
}

export function createOpenAIProvider(): Provider {
  let client: OpenAI | null = null;
  return {
    id: "openai",
    sdkVersion: `openai@${VERSION}`,
    probabilitySource: "verbalized",
    async judge({ model, tasks, state, reasoning, timeoutMs, signal }) {
      // 키는 SDK가 OPENAI_API_KEY에서 읽는다. 없으면 생성자가 던진다 → config
      client ??= new OpenAI({ maxRetries: 0 });
      const off = reasoning === "off";
      const response = await client.responses.create(
        {
          model: model.apiModel,
          instructions: buildSystemPrompt(tasks),
          input: buildUserMessage(state),
          text: { format: zodTextFormat(buildOutputSchema(tasks), "answers") },
          // off: 추론을 끈다. default: 생략(제공자 기본 medium)
          ...(off ? { reasoning: { effort: "none" } } : {}),
          max_output_tokens: off ? MAX_OUTPUT_TOKENS_OFF : MAX_OUTPUT_TOKENS_DEFAULT,
          // 입력 텍스트를 제공자 쪽에 보관하지 않는다
          store: false,
        },
        { timeout: timeoutMs, signal },
      );

      const texts: string[] = [];
      const refusals: string[] = [];
      for (const item of response.output) {
        if (item.type !== "message") continue;
        for (const content of item.content) {
          if (content.type === "output_text") texts.push(content.text);
          else refusals.push(content.refusal);
        }
      }
      const stop =
        refusals.length > 0
          ? STOP_REFUSAL
          : response.status === "incomplete"
            ? `${INCOMPLETE_PREFIX}${response.incomplete_details?.reason ?? "unknown"}`
            : (response.status ?? null);
      return {
        kind: "response",
        model: response.model,
        output: refusals.length > 0 ? refusals.join("") : textToOutput(texts.join("")),
        stop,
        usage:
          response.usage === undefined || response.usage === null
            ? null
            : { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },
    parse: parseOpenAI,
    classify: classifyOpenAI,
  };
}
