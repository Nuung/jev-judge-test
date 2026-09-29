# Jev 벤치마크 리서치 (2026-09-29)

deep-research 워크플로(소스 26개, 주장 129개 추출, 25개 3표 검증 → 21 확인·4 기각)와 보강 조사 3건(TypeSafe 공식·제3자 평가, OpenAI·Anthropic 모델, 벤치 도구·한국어 데이터)을 합친 결과다. 코드와 저장소는 건드리지 않았다.

## 1. Jev는 어디서 유리한가: 근거 강도별

### 공식 자기 서술 (근거 약함)
| 주장 | 수치 | 조건과 한계 | 출처 |
|---|---|---|---|
| 속도·비용 | LLM 대비 193.6배 빠르고 444.6배 저렴 | 사내 workflow eval 4종. 정답이 사람 라벨이 아니라 GPT-6 Astra·Fable 5.1 응답의 합의. 코드 비공개. 블로그 스스로 "higher end of real world gains"라고 씀 | typesafe.ai/blog/introducing-system-one-models-and-jev |
| 정확도(참조 모델 일치율) | Jev 67.8%, Sol 74.1%, Opus 5 73.1%, Terra 67.9%, Luna 66.8% | 과제별 Jev: Security 61.7, Agent Trace 71.6, Invoice 61.8, Customer Service 76.0. 사례 수 미기재 | evals.typesafe.ai |
| 지연 | 70–500ms | 미 서부 사내 노트북 측정 | 블로그 |
| 환각 0% | — | 실측이 아니라 스키마 일치 보장. "Our number is not empirical" | 블로그 |
| 보정 | 수치 없음 | RLCD 학습 설명뿐. "does not guarantee that an individual answer is correct" | docs.typesafe.ai/concepts/system-one.md |

TypeSafe는 "We deliberately chose *not* to publish performance against *public* benchmarks"라고 밝혔다.

### Cookbook 실측 (근거 중간)
공식 cookbook 16개 중 14개는 **jev-1.12**로 쟀고, jev-1.13은 일관성 실험 2개뿐이다. 표본이 작고(40–488건) 비교 대상이 BM25나 Jev 자신인 경우가 많다.
- 질문 13개를 한 번에 묶으면 따로 보낼 때보다 12.2배 싸고 10.0배 빠름(순차 호출 합산 기준, 동시 호출이면 격차가 줄어든다고 명시).
- 법률 재랭킹(CLERC 40쿼리): top-1 5%→18%, top-10 38%→62%. 비교는 BM25뿐.
- 산업 분류(SEC 60건): confidence 0.9 이상 30건은 27/30, 나머지는 12/30.
- 일관성(1.13, 문서 1건 15회): Noul 111ms·$0.000043, Haiku·gpt-5.4-mini보다 10–16배 빠르고 22–42배 쌈. Choice 같은 라벨 재현율 90.8%(LLM 87.5–100%), 문서가 "Haiku at temperature 0 varies less"라고 인정.

### 독립 재현 (근거 가장 강함, 코드 공개)
| 평가 | 과제 | 결과 |
|---|---|---|
| Aman Kumar, github.com/onlyoneaman/jev-eval | 공개 데이터 4종 × 300건 | Enron 스팸 98.7 / SST-2 95.7 / AG News 91.3 / Banking77 76.0. 비교 gpt-5.4-mini 97.7 / 92.7 / 88.3 / 78.7, gpt-5.6-luna 98.0 / 93.0 / 89.7 / 81.7. 비용 5–56배 저렴. confidence ≥0.9일 때 정확도 89.9–99.6%. 결론 "a filter, not a replacement" |
| anisselbd/jev-phishing-bench (1.13) | 피싱 이메일 2,000건 | Jev 62.6% vs Haiku 4.5 81.3%, AUROC 0.689 vs 0.837, **ECE 0.154 vs 0.097**. 비용 약 12배 저렴, p50 239ms vs 687ms |
| Rao & Callison-Burch, arXiv:2609.29769 | 판정 패널 9개 vs flash급 judge 3개 | 27개 비교 중 유의차 8개. binary 기준에서 Jev 우세, graded 기준에서 열세. LLM이 비용 29–325배, 시간 30–220배 |
| Zhang 외, arXiv:2609.27678 | ContractNLI | Jev가 비용·지연 최저, 정확도는 hosted LLM이 높음 |

