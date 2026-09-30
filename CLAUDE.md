# jev-test

TypeSafe의 System One 모델 **Jev**를 시험하는 프로젝트다. 웹캠 표정(브라우저 로컬 추론)과 한국어 한마디를 Jev로 판정해 기분, 가드레일, 불일치, 맞춤 반응을 보여 주는 데모가 있다. 공개 벤치마크(`pnpm bench`)로는 Jev를 Claude, OpenAI 모델과 비교한다.

## 시작하기
- Node 24(`.nvmrc`)와 pnpm을 준비한다.
- `cp .env.example .env` 후 `TYPESAFE_API_KEY`를 입력한다. `ANTHROPIC_API_KEY`와 `OPENAI_API_KEY`는 `pnpm bench`의 비교 모델에만, `HF_TOKEN`은 옵션 데이터셋 WildGuardMix에만 필요하다.
- `pnpm install && pnpm dev`로 실행한 뒤 http://127.0.0.1:3000 에서 연다.

## 문서와 SDK
- 이 프로젝트에서 작업할 때는 항상 `typesafe:typesafe-ai` 스킬을 사용한다.
- TypeSafe API와 SDK 사용법은 기억에 의존하지 말고 라이브 문서(https://docs.typesafe.ai/llms.txt)를 먼저 확인한다. `@typesafe-ai/sdk`는 `0.6.0`에 고정하고 임의 업그레이드는 금지한다.
- Jev는 영어가 1차 학습 언어라 한국어(CJK) 입력은 정확도가 낮을 수 있다(docs.typesafe.ai/concepts/state.md). 지시는 영어로 쓰고 한국어는 예문으로 둔다.
- Next.js 코드를 쓰기 전에 로컬 `node_modules/next/dist/docs/`와 공식 문서에서 최신 API를 확인한다(현재 next@16.3.6).

## 보안
- API 키(`TYPESAFE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `HF_TOKEN`)는 서버 쪽 환경변수(`.env`)로만 다루고 커밋하지 않는다. `NEXT_PUBLIC_` 접두사를 붙이지 않는다.
- 웹캠 영상과 프레임은 브라우저 밖으로 보내지 않는다. same-origin `/api/judge`로 보내는 것은 로컬 표정 모델이 계산한 확률 숫자뿐이다.
- `pnpm bench` 결과(`bench/results/`)에는 데이터셋 입력 텍스트를 커밋하지 않는다. id, 예측, 확률, 토큰, 지연만 남긴다.

## 코드 스타일
- 주석, 커밋 메시지, 문서 같은 산출물은 한국어로 쓴다. 변수, 함수, 타입명 같은 식별자만 영어로 쓴다.
- TypeScript는 strict 모드로 쓴다. `any`, `@ts-ignore`, 근거 없는 타입 단언은 금지한다. 타입 전용 import는 `import type`으로 쓴다.
- TypeSafe와 Claude SDK 응답, API 요청 바디 같은 외부 데이터는 경계에서 zod로 검증해 좁힌다. 단언으로 우회하지 않는다.
- import는 `app → features → lib` 방향만 허용한다. lib은 바깥을 모른다. 역방향 import와 화면 계층의 SDK와 `lib/jev` import는 ESLint로 강제한다.
- `lib/judge`는 SDK에 의존하지 않아 클라이언트 번들에 넣을 수 있다. SDK에 의존하는 코드는 `lib/jev`에 둔다.
- 데모 질문 정의는 `lib/jev/questions.ts` 한 곳에 두고 데모 라우트가 쓴다. 벤치의 demo-smoke는 `JUDGE_QUESTIONS`를 import해 재export만 한다. 공개 벤치마크 질문 정의는 `bench/tasks.ts` 한 곳에서 관리하며 모든 모델이 같은 정의를 쓴다. 임계값과 판정 규칙은 `lib/judge/policy.ts`에 모은다.
- `bench`는 `lib`만 import할 수 있고 features나 app에는 의존하지 않는다. 이 규칙도 ESLint로 강제한다.
- Jev는 분류와 선택 같은 판정만 한다. 계산, 집계, 문구 생성은 코드 몫이다. 반응 문구도 미리 써 두고 Jev는 Choice로 고르기만 한다.

## 작업 원칙
- YAGNI: 지금 요구되지 않는 추상화와 설정을 미리 만들지 않는다.
- Tidy First: 구조 변경과 동작 변경을 같은 커밋에 섞지 않는다. 커밋 메시지에는 `structural: ...` 또는 `behavioral: ...` 접두사를 붙이고 설명은 한국어로 쓴다.

## 명령어
- `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm typecheck`
- `pnpm bench`: 공개 벤치마크로 Jev를 Claude, OpenAI 모델과 비교한다. 실행 전에 호출 수와 비용을 미리 보여 주고 확인을 받는다. 확인은 `--yes`로 생략할 수 있다. 결과는 `bench/results/<시각>/`에 저장한다. `--models`와 `--datasets`로 대상을, `--limit`으로 표본을, `--reasoning off|default`로 추론 강도를, `--no-cache`로 캐시를 조절한다.
- `pnpm bench:report`: 저장된 원본으로 요약과 차트를 API 호출 없이 재생성한다.
- `pnpm eval`: `pnpm bench --datasets demo-smoke`의 별칭이다. 키가 있는 모든 기본 모델을 OpenAI까지 포함해 호출하므로 비용이 발생할 수 있다.

## 의도적으로 하지 않는 것
- 테스트 코드, TDD, vitest와 e2e, CI는 만들지 않는다. 타입체크, 린트, 빌드, `pnpm bench`로 대체한다.
- 배포(Vercel 등), 인증, 호출량 제한, 다국어(i18n) UI, 브랜드 디자인 시스템은 다루지 않는다.
- 자해 신호 개입과 상담 안내 경로는 두지 않는다. 평가셋의 경계 사례는 가드레일 동작을 관찰하려고 넣었을 뿐이고 따로 대응하는 로직은 만들지 않는다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
