// 가드레일 태그 — 인젝션/유해 확률 중 큰 값을 기준으로 안전·주의·경고 3단계를 아이콘+텍스트로 보여준다.
import { ShieldAlert, ShieldCheck, ShieldX, type LucideIcon } from "lucide-react";
import type { Decision, GuardrailStatus } from "@/lib/judge/schema";
import { formatPercent } from "./format";

interface GuardrailBadgeProps {
  guardrail: Decision["guardrail"];
}

const STATUS_LABEL_KO: Readonly<Record<GuardrailStatus, string>> = {
  safe: "안전한 입력",
  caution: "주의가 필요해요",
  blocked: "위험한 입력",
};

const STATUS_ICON: Readonly<Record<GuardrailStatus, LucideIcon>> = {
  safe: ShieldCheck,
  caution: ShieldAlert,
  blocked: ShieldX,
};

// 토스 태그 — 옅은 배경 + 진한 글자. 안전은 평소 상태라 회색으로 두고 키컬러를 쓰지 않는다.
// 주의·경고는 글자 대비를 위해 아이콘만 기능색을 쓴다
const STATUS_STYLE: Readonly<Record<GuardrailStatus, { tag: string; icon: string }>> = {
  safe: { tag: "bg-grey-100 text-grey-700", icon: "" },
  caution: { tag: "bg-warning-soft text-grey-800", icon: "text-warning" },
  blocked: { tag: "bg-danger-soft text-grey-800", icon: "text-danger" },
};

export function GuardrailBadge({ guardrail }: GuardrailBadgeProps) {
  const Icon = STATUS_ICON[guardrail.status];
  const style = STATUS_STYLE[guardrail.status];
  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg pr-2.5 pl-2 text-[13px] font-semibold ${style.tag}`}
      title={`인젝션 ${formatPercent(guardrail.injection)}, 유해 ${formatPercent(guardrail.harmful)}`}
    >
      <Icon size={16} strokeWidth={2.25} aria-hidden="true" className={style.icon} />
      <span>
        <span className="sr-only">가드레일 </span>
        {STATUS_LABEL_KO[guardrail.status]}
      </span>
    </span>
  );
}
