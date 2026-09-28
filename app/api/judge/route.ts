// POST /api/judge: 한국어 한마디와 표정 확률 스냅샷을 받아 Jev를 한 번 호출해 판정한다.
import {
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeError,
  type TypeSafeClient,
} from "@typesafe-ai/sdk";
import { rankFace } from "@/lib/judge/face";
import { createJevClient } from "@/lib/jev/client";
import { judgeWithJev, JevResponseError } from "@/lib/jev/judge";
import { decide } from "@/lib/judge/policy";
import {
  JudgeRequestSchema,
  type ErrorCode,
  type ErrorResponse,
  type JudgeResponse,
} from "@/lib/judge/schema";

// 지연 생성 싱글턴. 데모 응답이 늦어지지 않게 재시도는 1회로 제한한다
let jevClient: TypeSafeClient | undefined;
function getJevClient(): TypeSafeClient {
  jevClient ??= createJevClient({ maxRetries: 1 });
  return jevClient;
}

function errorResponse(status: number, code: ErrorCode, message: string): Response {
  const body: ErrorResponse = { error: { code, message } };
  return Response.json(body, { status });
}

// 요청 본문 최대 크기(UTF-8 바이트). 정상 요청(한마디 300자 + 표정 확률 7개)은 2KB를 넘지 않는다
const MAX_BODY_BYTES = 4096;

function tooLarge(): Response {
  return errorResponse(413, "invalid_input", "요청이 너무 커요.");
}

export async function POST(request: Request): Promise<Response> {
  // 미디어 타입은 대소문자를 구분하지 않는다(RFC 9110)
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return errorResponse(415, "invalid_input", "JSON 요청만 받아요.");
  }

  // content-length 헤더가 있으면 본문을 읽기 전에 거른다. 헤더가 없거나(chunked) 거짓일 수 있으므로
  // 본문을 다 읽은 뒤 실제 크기를 한 번 더 확인한다. 본문 읽기를 중간에 끊지는 않는다
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return tooLarge();

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return tooLarge();

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return errorResponse(400, "invalid_input", "요청 본문이 올바른 JSON이 아니에요.");
  }

  const parsed = JudgeRequestSchema.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "요청 형식이 올바르지 않아요.";
    return errorResponse(400, "invalid_input", message);
  }
  const input = parsed.data;

  let client: TypeSafeClient;
  try {
    client = getJevClient();
  } catch (error) {
    // 키 값은 노출하지 않고 에러 종류만 서버 로그에 남긴다
    console.error("[api/judge] Jev 클라이언트 생성 실패", error instanceof Error ? error.name : "UnknownError");
    return errorResponse(
      500,
      "config_error",
      "서버에 TYPESAFE_API_KEY가 설정되지 않았어요. .env를 확인한 뒤 서버를 다시 시작해 주세요.",
    );
  }

  try {
    const judgment = await judgeWithJev(client, input);
    const body: JudgeResponse = {
      model: judgment.model,
      latencyMs: judgment.latencyMs,
      inputTokens: judgment.inputTokens,
      ...decide(judgment.answers, input.face === null ? null : rankFace(input.face)),
    };
    return Response.json(body);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return errorResponse(429, "upstream_rate_limited", "Jev 호출 한도를 넘었어요. 잠시 후 다시 시도해 주세요.");
    }
    if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
      console.error("[api/judge] Jev 인증 실패", error.status);
      return errorResponse(500, "config_error", "서버의 TYPESAFE_API_KEY가 유효하지 않아요.");
    }
    // 그 밖의 SDK 에러 전반(APIError·APIConnectionError·APIUserAbortError 등)과 응답 형식 오류
    if (error instanceof TypeSafeError || error instanceof JevResponseError) {
      console.error("[api/judge] Jev 호출 실패", error.name, error.message);
      return errorResponse(502, "upstream_error", "Jev 판정 서버에서 답을 받지 못했어요.");
    }
    // 분류하지 못한 예외도 Next 기본 HTML 500 대신 JSON 에러로 응답한다
    console.error("[api/judge] 알 수 없는 오류", error instanceof Error ? error.name : typeof error);
    return errorResponse(500, "upstream_error", "판정 중 알 수 없는 오류가 생겼어요.");
  }
}
