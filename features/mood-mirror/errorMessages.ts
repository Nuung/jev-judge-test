// 판정 요청 실패 시 보여줄 한국어 안내 — 서버 에러 코드 + 클라이언트 자체 실패 사유를 모두 포함한다.
import type { ErrorCode } from "@/lib/judge/schema";

export type ClientErrorCode = ErrorCode | "network_error" | "invalid_response" | "unknown_error";

export const ERROR_GUIDE_KO: Readonly<Record<ClientErrorCode, string>> = {
  invalid_input: "입력값을 확인해 주세요.",
  upstream_error: "판정 서버 호출에 실패했어요. 잠시 후 다시 시도해 주세요.",
  upstream_rate_limited: "요청이 많아 잠시 제한됐어요. 잠시 후 다시 시도해 주세요.",
  config_error: "서버 설정에 문제가 있어요. 잠시 후 다시 시도해 주세요.",
  network_error: "서버에 연결할 수 없어요. 네트워크 상태를 확인해 주세요.",
  invalid_response: "서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.",
  unknown_error: "알 수 없는 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
};
