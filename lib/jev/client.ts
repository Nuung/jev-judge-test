// TypeSafe 클라이언트 생성. 키는 SDK가 TYPESAFE_API_KEY 환경변수에서 읽는다(서버 전용).
import { TypeSafeClient } from "@typesafe-ai/sdk";

/** 시도당 타임아웃(ms) */
export const JEV_TIMEOUT_MS = 8000;

export interface JevClientOptions {
  /** 최초 시도 이후 재시도 횟수. 생략하면 SDK 기본값(2) */
  maxRetries?: number;
}

/**
 * @throws {TypeSafeError} API 키가 없거나 설정이 잘못된 경우
 */
export function createJevClient(options: JevClientOptions = {}): TypeSafeClient {
  const { maxRetries } = options;
  return new TypeSafeClient({
    timeout: JEV_TIMEOUT_MS,
    ...(maxRetries === undefined ? {} : { retry: { maxRetries } }),
  });
}
