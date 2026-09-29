# Jev 테스트 프로젝트 리서치 (2026-09-28)

> deep-research 워크플로 결과. 소스 21개 fetch, 주장 102개 추출, 25개 3표 적대적 검증(23 확인 / 2 기각).

## 요약

Jev(jev-1.13)는 텍스트를 생성하지 않는다. 정해진 타입(Choice/Score/Noul)으로 빠르게 판정하고 판정마다 신뢰도(확률)를 함께 돌려주는 모델이다. 공식 jaggedness 문서는 약점도 인정한다. 세기·수치·날짜 비교를 못 하고 입력 state에 무관한 내용이 섞이면 정확도가 떨어진다. 그래서 테스트 프로젝트의 가치는 '생성'이나 '계산'보다 판정·게이트 쪽에서 크다. 벤더가 내세우는 70–500ms 지연, 보정된 확률, $0.042/Mtok 가격을 LLM-as-judge 베이스라인과 공정하게 비교해 검증하는 구성이다. 외부 논문들은 이 비교가 의미 있다는 근거를 준다. LLM 판정기의 자기보고 신뢰도는 과신 경향이 강하다(JudgeBench 기준 GPT-4o ECE 39.25% 등). 캐스케이드와 라우팅의 성패는 게이트 판정기의 정확도에 달려 있다(RouterBench 기준 오류율 0.1 이하에서 크게 이기고 0.2를 넘으면 급격히 나빠진다). 반면 최신 모델은 verbalized confidence를 쓰면 보정이 꽤 좋아졌다. 보정 결과는 프롬프트 맥락에 따라 달라진다는 점도 확인됐다. 추천은 두 가지다. (1) 공개 데이터셋 위에서 'Jev vs LLM-judge 보정·지연·비용' 벤치마크 하니스를 만들고, (2) RouterBench 사전계산 데이터로 Jev를 신뢰도 게이트 캐스케이드 판정기로 오프라인 평가한다. 두 번째 실험에서 입력 토큰 비용은 수 달러 수준으로 추정된다.

## 검증된 발견

### 1. (high, vote 3-0 (4개 주장 병합))

[한계, 공식] jev-1.13은 텍스트 생성용으로 학습되지 않았다. 세기(문자 수, 등장 횟수, 긴 목록 항목 수)를 못 하고 수치 표현(RGB/hex 근접도 등)에 약하다. 날짜는 순서 있는 양이 아닌 텍스트로 읽기 때문에 날짜 선후·간격·구간 포함 판단이 불안정하다. 공식 권장은 수학·세기·날짜 비교를 코드로 하고 Jev는 추출(날짜 구성요소를 열거형 Choice로)과 의미 판단에만 쓰는 것이다. 계산형·생성형 과제는 쇼케이스 후보에서 빼고 필요하면 '알려진 약점 재현' 대조군으로만 둔다.

- 근거: 공식 jaggedness 문서(2026-09-17 검토) 인용: "jev-1.13 does not count reliably", "reads dates as text, not as ordered quantities", "not trained to generate text", "Jev is not a calculator". 세 항목 모두 3-0 검증을 통과했다. 문서는 date extraction cookbook도 안내한다.
- 출처: https://docs.typesafe.ai/model-jaggedness/jev-1.13

### 2. (high, vote 3-0)

[한계, 공식] state에 결정과 무관한 내용이 늘수록 정확도가 떨어진다(context rot). 권장 방식은 코드에서 먼저 검색·필터링한 뒤 필요한 필드만 보내거나, Noul primitive로 관련성 필터링을 하는 것이다(classifying-RAG-passages cookbook). 다만 하락 폭이 수치로 공개되지 않아서 distractor 양을 단계적으로 늘리며 정확도·보정 곡선을 재는 실험 자체가 독립적인 기여가 된다.

- 근거: 인용: "Accuracy falls as the state grows with content unrelated to the decision". 정량 수치는 없다.
- 출처: https://docs.typesafe.ai/model-jaggedness/jev-1.13

### 3. (medium, vote 3-0 (3개 주장 병합))

[벤더 주장, 검증 대상] 가격은 입력 $0.042/Mtok이고 출력은 무료다. 출력은 타입이 고정된 구조값이라 스키마 위반이 0%이고 모든 출력에 보정된 확률이 붙는다. 종단 지연은 70–500ms로, 동급 지능의 프런티어 LLM 대비 40–200배 빠르다고 한다. 모두 벤더 자체 발표라 독립 재현이 없다.

