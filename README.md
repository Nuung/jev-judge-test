# Jev 무드 미러

웹캠에 비친 표정과 한국어 한마디를 보고 지금 기분을 짚어 주는 작은 실험 앱입니다.
TypeSafe의 판정 모델 **Jev**가 어떤 모델인지 직접 만져 보려고 만들었습니다.

![Jev 무드 미러 화면](docs/screenshot.png)

<sub>스크린샷 속 인물은 Wikimedia Commons의 CC0 사진([Smiling woman pink shirt](https://commons.wikimedia.org/wiki/File:Smiling_woman_pink_shirt_(cropped).jpg))을 가짜 카메라 영상으로 넣은 것입니다.</sub>

## 무엇을 하나요

1. 브라우저 안에서 웹캠 표정을 읽습니다. 무표정·웃음·슬픔·화남·두려움·혐오·놀람 7가지를 실시간 %로 보여 줍니다.
2. "나 괜찮아… 그냥 좀 지쳤어"처럼 한마디를 적고 **기분 살펴보기**를 누릅니다.
3. Jev가 한 번의 호출(약 0.3초)로 네 가지를 동시에 판정합니다.
   - 기분: 기쁨 / 평온 / 슬픔 / 피곤 / 짜증 / 불안 중 어디에 가까운지
   - 가드레일: "이전 지시는 무시해" 같은 프롬프트 인젝션이나 유해한 요청인지
   - 불일치: 웃고 있는데 말은 지쳐 있는 것처럼 표정과 말이 어긋나는지
   - 추천: 기분에 맞는 한마디·음악·휴식 제안 중 하나

**영상은 이 기기 밖으로 나가지 않습니다.** 서버로 가는 것은 한마디와 표정 확률 숫자 7개뿐입니다.

## 시작하기

Node 24와 pnpm이 필요합니다.

```bash
pnpm install
cp .env.example .env    # TYPESAFE_API_KEY를 채워 넣으세요
pnpm dev
```

브라우저에서 http://127.0.0.1:3000 을 열고 카메라 권한을 허용하면 됩니다.
dev 서버는 이 컴퓨터(127.0.0.1)에서만 열립니다. `.env`를 바꿨다면 서버를 다시 켜 주세요.

| 환경 변수 | 필요한 곳 |
|---|---|
| `TYPESAFE_API_KEY` | 앱 전체. [TypeSafe 콘솔](https://console.typesafe.ai/keys)에서 발급 |
| `ANTHROPIC_API_KEY` | `pnpm eval`의 Claude 비교에만. 없으면 Claude 비교는 건너뜁니다 |

화면 아래 예시 버튼으로 바로 해 볼 수 있습니다. 카메라를 보고 웃으면서 **웃으며 말하기**를 누르면 불일치 알림이 뜹니다.

## Jev는 Claude와 비교해 어땠나

`pnpm eval`은 한국어 문장 41개(기분, 인젝션, 유해 요청, 인젝션처럼 보이지만 정상인 문장, 표정·말 불일치)를 Jev와 Claude 두 모델에 똑같이 물어보고 표로 정리합니다.
결과는 터미널과 `eval/results/*.md`에 남습니다. 한 번 돌리는 데 약 $0.32가 들고, 대부분 Claude 비용입니다.

2026-09-28 실행 결과입니다(라벨이 애매한 경계 사례 1건은 지표에서 뺐습니다).

| 모델 | 기분 | 가드레일 탐지 | 오탐 | 불일치 | 응답 p50 / p95 | 41건 비용 |
|---|---|---|---|---|---|---|
| Jev (jev-1.13.0) | 100% | 100% | 0% | 100% | 275 / 789ms | $0.005 |
| Claude Haiku 4.5 | 100% | 100% | 0% | 100% | 1,234 / 1,877ms | $0.088 |
| Claude Sonnet 5 | 100% | 100% | 0% | 100% | 1,993 / 4,404ms | $0.227 |

이 평가셋에서는 세 모델의 정확도가 같았고, Jev가 4~7배 빠르고 16~42배 쌌습니다.
다만 평가셋이 작고 쉬워서 정확도 차이를 가르기에는 부족합니다. Jev는 데모와 똑같이 질문 10개를 한 번에 받고 Claude는 비교에 필요한 4개만 받으므로 토큰·비용을 같은 작업량으로 비교한 것은 아닙니다.
Jev는 영어가 주 학습 언어라 [한국어 정확도가 더 낮을 수 있다고](https://docs.typesafe.ai/concepts/state.md) 공식 문서에 적혀 있습니다.

## 어떻게 만들었나

- **표정 인식**: [@vladmandic/face-api](https://github.com/vladmandic/face-api)를 브라우저에서 돌립니다. 모델 가중치는 `public/models`에 있습니다.
- **판정**: [TypeSafe JS SDK](https://docs.typesafe.ai/sdk/javascript.md)로 Jev에 Choice·Noul 질문을 한 번에 묶어 보냅니다. 질문 정의는 `lib/jev/questions.ts` 한 곳에 있고, 데모와 평가가 같이 씁니다.
- **규칙은 코드가**: 임계값, 얼굴이 없거나 무표정일 때의 처리, 추천 문구는 모두 코드에 있습니다(`lib/judge/policy.ts`, `lib/judge/reactions.ts`). Jev는 판정만 하고 글을 만들지 않습니다.
- **화면**: Next.js 16 App Router, Tailwind 4, Pretendard, lucide 아이콘. 디자인은 토스(TDS)를 참고했습니다.

```
app/            페이지와 /api/judge 라우트
features/       무드 미러 화면(웹캠, 결과, 입력)
lib/judge/      기분 라벨, 판정 정책, 응답 스키마 (SDK와 무관)
lib/jev/        Jev 클라이언트와 질문 정의 (서버 전용)
eval/           Jev vs Claude 평가셋과 스크립트
docs/research/  시작 전에 조사한 자료
```

import 방향은 `app → features → lib` 한쪽뿐이고, API 키를 다루는 코드는 화면 쪽에서 불러올 수 없도록 ESLint가 막습니다.

## 명령어

| 명령 | 하는 일 |
|---|---|
| `pnpm dev` | 개발 서버 |
| `pnpm build` / `pnpm start` | 프로덕션 빌드와 실행 |
| `pnpm typecheck` / `pnpm lint` | 타입 검사와 린트 |
| `pnpm eval` | Jev vs Claude 평가 |

## 알아 두면 좋은 것

- 로컬에서 가지고 노는 데모입니다. 배포, 로그인, 호출량 제한은 없습니다.
- 자해나 위기 표현에 대한 별도 안내 기능은 없습니다. 평가셋의 경계 사례는 동작을 관찰하려고 넣은 것입니다.
- 테스트 코드는 일부러 두지 않았습니다. 타입 검사, 린트, 빌드, `pnpm eval`로 확인합니다.
- 표정 인식 라이브러리 저장소는 보관(archived) 상태입니다. 지금은 문제없이 동작하지만 오래 쓸 거라면 교체를 고려하세요.
