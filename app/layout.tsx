import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Pretendard Variable을 npm 패키지에서 직접 self-host한다(외부 CDN 요청 없음)
const pretendard = localFont({
  src: "../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  weight: "45 920",
  display: "swap",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "Jev 무드 미러",
  description: "표정과 한마디로 지금 기분을 살펴보는 데모",
};

// 모바일 하단 고정 버튼이 홈 인디케이터 영역(safe-area)까지 계산할 수 있게 화면 전체를 쓴다
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#f2f4f6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={pretendard.variable}>
      <body>{children}</body>
    </html>
  );
}