- 근거: 블로그 인용: "$0.042 / MTok ... Output tokens: FREE", "End-to-end response time is 70ms-500ms ... 40x-200x faster", "Always communicates confidence and uncertainty with every output". 벤더가 직접 밝힌 단서도 여럿이다. 0%는 '경험적 수치가 아니라 스키마 매칭 보장'에 따른 값이고 평가는 '서부 해안 노트북에서' 돌렸다. 가격 지속성은 증명할 수 없다고 인정했다. 속도 우위는 System One 형태 쿼리에 한정된다. jaggedness 문서는 Score 수준의 수치 보정이 약하고 Noul과 그 부정의 합이 1이 되지 않는다고도 밝힌다. 외부 서술에서는 벤더 4-workflow 벤치에서 정확도가 중위권 프런티어 수준으로 언급된다(검증 미완).
- 출처: https://typesafe.ai/blog/introducing-system-one-models-and-jev

### 4. (medium, vote 2-1, 3-0, 3-0)

[베이스라인 근거] LLM-as-judge의 자기보고 신뢰도는 대체로 과신 경향이 있다. JudgeBench Self-Confidence 설정의 ECE는 GPT-4o 39.25%, GPT-4.1-nano 57.03%, Mistral-Nemo 74.22%다. 다만 추론 모델은 약 12%(DeepSeek-R1 12.07%, Qwen3-235B 11.78%)로 훨씬 낫다. ConfidenceBench에서도 15개 모델 중 5개가 보정된 무작위 기준(Brier 0.1875)보다 나빴다. Jev의 '보정됨' 주장을 검증하려면 약한 모델 외에 최신·추론 모델 베이스라인과도 비교해야 공정하다.

- 근거: 2508.06225 Table 1(ECE 수치)과 초록의 'Overconfidence Phenomenon' 표현. 2607.20526 인용: "Five of fifteen models perform worse than the calibrated-random baseline of 0.1875". 최신 모델(Opus 4.6, Gemini 3.1 Pro, GPT-5)은 기준보다 좋았다. 두 논문 모두 동료심사 전 프리프린트이고 2508.06225는 2025년 모델을 다룬다.
- 출처: https://arxiv.org/pdf/2508.06225, https://arxiv.org/html/2607.20526

### 5. (medium, vote 3-0, 3-0, 3-0 (3개 주장 병합))

[베이스라인 선택] 어떤 신뢰도 신호를 베이스라인으로 쓰느냐가 결과를 좌우한다. 교육 채점 과제(7개 모델, 4B–120B)에서는 verbalized 신뢰도가 가장 잘 보정됐다(평균 ECE 0.166, self-consistency 0.229, 토큰 확률 0.235). post-2025 독점 모델에서는 logprob보다 verbalized confidence가 더 나은 soft-score 신호였다(18개 LLM, SummEval/AggreFact/HelpSteer2). '과신 경고문(overconfidence advisory)'을 추가하면 AECE가 개선됐다(예: Sonnet 4.5/AggreFact에서 8.9%→3.8%). LLM 베이스라인은 최소 세 가지로 둔다. verbalized, verbalized+advisory, 가능하면 logprob 또는 사후 보정(Platt/isotonic)을 적용한 버전이다.

- 근거: 2603.29559 인용: 'Self-reported confidence: average ECE 0.166 ... Self-consistency 0.229 ... Token probability 0.235'. 2609.10996 인용: 'the standard advice to prefer log-probabilities no longer holds on post-2025 models'. 보정 이득의 대부분은 advisory에서 나오고 self-debate는 주로 분포 폭(spread)을 넓혔다. 둘 다 단일 프리프린트이고 2609.10996은 2026-09-10에 제출된 단독 저자 논문이다.
- 출처: https://arxiv.org/html/2603.29559, https://arxiv.org/pdf/2609.10996

### 6. (medium, vote 3-0, 3-0 (2개 주장 병합))

