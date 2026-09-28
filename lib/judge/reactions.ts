// 기분 맞춤 반응 사전. Jev는 문장을 만들지 않으므로 문구는 여기 미리 써 두고 Jev는 종류만 고른다.
import type { MoodKey, ReactionKind } from "./labels";
import type { ReactionItem } from "./schema";

export const REACTIONS: Readonly<Record<MoodKey, Readonly<Record<ReactionKind, ReactionItem>>>> = {
  joy: {
    music: {
      id: "joy_music",
      kind: "music",
      title: "신나는 노래 한 곡",
      body: "제일 좋아하는 신나는 노래를 크게 틀어 보세요.",
    },
    phrase: {
      id: "joy_phrase",
      kind: "phrase",
      title: "오늘의 한마디",
      body: "좋은 일은 나눌수록 커져요. 이 기분을 누군가에게 전해 보세요.",
    },
    rest: {
      id: "joy_rest",
      kind: "rest",
      title: "기억해 두기",
      body: "잠깐 멈춰서 지금 이 순간을 사진이나 메모로 남겨 두세요.",
    },
  },
  calm: {
    music: {
      id: "calm_music",
      kind: "music",
      title: "잔잔한 연주곡",
      body: "가사 없는 피아노나 로파이 음악으로 이 평온함을 이어 가 보세요.",
    },
    phrase: {
      id: "calm_phrase",
      kind: "phrase",
      title: "오늘의 한마디",
      body: "별일 없는 하루도 좋은 하루예요.",
    },
    rest: {
      id: "calm_rest",
      kind: "rest",
      title: "천천히 산책",
      body: "10분만 바깥 공기를 마시며 천천히 걸어 보세요.",
    },
  },
  sad: {
    music: {
      id: "sad_music",
      kind: "music",
      title: "위로가 되는 노래",
      body: "마음을 다독여 주는 따뜻한 발라드를 한 곡 들어 보세요.",
    },
    phrase: {
      id: "sad_phrase",
      kind: "phrase",
      title: "오늘의 한마디",
      body: "슬픈 건 자연스러운 일이에요. 오늘은 자신에게 조금 더 너그러워도 돼요.",
    },
    rest: {
      id: "sad_rest",
      kind: "rest",
      title: "따뜻한 차 한 잔",
      body: "따뜻한 음료를 마시면서 편한 사람에게 연락해 보세요.",
    },
  },
  tired: {
    music: {
      id: "tired_music",
      kind: "music",
      title: "느린 템포의 음악",
      body: "눈을 감고 느린 음악을 들으며 몸에 힘을 빼 보세요.",
    },
    phrase: {
      id: "tired_phrase",
      kind: "phrase",
      title: "오늘의 한마디",
      body: "오늘 여기까지 온 것만으로도 잘했어요.",
    },
    rest: {
      id: "tired_rest",
      kind: "rest",
      title: "짧은 휴식",
      body: "화면에서 눈을 떼고 20분만 누워 쉬거나 일찍 잠자리에 들어 보세요.",
    },
  },
  annoyed: {
    music: {
      id: "annoyed_music",
      kind: "music",
      title: "시원한 록 한 곡",
      body: "내지르는 록이나 비트가 강한 노래로 답답함을 털어 보세요.",
    },
    phrase: {
      id: "annoyed_phrase",
      kind: "phrase",
      title: "오늘의 한마디",
      body: "짜증이 난 데는 이유가 있어요. 꾹 참기만 할 필요는 없어요.",
    },
    rest: {
      id: "annoyed_rest",
      kind: "rest",
      title: "깊은 숨 세 번",
      body: "자리에서 잠깐 벗어나 천천히 깊게 숨을 세 번 쉬어 보세요.",
    },
  },
  anxious: {
    music: {
      id: "anxious_music",
      kind: "music",
      title: "호흡을 고르는 음악",
      body: "빗소리처럼 일정하게 반복되는 소리에 맞춰 천천히 숨을 쉬어 보세요.",
    },
    phrase: {
      id: "anxious_phrase",
      kind: "phrase",
      title: "오늘의 한마디",
      body: "아직 일어나지 않은 일이에요. 지금 할 수 있는 것 하나만 떠올려 봐요.",
    },
    rest: {
      id: "anxious_rest",
      kind: "rest",
      title: "걱정 적어 두기",
      body: "걱정을 종이에 적고 오늘 할 수 있는 일과 없는 일을 나눠 보세요.",
    },
  },
};
