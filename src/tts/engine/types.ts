export interface ZeroTTSConfig {
  sample_rate: number
  num_codebooks: number
  codebook_size: number
  d_model: number
  n_layers: number
  n_heads: number
  n_voice_queries: number
  max_frames?: number
  cpuThreads?: number | string
}

export interface SamplingOptions {
  textTemperature: number
  textTopK: number
  audioTemperature: number
  audioTopK: number
  audioTopP: number
  audioRepetitionPenalty: number
  cfgScale: number
  minFrames: number
  maxFrames: number
  eoaExtraFrames: number
  cpuThreads?: number | string
}

export const DEFAULT_SAMPLING: SamplingOptions = {
  textTemperature: 1.0,
  textTopK: 50,
  audioTemperature: 0.8,
  audioTopK: 25,
  audioTopP: 0.95,
  audioRepetitionPenalty: 1.2,
  cfgScale: 1.0,
  minFrames: 4,
  maxFrames: 1500,
  eoaExtraFrames: 1,
}

export interface VoiceMeta {
  name: string
  display_name: string
  language: string
  gender: string
  description: string
  tags?: string[]
  n_voice_queries?: number
  shape?: number[]
}

export interface VoiceIndex {
  voices: VoiceMeta[]
}

export const DEFAULT_VOICES: VoiceMeta[] = [
  {
    name: 'maichi',
    display_name: 'Mai Chi',
    language: 'vi',
    gender: 'nữ',
    description: 'nữ, trẻ, kể chuyện, nhẹ nhàng, thân thiện'
  },
  {
    name: 'baotrang',
    display_name: 'Bảo Trang',
    language: 'vi',
    gender: 'nữ',
    description: 'nữ, trưởng thành, tin tức, rõ ràng, trung tính'
  },
  {
    name: 'kimoanh',
    display_name: 'Kim Oanh',
    language: 'vi',
    gender: 'nữ',
    description: 'nữ, trung niên, kể chuyện, ấm áp, truyền cảm'
  },
  {
    name: 'giahuy',
    display_name: 'Gia Huy',
    language: 'vi',
    gender: 'nam',
    description: 'nam, trẻ, kể chuyện, trầm ấm, tâm tình'
  },
  {
    name: 'huuduc',
    display_name: 'Hữu Đức',
    language: 'vi',
    gender: 'nam',
    description: 'nam, lớn tuổi, kể chuyện, trầm, điềm đạm'
  },
  {
    name: 'quangminh',
    display_name: 'Quang Minh',
    language: 'vi',
    gender: 'nam',
    description: 'nam, trẻ, tin tức, rõ ràng, dứt khoát'
  },
  {
    name: 'tiendat',
    display_name: 'Tiến Đạt',
    language: 'vi',
    gender: 'nam',
    description: 'nam, trẻ, bình luận, sôi nổi, năng lượng cao'
  },
  {
    name: 'hamy',
    display_name: 'Hà My',
    language: 'vi',
    gender: 'nữ',
    description: 'nữ, trẻ, hoạt hình, cao, biểu cảm'
  }
]
