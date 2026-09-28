// 카메라 영역을 덮는 grey800 안내. 로딩·권한 거부·에러가 같은 모양을 쓴다.
// WebcamPanel(동적 로드)과 그 로딩 자리 표시가 함께 쓰므로 별도 파일로 둔다.
import type { LucideIcon } from "lucide-react";

/**
 * 영상 영역. 모바일은 48dvh 전폭(아래 시트에 표정 수치·입력이 이어지도록), 데스크톱은 캠 섹션을 꽉 채운다.
 * WebcamPanel과 그 로딩 자리 표시가 같은 크기를 쓰도록 여기 둔다(WebcamPanel은 동적 로드라 거기서 import하지 않는다).
 */
export const CAM_BOX_CLASS = "relative h-[48dvh] overflow-hidden bg-grey-800 lg:absolute lg:inset-0 lg:h-auto";

export interface CameraCoverProps {
  icon: LucideIcon;
  title: string;
  body: string;
}

export function CameraCover({ icon: Icon, title, body }: CameraCoverProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-grey-800 px-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-white/10 text-white">
        <Icon size={28} strokeWidth={2} aria-hidden="true" />
      </span>
      <p className="text-[20px] leading-snug font-bold tracking-[-0.01em] text-white">{title}</p>
      <p className="text-[15px] font-medium text-white/70">{body}</p>
    </div>
  );
}
