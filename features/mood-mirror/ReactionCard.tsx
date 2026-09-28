// 기분 맞춤 반응. 결과 카드의 마지막 행으로 들어간다.
// Jev는 문장을 만들지 않는다. 문구는 lib/judge/reactions.ts에 미리 써 두고 Jev는 종류만 고른다.
import { Coffee, EyeOff, MessageCircle, Music, Sparkles, type LucideIcon } from "lucide-react";
import type { ReactionKind } from "@/lib/judge/labels";
import type { ReactionDecision } from "@/lib/judge/schema";

const KIND_ICON: Readonly<Record<ReactionKind, LucideIcon>> = {
  music: Music,
  phrase: MessageCircle,
  rest: Coffee,
};

/** 토스 리스트 행: 왼쪽 둥근 아이콘, 오른쪽 캡션·제목·본문 */
function Row({ icon: Icon, caption, title, body }: {
  icon: LucideIcon;
  caption: string;
  title: string;
  body?: string;
}) {
  return (
    <div className="flex items-start gap-3.5">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-grey-100 text-grey-700"
      >
        <Icon size={20} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-grey-600">{caption}</p>
        <h3 className="text-[17px] leading-snug font-bold text-grey-900 short:text-[16px]">{title}</h3>
        {body && <p className="mt-0.5 text-[15px] font-medium text-grey-700 short:text-[14px]">{body}</p>}
      </div>
    </div>
  );
}

export function ReactionRow({ reaction }: { reaction: ReactionDecision }) {
  if (reaction.status === "hidden") {
    return <Row icon={EyeOff} caption="기분에 맞춘 추천" title="판정을 보류해서 추천은 없어요" />;
  }

  const { item } = reaction;
  return <Row icon={KIND_ICON[item.kind]} caption="기분에 맞춘 추천" title={item.title} body={item.body} />;
}

/** 결과 전 자리 표시. 추천이 어디에 뜨는지 미리 보여 준다 */
export function ReactionHint() {
  return <Row icon={Sparkles} caption="기분에 맞춘 추천" title="살펴보고 나면 여기에 추천이 떠요" />;
}