이해관계가 있는 자료(Langfuse·BenchLM·MarkTechPost·Vercel 인용·eesel)는 자체 측정이 없거나 방법론이 불명확하다.

### 종합
- **유리:** 짧은 입력, 보기가 정해진 분류·필터·라우팅(스팸, 감성, 주제), 한 문서에 질문 여러 개, confidence로 확실한 것만 처리하고 나머지를 LLM에 넘기는 1차 필터, binary 판정. 비용·지연 우위는 10배에서 수백 배로 일관되게 재현됨.
- **불리:** 라벨이 많고 미세한 분류(Banking77), graded 척도, 도메인 판단이 필요한 판정(피싱), 긴 문서·무관한 문맥, 수치·날짜·다단계 추론, 생성, 적대적 입력(공식 문서도 인젝션 취약을 인정), 한국어 등 비영어.
- **보정:** 공식 수치 없음. 유일한 제3자 측정(피싱)에서 Jev ECE 0.154가 Haiku 0.097보다 나빴다. Score는 수치 보정이 약하고 Noul·Choice 간 확률 합이 맞지 않으므로 출력 모드별로 따로 재야 한다.

## 2. 추천 공개 벤치마크

| 영역 | 데이터셋 | 형식 | 라이선스·접근 | 추천 이유 |
|---|---|---|---|---|
| 분류(영어) | SST-2, AG News, Banking77, Enron 스팸 | Choice(2/4/77/2) | 공개, HF | 위 독립 재현과 **같은 데이터**라 공개 수치와 나란히 비교 가능. Jev가 유리한 과제와 불리한 과제(Banking77)가 섞여 있음 |
| 가드레일 판정 | JailbreakBench `judge_comparison` 300건 | Noul(유해 여부) | MIT, HF | 인간 레이블 + GPT-4 90.3%, Llama Guard 2 87.7% 등 공개 기준 수치(NeurIPS 2024) |
| 가드레일 프롬프트 | WildGuardMix test 1,725건 | Noul | ODC-BY, HF 로그인·약관 동의 필요 | 적대적 프롬프트 약 45%, ICLR 2025 보정 논문의 벤치 세트와 겹침 |
| 가드레일 실사용 | ToxicChat(toxicchat0124) | Noul | CC-BY-NC | 불균형(toxicity 7.33%)이라 F1·AUPRC 필수. 비상업만 |
| 한국어 Choice | KLUE-YNAT validation | Choice(7) | CC BY-SA 4.0, HF 자동 | 한국어 성능 확인(공식 문서가 CJK 저하를 인정) |
| 한국어 Noul | K-MHaS test(21,939건 중 층화 추출) | Noul(혐오 여부) | CC BY-SA 4.0, HF 자동 | 한국어 가드레일에 가장 가까운 공개 데이터 |
| 한국어 감정 | KOTE(43종+없음) | 다중 레이블 → 매핑 필요 | HF, 라이선스 확인 필요 | 기분 6종으로 접는 규칙이 필요. AI Hub 감성 대화 말뭉치는 대분류 6종이 맞지만 AI Hub 전용·승인 필요 |

공개된 **한국어 프롬프트 인젝션·탈옥 벤치마크는 찾지 못했다.** 영어 벤치를 기계 번역해 쓰면 신뢰도가 떨어진다는 근거가 있다(Deng 외 ICLR 2024 MultiJail은 원어민 수동 번역, KoBBQ는 단순 번역과 현지화의 측정치 차이를 보임).

## 3. 논문 수준 평가 프로토콜
- **비교 통계:** 같은 문항에 대한 두 모델의 정오를 짝지어 McNemar 검정과 paired bootstrap 신뢰구간으로 비교한다. 비용 때문에 부분 표본을 쓰면 검정력 분석으로 표본 크기를 정한다(arXiv:2411.00640).
- **보정 지표:** ECE(15 등간격 bin, Guo 외 2017)를 주 지표로, Brier와 reliability diagram, risk-coverage를 함께 보고한다. 기존 가드 모델의 최저 평균 ECE는 프롬프트 분류 14.4%(WildGuard), 응답 분류 11.4%(MD-Judge)이고 10% 초과면 나쁜 보정으로 본다(Liu 외 ICLR 2025).
- **확률 추출의 공정성:** Jev는 확률을 직접 준다. Claude Messages API에는 logprobs가 없어 스스로 말하는 확신도(verbalized)만 가능하다. OpenAI는 Chat Completions의 logprobs가 있지만 추론(reasoning)을 켜면 쓸 수 없다. 측정 프로토콜에 따라 logprobs와 verbalized 중 어느 쪽이 나은지가 뒤바뀐다는 보고가 있으므로(arXiv:2605.27752), 같은 데이터·같은 bin·같은 온도로 맞추고 확률 출처를 표에 명시한다.
- **재현성:** 모델 버전 고정, 요청별 원본 로그 저장, 3회 반복, 순차 호출로 지연 측정, 데이터셋 버전·분할·표본 시드 기록, 학습 데이터 오염 가능성 명시(JBB는 AdvBench·HarmBench 유래 문항 포함).