[실험 설계 원칙] 보정은 측정 프로토콜과 맥락에 민감하다. 토큰 점수를 매기는 맥락만 바꿔도 12개 설정 중 ECE 승자가 4개에서, AUROC 승자가 9개에서 뒤집혔다(짝지은 ECE 격차 평균 0.254 이동). 원래 맥락에서 적합한 보정 매핑을 다른 맥락으로 옮기면, 그 맥락에서 새로 적합한 것보다 나빴다(prompted-origin 기준 12/12). 그래서 Jev든 LLM이든 게이트 임계값은 실제 배포 프롬프트와 과제에서 hold-out으로 다시 정해야 하고 벤더 보정 주장도 과제별로 따로 확인해야 한다.

- 근거: SNU Kim & Kang 논문. 인용: 'changed the ECE winner in 4/12 settings and AUROC winner in 9/12', 'importing the source-context mapping is worse than fitting in the target context'. bare-origin에서는 페널티가 작고 10–12/12다. Jev에 적용하는 것은 외삽이다.
- 출처: https://arxiv.org/html/2605.27752

### 7. (medium, vote 3-0, 3-0, 3-0, 2-1 (4개 주장 병합))

[라우팅·캐스케이드 근거] 모델 선택 전략의 효과는 품질 추정기(게이트)의 정확도에 달려 있다. 라우팅에는 사전(ex-ante) 추정이, 캐스케이드에는 사후(post-hoc) 추정이 핵심이다. RouterBench 시뮬레이션에서 캐스케이드 라우터는 판정 오류율이 0.1 이하이면 개별 모델과 Zero router를 크게 이겼고 0.2를 넘으면 급격히 나빠졌다. 잘 보정된 신뢰도가 있으면 selective 파이프라인을 만들 수 있다. 높은 신뢰도는 자동 승인하고 낮은 신뢰도는 사람 검토로 넘기는 방식이다. 다만 LLM 채점기 사례에서는 5% 위험 목표일 때 자동 처리 가능 비율이 최상 실행 기준 약 11–20%에 그쳤다. Jev를 게이트로 쓴다면 핵심 KPI는 판정 오류율 ≤0.1 달성 여부와 risk-coverage 곡선이다.

- 근거: 2410.10347(ETH) 인용: 'reliable ex-ante quality estimation ... is essential ... robust post-hoc quality estimation ... is critical'. RouterBench의 오류율은 합성 이진 뒤집기(epsilon)로 모델링한 값이고 보정 품질 자체를 시험한 것은 아니다. 11–20%는 교육 채점 도메인의 상한치다. Jev에 적용하는 것은 모두 추론이다.
- 출처: https://arxiv.org/pdf/2410.10347, https://arxiv.org/abs/2403.12031, https://arxiv.org/pdf/2508.06225, https://arxiv.org/html/2603.29559

### 8. (high, vote 3-0)

[재사용 데이터셋] RouterBench(github.com/withmartian/routerbench, Hugging Face 배포)는 11개 LLM, 8개 데이터셋(64개 태스크)에 대한 사전계산 추론 결과 405,467건과 별도 RAG split(800 쿼리)을 공개한다. 쿼리별 정답 여부와 비용이 들어 있어서 LLM을 다시 호출하지 않고 Jev만 호출해 게이트·라우터를 오프라인으로 평가할 수 있다. 가장 싸고 재현 가능한 캐스케이드 실험 기반이다. 단, 모델 풀이 2024년 초(GPT-4, Claude-v2 시대) 것이라 절대 성능 수치는 오래됐다.

- 근거: 인용: 'over 405k inference outcomes from representative LLMs'. 본문에 405,467 샘플, 11개 모델, 8개 데이터셋, 64개 태스크로 적혀 있고 'training and testing of model routers without inference'라고 설명한다.
- 출처: https://arxiv.org/abs/2403.12031, https://github.com/withmartian/routerbench

### 9. (medium, vote 3-0, 3-0 (2개 주장 병합))

[가드레일 벤치마크 주의] Lakera PINT는 프롬프트 인젝션 탐지 벤치마크다. 4,314개 입력(영어 3,016, 비영어 1,298, 한국어 포함)으로 구성되며 비율은 인젝션 5.2%, 탈옥 0.9%, 인젝션처럼 보이는 정상 입력 20.9%, 채팅 36.5%, 공개 문서 36.5%다. 전체 데이터는 공개와 독점이 섞여 있어 배포되지 않고 저장소도 archived 상태다(마지막 push 2026-04-16). 공식 PINT 점수는 재현할 수 없다. 저장소의 'Using your own dataset' 하니스에 공개 인젝션 데이터셋을 넣어 Jev Choice/Noul 탐지기를 평가하는 방식이 현실적이다. 정상 입력 가운데 인젝션처럼 보이는 문장의 비중이 20.9%로 높다는 점은 과탐지(오탐) 평가를 설계할 때 참고할 만하다.

