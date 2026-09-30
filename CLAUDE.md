# jev-test

TypeSafe의 System One 모델 **Jev**를 시험하는 프로젝트다. 웹캠 표정(브라우저 로컬 추론)과 한국어 한마디를 Jev로 판정해 기분, 가드레일, 불일치, 맞춤 반응을 보여 주는 데모가 있고 공개 벤치마크로 Jev와 Claude, OpenAI 모델을 비교한다(`pnpm bench`).

## 시작하기
- Node 24(`.nvmrc`)와 pnpm을 준비한다.
- `cp .env.example .env` 후 `TYPESAFE_API_KEY`를 입력한다. `ANTHROPIC_API_KEY`와 `OPENAI_API_KEY`는 `pnpm bench`의 비교 모델에만, `HF_TOKEN`은 옵션 데이터셋 WildGuardMix에만 필요하다.
- `pnpm install && pnpm dev` → http://127.0.0.1:3000

## 문서와 SDK
- 이 프로젝트에서 작업할 때는 항상 `typesafe:typesafe-ai` 스킬을 사용한다.
- TypeSafe API/SDK 사용법은 기억에 의존하지 말고 라이브 문서(https://docs.typesafe.ai/llms.txt)를 먼저 확인한다. `@typesafe-ai/sdk`는 `0.6.0`에 고정한다(임의 업그레이드 금지).
- Jev는 영어가 1차 학습 언어라 한국어(CJK) 입력은 정확도가 낮을 수 있다(docs.typesafe.ai/concepts/state.md). 지시는 영어로, 한국어는 예문으로 둔다.
- Next.js 코드를 쓰기 전에 로컬 `node_modules/next/dist/docs/`와 공식 문서에서 최신 API를 확인한다(현재 next@16.3.6).

## 보안
- API 키(`TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `HF_TOKEN`)는 서버 쪽 환경변수(`.env`)로만 다루고 커밋하지 않는다. `NEXT_PUBLIC_` 접두사를 붙이지 않는다.
- 웹캠 영상과 프레임은 브라우저 밖으로 보내지 않는다. same-origin `/api/judge`로 보내는 것은 로컬 표정 모델이 계산한 확률(숫자)뿐이다.
- `pnpm bench` 결과(`bench/results/`)에는 데이터셋 입력 텍스트를 커밋하지 않는다. id, 예측, 확률, 토큰, 지연만 남긴다.

## 코드 스타일
- 산출물(주석, 커밋 메시지, 문서)은 한국어로 쓴다. 식별자(변수, 함수, 타입명)만 영어.
- TypeScript strict. `any`, `@ts-ignore`, 근거 없는 타입 단언 금지. 타입 전용 import는 `import type`.
- 외부 데이터(TypeSafe/Claude SDK 응답, API 요청 바디)는 경계에서 zod로 검증해 좁힌다. 단언으로 우회하지 않는다.
- import는 `app → features → lib` 방향만 허용한다(lib은 바깥을 모른다). 역방향 import와 화면 계층의 SDK/`lib/jev` import는 ESLint로 강제한다.
- `lib/judge`는 SDK 비의존(클라이언트 번들 가능), SDK에 의존하는 코드는 `lib/jev`에 둔다.
- 데모 질문 정의는 `lib/jev/questions.ts` 한 곳에 두고 데모 라우트가 쓴다. 벤치의 demo-smoke는 `JUDGE_QUESTIONS`를 import해 재export만 한다. 공개 벤치마크 질문 정의는 `bench/tasks.ts` 한 곳에 두고 모든 모델이 같은 정의를 쓴다. 임계값과 판정 규칙은 `lib/judge/policy.ts`에 모은다.
- `bench`는 `lib`만 import할 수 있고 features/app에 의존하지 않는다(ESLint 강제).
- Jev는 판정(분류, 선택)만 한다. 계산, 집계, 문구 생성은 코드 몫이다. 반응 문구도 미리 써 두고 Jev는 Choice로 고르기만 한다.

## 작업 원칙
- YAGNI: 지금 요구되지 않는 추상화, 설정을 미리 만들지 않는다.
- Tidy First: 구조 변경과 동작 변경을 같은 커밋에 섞지 않는다. 커밋 메시지는 `structural: ...` / `behavioral: ...` 접두사(설명은 한국어).

## 명령어
- `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck`
- `pnpm bench`: 공개 벤치마크로 Jev, Claude, OpenAI 비교. 실행 전에 호출 수와 비용을 미리 보여 주고 확인을 받으며(`--yes`로 생략), 결과는 `bench/results/<시각>/`. 옵션 `--models`/`--datasets`/`--limit`/`--reasoning off|default`/`--yes`/`--no-cache`로 대상, 표본, 추론 강도, 확인, 캐시를 조절한다.
- `pnpm bench:report`: 저장된 원본으로 요약과 차트를 API 호출 없이 재생성한다.
- `pnpm eval`: `pnpm bench --datasets demo-smoke` 별칭. 키가 있는 모든 기본 모델(OpenAI 포함)을 호출하므로 비용이 발생할 수 있다.

## 의도적으로 하지 않는 것
- 테스트 코드, TDD, vitest/e2e, CI. 타입체크, 린트, 빌드, `pnpm bench`로 대체한다.
- 배포(Vercel 등), 인증, 호출량 제한, 다국어(i18n) UI, 브랜드 디자인 시스템.
- 자해 신호 개입, 상담 안내 경로. 평가셋의 경계 사례는 가드레일 동작을 관찰하려고 넣었을 뿐이고 따로 대응하는 로직은 만들지 않는다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
