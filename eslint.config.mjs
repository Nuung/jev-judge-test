import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// SDK와 Jev 클라이언트(lib/jev) — 서버 라우트 핸들러와 bench만 쓴다
const SDK_PATTERN = {
  group: [
    "@typesafe-ai/sdk",
    "@typesafe-ai/sdk/**",
    "@anthropic-ai/sdk",
    "@anthropic-ai/sdk/**",
    "@/lib/jev",
    "@/lib/jev/**",
    "**/lib/jev/**",
    // lib/judge 기준 상대경로
    "../jev",
    "../jev/**",
  ],
  message: "SDK/Jev 클라이언트는 app/api 라우트 핸들러(와 bench)에서만 쓴다",
};

const APP_PATTERN = {
  group: ["@/app", "@/app/**", "**/app/**"],
  message: "features는 app에 의존할 수 없다 (의존 방향 app → features → lib)",
};

// lib(가장 안쪽)은 바깥 계층과 UI 프레임워크를 모른다
const LIB_PATTERNS = [
  {
    group: ["@/features", "@/features/**", "@/app", "@/app/**", "**/features/**", "**/app/**"],
    message: "lib은 features/app에 의존할 수 없다 (의존 방향 app → features → lib)",
  },
  {
    group: ["react", "react/**", "react-dom", "react-dom/**", "next", "next/**"],
    message: "lib은 React/Next에 의존할 수 없다 — 프레임워크 비의존 로직만 둔다",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".omc/**",
    ".claude/**",
    "bench/results/**",
    "bench/.cache/**",
  ]),
  {
    // 타입 안전 우회 금지 — app/features/lib/bench 전 계층
    files: ["app/**/*.{ts,tsx}", "features/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "bench/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // "never"여도 `as const`(const 단언)는 규칙상 항상 허용된다 — 그 외 `as T`/`<T>x` 단언만 금지
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  // ── 의존 방향: app → features → lib 만 허용 (lib은 바깥을 모른다) ──
  // 주의: no-restricted-imports는 설정 객체끼리 병합되지 않고 나중 것이 덮어쓴다.
  // 그래서 파일 집합이 겹치지 않도록 나누고, 각 블록에 해당 계층의 금지 패턴을 전부 적는다.
  {
    // 화면 계층(features): SDK·Jev 클라이언트와 app을 모른다
    files: ["features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [SDK_PATTERN, APP_PATTERN] }],
    },
  },
  {
    // 화면 계층(app): SDK·Jev 클라이언트를 모른다 — app/api 라우트 핸들러만 예외
    files: ["app/**/*.{ts,tsx}"],
    ignores: ["app/api/**/route.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [SDK_PATTERN] }],
    },
  },
  {
    // lib: features/app·React·Next에 의존할 수 없다
    files: ["lib/**/*.{ts,tsx}"],
    ignores: ["lib/judge/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: LIB_PATTERNS }],
    },
  },
  {
    // lib/judge: 위 lib 규칙 + SDK·Jev 비의존(클라이언트 번들에 들어가는 순수 판정 로직)
    files: ["lib/judge/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...LIB_PATTERNS, SDK_PATTERN] }],
    },
  },
  {
    // 벤치 러너는 화면 계층에 의존할 수 없다(lib만 import)
    files: ["bench/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features", "@/features/**", "@/app", "@/app/**", "**/features/**", "**/app/**"],
              message: "bench는 features/app에 의존할 수 없다",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
