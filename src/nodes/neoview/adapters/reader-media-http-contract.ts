export interface ReaderSubtitleConfigDto {
  fontSize: number
  color: string
  backgroundOpacity: number
  bottomPercent: number
}

export interface ReaderMediaConfigDto {
  supportedImageFormats: readonly string[]
  videoFormats: readonly string[]
  mediaMimeTypes: Readonly<Record<string, string>>
  autoPlayAnimatedImages: boolean
  animatedVideoEnabled: boolean
  animatedVideoKeywords: readonly string[]
  videoControlsPinned: boolean
  videoMinPlaybackRate: number
  videoMaxPlaybackRate: number
  videoPlaybackRateStep: number
  subtitle: ReaderSubtitleConfigDto
}

export interface ReaderMediaPatchDto {
  media: {
    supportedImageFormats?: readonly string[]
    videoFormats?: readonly string[]
    mediaMimeTypes?: Readonly<Record<string, string>>
    autoPlayAnimatedImages?: boolean
    animatedVideoEnabled?: boolean
    animatedVideoKeywords?: readonly string[]
    videoControlsPinned?: boolean
    subtitle?: Partial<ReaderSubtitleConfigDto>
  }
}

export interface ReaderMediaProgressDto {
  position: number
  duration: number
  completed: boolean
  updatedAt: number
}