## 4. 비교 모델 후보 (2026-09 공식 문서)
| 제공자 | 모델 | 가격(입력/출력, 100만 토큰당) | 포지셔닝 | 확률 |
|---|---|---|---|---|
| TypeSafe | jev-1.13.0 | $0.042 / 무료 | System One 판정 | 직접 반환 |
| Anthropic | claude-haiku-4-5(-20251001) | $1 / $5 | 빠르고 싼 급 | verbalized만 |
| Anthropic | claude-sonnet-5 | $2 / $10 | 중간 급 | verbalized만 |
| OpenAI | gpt-6-luna | $0.10 / $0.50 | "most efficient model for focused, high-volume tasks" | 추론 끄면(`none`) logprobs 가능성, 공식 명시 없음 |
| OpenAI | gpt-6-sol | $2 / $10 | "complex coding and agentic workflows", 가격이 Sonnet 5와 동일 | 위와 같음 |

OpenAI는 Responses API를 권장하고 structured outputs는 `responses.parse` + `zodTextFormat`(npm `openai` 7.23.0)을 쓴다. 공식 문서에 OpenAI가 "Haiku급", "Sonnet급"이라고 비교한 문구는 없어서 위 매칭은 포지셔닝과 가격으로 추론한 것이다.

## 5. 누구나 돌리는 벤치 도구 설계 권고
Inspect AI, promptfoo, lm-evaluation-harness, HELM에서 가져올 패턴:
1. 모델은 `provider/model` 한 문자열로 고른다. 예: `pnpm bench --models jev,anthropic/claude-haiku-4-5,openai/gpt-6-luna`
2. 키가 없는 제공자는 실행 전에 알리고 건너뛴다(지금 Claude 처리 방식을 모든 제공자로 확장).
3. `--limit`(개수 또는 비율)과 `--datasets`로 범위를 줄이고, 실행 전에 예상 호출 수와 비용을 출력한다.
4. 요청 단위 디스크 캐시(제공자+모델+프롬프트+입력 해시)로 재실행 비용을 없앤다.
5. 요약 표와 별도로 요청별 원본 로그(JSON)를 남긴다(지금 eval의 .json 방식 확장).
6. 데이터셋은 HF에서 자동으로 받고 버전·분할·시드를 결과에 기록한다. gated(WildGuardMix)나 NC(ToxicChat)는 기본값에서 빼고 옵션으로 둔다.
7. 실행과 요약을 나눈다(`bench run` → `bench report`).

## 6. 제안하는 방향
- 기본 스위트: SST-2, AG News, Banking77, Enron 스팸(독립 재현과 비교), JBB judge_comparison(공개 기준 수치와 비교), KLUE-YNAT와 K-MHaS 층화 표본(한국어). 모두 자동 다운로드 가능한 라이선스.
- 옵션 스위트: WildGuardMix(HF 약관 동의), ToxicChat(비상업).
- 모델: 기본 jev + 키가 있는 제공자 자동 포함, `--models`로 선택.
- 지표: 정확도·F1과 paired 신뢰구간, ECE·Brier(확률 출처 표기), 지연 p50/p95, 호출당 비용.
- 기대치: 독립 재현을 보면 Jev는 정확도에서 flash급 LLM과 비슷하거나 낮고, 비용·지연에서 크게 앞선다. 벤치마크는 이 가설을 확인하는 설계여야 하며 Jev 우위를 전제하면 안 된다.

## 확인하지 못한 것
- evals.typesafe.ai의 사례 수와 원본 쿼리, TypeSafe 공식 1.13 보정 수치
- gpt-6-luna·sol에서 `reasoning_effort: "none"`일 때 logprobs 실제 지원 여부(호출해 봐야 함)
- KOTE·K-MHaS 외 일부 데이터셋 라이선스 세부, Good Start Labs 원문, Reddit 토론
