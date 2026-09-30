// Jev 제공자. lib/jev의 클라이언트를 재시도 0으로 만들고, 시도당 타임아웃은 호출별 옵션으로 준다(lib 수정 없음).
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  VERSION,
  type TypeSafeClient,
} from "@typesafe-ai/sdk";
import { z } from "zod";
import { createJevClient } from "@/lib/jev/client";
import { classifyHttpError, classifyNonHttp, errorMessage } from "../retry";
import type { Answer, Answers, ErrorClassification, ParsedResponse, Provider, RawResponse, TaskDefinition } from "../types";
import { toQuestions } from "./prompt";

// SDK는 응답을 런타임 검증하지 않는다. 저장은 느슨하게(JSON 값), 과제별 검증은 parse에서 한다
const JevResultSchema = z.object({
  model: z.string(),
  answers: z.json(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

const AnswersObjectSchema = z.record(z.string(), z.unknown());
// 범위 제약 없이 받아 [0,1]은 직접 검사한다
const ChoiceResponseSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
});
const NoulResponseSchema = z.object({ type: z.literal("noul"), noul: z.number() });

function inRange(p: number): boolean {
  return p >= 0 && p <= 1;
}

function parseJev(raw: RawResponse, tasks: readonly TaskDefinition[]): ParsedResponse {
  if (raw.kind === "http_error") return { ok: false, errorKind: "client_4xx", detail: `${raw.status}: ${raw.body}` };
  const object = AnswersObjectSchema.safeParse(raw.output);
  if (!object.success) return { ok: false, errorKind: "format", detail: "answers가 JSON 객체가 아닙니다" };

  const answers: Record<string, Answer> = {};
  for (const task of tasks) {
    const field = object.data[task.name];
    if (task.kind === "noul") {
      const parsed = NoulResponseSchema.safeParse(field);
      if (!parsed.success) return { ok: false, errorKind: "format", detail: `${task.name}: ${parsed.error.message}` };
      if (!inRange(parsed.data.noul)) return { ok: false, errorKind: "range", detail: `${task.name}.noul=${parsed.data.noul}` };
      answers[task.name] = { kind: "noul", probability: parsed.data.noul };
      continue;
    }
    const parsed = ChoiceResponseSchema.safeParse(field);
    if (!parsed.success) return { ok: false, errorKind: "format", detail: `${task.name}: ${parsed.error.message}` };
    const { choice, probabilities } = parsed.data;
    if (!task.labels.includes(choice)) {
      return { ok: false, errorKind: "format", detail: `${task.name}.choice가 라벨 체계 밖입니다: ${choice}` };
    }
    const outOfRange = Object.entries(probabilities).find(([, p]) => !inRange(p));
    if (outOfRange !== undefined) {
      return { ok: false, errorKind: "range", detail: `${task.name}.probabilities.${outOfRange[0]}=${outOfRange[1]}` };
    }
    // confidence는 확률이 아니므로((K×p_max−1)/(K−1)) 보정에는 선택 라벨의 확률을 쓴다. confidence는 원 응답에만 남는다
    const probability = probabilities[choice];
    if (probability === undefined) {
      return { ok: false, errorKind: "format", detail: `${task.name}.probabilities에 선택 라벨(${choice})이 없습니다` };
    }
    answers[task.name] = { kind: "choice", choice, probability, probabilities };
  }
  const result: Answers = answers;
  return { ok: true, answers: result };
}

// 존재하지 않는 모델명은 Jev가 404가 아니라 400(api_usage_error, "Unknown model: …")으로 돌려준다.
// 입력 기인 4xx(client_4xx)로 캐시되지 않도록 config로 바꾼다
const UnknownModelBodySchema = z.object({ detail: z.object({ message: z.string().startsWith("Unknown model") }) });

function classifyJev(error: unknown): ErrorClassification {
  // 타임아웃은 APIConnectionError의 하위 클래스라 먼저 본다
  if (error instanceof APITimeoutError) return classifyNonHttp("retryable", "timeout");
  if (error instanceof APIConnectionError) return classifyNonHttp("retryable", "connection");
  if (error instanceof APIUserAbortError) return classifyNonHttp("config", "aborted");
  if (error instanceof APIError) {
    const classification = classifyHttpError(error.status, error.headers, error.body);
    if (error.status === 400 && UnknownModelBodySchema.safeParse(error.body).success) {
      return { ...classification, class: "config", reason: "400:unknown_model" };
    }
    return classification;
  }
  // 키 없음, 설정 오류(TypeSafeError)와 그 밖의 예외는 레인을 멈춘다
  return classifyNonHttp("config", errorMessage(error));
}

export function createJevProvider(): Provider {
  let client: TypeSafeClient | null = null;
  return {
    id: "jev",
    sdkVersion: `@typesafe-ai/sdk@${VERSION}`,
    probabilitySource: "jev-direct",
    async judge({ model, tasks, state, timeoutMs, signal }) {
      // 키가 없으면 생성자가 TypeSafeError를 던진다 → config
      client ??= createJevClient({ maxRetries: 0 });
      const result: unknown = await client.systemOne(
        { model: model.apiModel, state, questions: toQuestions(tasks) },
        { timeout: timeoutMs, signal },
      );
      const parsed = JevResultSchema.safeParse(result);
      if (!parsed.success) {
        // 응답 봉투가 예상과 다르면 원문을 남기고 parse에서 format으로 센다
        const json = z.json().safeParse(result);
        return { kind: "response", model: null, output: json.success ? json.data : null, stop: null, usage: null };
      }
      const { usage } = parsed.data;
      return {
        kind: "response",
        model: parsed.data.model,
        output: parsed.data.answers,
        stop: null,
        usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens },
      };
    },
    parse: parseJev,
    classify: classifyJev,
  };
}
