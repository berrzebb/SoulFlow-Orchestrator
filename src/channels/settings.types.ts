/** 채널별 설정 타입. ChannelInstanceConfig.settings의 구체 타입. */

export interface SlackChannelSettings {
  default_channel?: string;
  bot_self_id?: string;
  text_chunk_size?: number;
  text_file_fallback_threshold?: number;
}

export interface TelegramChannelSettings {
  default_chat_id?: string;
  api_base?: string;
  bot_self_id?: string;
  text_chunk_size?: number;
  text_file_fallback_threshold?: number;
  /** false로 설정하면 링크 프리뷰를 비활성화. */
  link_preview?: boolean;
}

export interface DiscordChannelSettings {
  default_channel?: string;
  api_base?: string;
  text_chunk_size?: number;
  text_file_fallback_threshold?: number;
}

/** 알려진 채널 설정 유니온. 저장소에서 로드한 후 provider에 따라 캐스팅. */
export type AnyChannelSettings = SlackChannelSettings | TelegramChannelSettings | DiscordChannelSettings | Record<string, unknown>;