- 근거: README 31–42행(구성 비율), 32·108행(public+proprietary 혼합), example-dataset.yaml만 배포, GitHub API 기준 archived: true. 표에서 벤더인 Lakera Guard가 1위(95.22%)라는 이해상충이 있다.
- 출처: https://github.com/lakeraai/pint-benchmark

### 10. (low, vote 3-0)

[보조 근거, 낮음] 여러 LLM 판정기를 모두 모아 보정하는 편이, 상위 5개만 골라 쓰는 것보다 RewardBench2 NLL이 약 절반이었다(0.006 vs 0.013, 'Calibrate, Don't Curate'). 따라서 Jev를 여러 판정 신호 가운데 하나로 넣고 전체를 보정하는 앙상블 실험도 선택지가 된다. 단일 저자 프리프린트이고 NLL은 순수한 보정 지표가 아니다.

- 근거: 초록 인용: 'full judge panel achieved negative log-likelihood of 0.006 compared to 0.013 with top-5 judge selection'.
- 출처: https://arxiv.org/abs/2605.09702

### 11. (medium, vote synthesis)

[테스트 프로젝트 후보 7개, 위 근거를 종합한 추론] 비용은 Jev 입력 $0.042/Mtok 기준 추정치이고 LLM 베이스라인 비용은 별도다. 각 후보는 '과제 / 데이터셋 / 핵심 지표 / 난이도 / 예상 비용' 순으로 적는다. (A) 보정·지연·비용 벤치 하니스: Jev Choice/Score 대 LLM-judge(verbalized, +advisory, 사후 보정) / SummEval·AggreFact·HelpSteer2·JudgeBench / 정확도·ECE·AECE·Brier·신뢰도 다이어그램·p50/p95 지연·건당 비용 / 중 / 약 1만 건×500tok=5M tok≈$0.2. (B) RouterBench 오프라인 캐스케이드 게이트: Jev가 약한 모델 답의 정답 여부를 사후 판정하고 강한 모델로 승격할지 결정 / RouterBench / 비용-품질 곡선·AIQ·판정 오류율(≤0.1 목표)·risk-coverage / 중 / 약 40만 건×300tok=120M≈$5, 표본 추출 시 $1 미만. (C) 선택적 자동화(사람에게 넘기기) 게이트: 5%·10% 위험 목표에서 Coverage@Risk 측정 / SciEntsBank·Beetle 등 채점 데이터 / Coverage@5%Risk를 LLM 기준 11–20%와 비교 / 하~중 / $1 미만. (D) RAG 패시지 관련성 필터(Noul, 공식 cookbook 기반): 필터 전후 다운스트림 QA 정확도와 입력 토큰 절감 비교 / BEIR·MS MARCO 류 / nDCG@k·MRR·최종 정답률 / 중 / 쿼리 1천×후보 20×300tok=6M≈$0.25. (E) 프롬프트 인젝션 가드레일: PINT 하니스와 공개 인젝션 데이터셋, 자체 제작 '인젝션처럼 보이는 정상 입력' 셋(한국어 포함) / PINT식 balanced accuracy·FPR / 중 / $1 미만. (F) jaggedness 재현·경계 측정(대조 실험): distractor 양에 따른 정확도·보정 하락 곡선, 날짜는 원문 그대로 판단할 때와 날짜 구성요소 Choice 추출 후 코드로 비교할 때를 대비, 세기 과제 실패 재현 / 합성 데이터 / 하 / 최소 비용. (G) 다중 판정기 보정 앙상블: Jev와 여러 LLM 판정 신호를 로지스틱 또는 isotonic으로 결합 / RewardBench2 / NLL·ECE / 중상.

- 근거: 후보 구성은 검증된 주장들을 종합해 추론한 것이다. 토큰 수와 데이터셋 규모는 대략적인 가정이다. BEIR·MS MARCO·SciEntsBank 접근성과 cookbook 세부 내용은 이번 검증 범위 밖이다.
- 출처: https://docs.typesafe.ai/model-jaggedness/jev-1.13, https://typesafe.ai/blog/introducing-system-one-models-and-jev, https://arxiv.org/abs/2403.12031, https://arxiv.org/html/2603.29559, https://arxiv.org/pdf/2609.10996, https://github.com/lakeraai/pint-benchmark, https://arxiv.org/abs/2605.09702

### 12. (medium, vote synthesis)

[추천과 단계별 실험 설계, 추론] 추천 1은 (A)와 (F)를 하나로 묶은 'Jev 보정·지연 벤치 하니스'다. 추천 2는 그 하니스를 재사용하는 (B) 'RouterBench 오프라인 캐스케이드 게이트'다. 단계: ① 과제를 Choice(이진/다중)와 Score로 정의하고 state를 최소화한다(jaggedness 대응). ② 데이터를 calibration split과 test split으로 나눈다(맥락별로 다시 보정하기 위해). ③ Jev와 LLM 베이스라인 3종(verbalized, verbalized+advisory, Platt/isotonic 사후 보정)을 같은 입력으로 실행하고 지연·토큰·비용을 기록한다. ④ 지표로 정확도·ECE/AECE·Brier·AUROC·신뢰도 다이어그램·p50/p95 지연을 계산하고 부트스트랩 신뢰구간을 붙인다. ⑤ 게이트 임계값을 hold-out에서 적합한 뒤 risk-coverage와 비용-품질 곡선을 그린다(오류율 0.1 기준선 표시). ⑥ distractor를 주입하고 날짜·수치 대조 실험을 해서 실패 경계를 문서화한다. 스택은 Python을 권장한다. 평가·통계에 numpy/pandas/scikit-learn(calibration_curve, isotonic), 데이터 로딩에 HF datasets를 쓰고 공식 Python SDK 또는 POST /v1/systemone을 직접 httpx로 호출한다. JS SDK는 이후 데모 UI 용도로만 쓴다.

- 근거: 설계 원칙은 검증된 주장에서 왔다. 과제별 재보정은 2605.27752, 오류율 0.1 기준은 2403.12031, 과신 경고 베이스라인은 2609.10996, state 최소화는 jaggedness 문서가 근거다. 공식 SDK의 패키지명과 API 형태는 이번 검증에서 확인하지 못했다.
- 출처: https://arxiv.org/html/2605.27752, https://arxiv.org/abs/2403.12031, https://arxiv.org/pdf/2410.10347, https://arxiv.org/pdf/2609.10996, https://docs.typesafe.ai/model-jaggedness/jev-1.13

## 주의사항

- Jev 성능 주장(보정됨, 40–200배 속도, 환각 0%, 가격)은 모두 벤더 자료가 단일 출처이고 독립적으로 재현된 적이 없다. '0%'는 스키마 적합성에만 해당하며 틀린 선택지를 높은 확률로 고를 수는 있다. 공식 문서도 Score의 수치 보정이 약하고 Noul과 그 부정의 합이 1이 되지 않는다고 인정한다.
- 가격은 2026년 9월 발표된 조기 접근(early-access) 가격이고 벤더 스스로 보조금 여부를 증명할 수 없다고 했다. docs.typesafe.ai/pricing과 OpenRouter 페이지는 404였다. 블로그 날짜가 검증 과정에서 9/15와 9/27로 엇갈려 기록됐다.
- 외부 논문 대부분(2508.06225, 2603.29559, 2605.27752, 2605.09702, 2607.20526, 2609.10996)은 동료심사 전 프리프린트다. 2609.10996은 제출된 지 18일 된 단독 저자 논문이다. 그중 어느 것도 Jev를 직접 평가하지 않아서 Jev에 적용하는 것은 모두 외삽이다.
- RouterBench의 모델 풀은 2024년 초 것이고 오류율 결과는 합성 뒤집기 시뮬레이션이다. PINT는 archived 상태이고 전체 데이터가 비공개다.
- 기각된 주장 두 가지는 근거로 쓰지 않았다. LLM 채점기 신뢰도의 상단 쏠림(86%가 0.8 초과)을 라우팅 한계로 해석한 주장, 그리고 Brier 0.103을 비교 기준으로 쓰자는 주장이다.
- 공식 cookbooks·patterns·use-case map의 구체적 내용, github.com/typesafe-ai의 SDK 형태, 커뮤니티 실사용 사례는 이번에 검증된 주장에 포함되지 않았다. 후보 7개의 비용과 규모는 대략적인 추정이다.

## 미해결 질문

- 공식 Python/JS SDK의 패키지명, 배치 호출 지원, 레이트 리밋은 어떤가? 조기 접근(waitlist) 상태에서 개인 프로젝트가 대량 호출(수백만 토큰)을 할 수 있는가?
- Jev가 반환하는 확률은 Choice 옵션 표현(순서, 문구)이나 state 구성에 따라 얼마나 흔들리는가? 즉 2605.27752가 보인 프로토콜 민감도가 Jev에도 나타나는가?
- 공식 cookbooks, use-case map, 커뮤니티 사례 가운데 벤더가 가장 강하다고 보는 과제 유형은 무엇이고 그 과제에 공개 평가셋이 있는가?
- 한국어 입력에서 Jev의 정확도와 보정 수준은 영어와 같은가? 공식 jaggedness 문서에 언어별 한계 항목이 있는가?

## 기각된 주장

- (1-2) LLM grader confidence is heavily top-skewed: 86% of predictions exceed 0.8 confidence and only 0.62% fall below 0.2, which limits the usefulness of confidence for deferral/routing. — https://arxiv.org/html/2603.29559
- (0-3) On a 200-question private multiple-choice benchmark, the best-calibrated frontier LLMs by verbalized confidence (Claude Opus 4.6 and Gemini 3.1 Pro Preview) reached a Brier score of 0.103. That gives a concrete baseline for comparing calibrated classifiers such as Jev against LLM-as-judge confidence. — https://arxiv.org/html/2607.20526

## 소스

- [primary] https://docs.typesafe.ai/model-jaggedness/jev-1.13
- [secondary] https://systemonemodels.org/examples/cookbooks/
- [blog] https://github.com/walidboulanouar/awesome-jev-use-cases
- [primary] https://typesafe.ai/blog/introducing-system-one-models-and-jev
- [secondary] https://github.com/AbdelStark/awesome-typesafe-jev
- [secondary] https://www.marktechpost.com/2026/09/19/typesafe-ai-releases-jev/
- [primary] https://arxiv.org/pdf/2508.06225
- [primary] https://arxiv.org/html/2603.29559
- [primary] https://arxiv.org/html/2605.27752
- [primary] https://arxiv.org/html/2607.20526
- [primary] https://arxiv.org/abs/2605.09702
- [primary] https://arxiv.org/pdf/2609.10996
- [primary] https://arxiv.org/abs/2403.12031
- [primary] https://arxiv.org/pdf/2410.10347
- [primary] https://github.com/lakeraai/pint-benchmark
- [primary] https://arxiv.org/abs/2410.22770
- [primary] https://arxiv.org/pdf/2410.13284
- [primary] https://aclanthology.org/2025.findings-emnlp.305.pdf
- [blog] https://benchlm.ai/blog/posts/what-is-jev
- [blog] https://langfuse.com/blog/2026-09-18-using-typesafes-jev-for-evals
- [blog] https://gist.github.com/pjburnhill/adf8d28efcad9df037bfdece178ef965

## 보충 (메인 세션에서 공식 문서 직접 확인, 2026-09-28)

- SDK: 공식 Python SDK(`TypeSafeClient`/`AsyncTypeSafeClient`, `TYPESAFE_API_KEY` 환경변수, 기본 모델 `jev-latest`)와 JavaScript SDK(`TypeSafeClient`)가 docs.typesafe.ai/sdk에 있음. SDK는 429 시 backoff 재시도 기본 제공.
- 가격·한도는 /pricing이 아니라 docs.typesafe.ai/models.md에 있음: $0.042/Mtok 입력, 출력 무료, 250k tok/s · 1,200 req/min(동적 변경 가능), 64k 컨텍스트(state+최장 질문 32k).
- 공식 cookbook 중 후보와 직결: rerank_typesafe(CLERC 법률 재랭킹, top-1 5%→18%), llm_guardrails, classifying_rag_passages, citation_check, sde_cascade, parallel_questions(한 요청 배치 시 12.2x 저렴·10x 빠름), consistency_noul/choice(불확실 → 사람 검토).
