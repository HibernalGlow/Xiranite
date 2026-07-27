import { ReaderMediaFormatRegistry } from "../../domain/page/media.js"
import { normalizeReaderAnimatedVideoKeywords } from "../animated-video/ReaderAnimatedVideoMode.js"
import * as Models from "./ReaderRuntimeConfigModels.js"
import { boundedNumber, optionalStringArray, requiredStringArray, optionalStringRecord, requiredStringRecord, optionalBoolean, requiredBoolean, requireRecord } from "./ReaderRuntimeConfigParserPrimitives.js"

export function parseMediaConfig(image: Record<string, unknown> | undefined, subtitle: Record<string, unknown> | undefined): Models.NeoviewMediaConfig {
  const formats = new ReaderMediaFormatRegistry({
    supportedImageFormats: optionalStringArray(
      image?.supported_formats,
      Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.supportedImageFormats,
      "[nodes.neoview.image].supported_formats",
    ),
    videoFormats: optionalStringArray(image?.video_formats, Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.videoFormats, "[nodes.neoview.image].video_formats"),
    mediaMimeTypes: optionalStringRecord(image?.media_mime_types, Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.mediaMimeTypes, "[nodes.neoview.image].media_mime_types"),
  })
  const videoMinPlaybackRate = boundedNumber(
    image?.video_min_playback_rate,
    0.05,
    64,
    Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.videoMinPlaybackRate,
    "[nodes.neoview.image].video_min_playback_rate",
  )
  const videoMaxPlaybackRate = boundedNumber(
    image?.video_max_playback_rate,
    0.05,
    64,
    Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.videoMaxPlaybackRate,
    "[nodes.neoview.image].video_max_playback_rate",
  )
  if (videoMaxPlaybackRate < videoMinPlaybackRate) {
    throw new Error("[nodes.neoview.image].video_max_playback_rate must not be less than video_min_playback_rate.")
  }
  return {
    supportedImageFormats: formats.supportedImageFormats,
    videoFormats: formats.videoFormats,
    mediaMimeTypes: formats.mediaMimeTypes,
    autoPlayAnimatedImages:
      optionalBoolean(image?.auto_play_animated_images, "[nodes.neoview.image].auto_play_animated_images") ??
      Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.autoPlayAnimatedImages,
    animatedVideoEnabled:
      optionalBoolean(image?.animated_video_enabled, "[nodes.neoview.image].animated_video_enabled") ??
      Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.animatedVideoEnabled,
    animatedVideoKeywords: normalizeReaderAnimatedVideoKeywords(image?.animated_video_keywords),
    videoControlsPinned:
      optionalBoolean(image?.video_controls_pinned, "[nodes.neoview.image].video_controls_pinned") ??
      Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.videoControlsPinned,
    videoMinPlaybackRate,
    videoMaxPlaybackRate,
    videoPlaybackRateStep: boundedNumber(
      image?.video_playback_rate_step,
      0.01,
      4,
      Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.videoPlaybackRateStep,
      "[nodes.neoview.image].video_playback_rate_step",
    ),
    subtitle: {
      fontSize: boundedNumber(subtitle?.font_size, 0.5, 3, Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.fontSize, "[nodes.neoview.reader.subtitle].font_size"),
      color: normalizedSubtitleColor(subtitle?.color, "[nodes.neoview.reader.subtitle].color", Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.color),
      backgroundOpacity: boundedNumber(
        subtitle?.bg_opacity,
        0,
        1,
        Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.backgroundOpacity,
        "[nodes.neoview.reader.subtitle].bg_opacity",
      ),
      bottomPercent: boundedNumber(
        subtitle?.bottom,
        0,
        30,
        Models.DEFAULT_NEOVIEW_MEDIA_CONFIG.subtitle.bottomPercent,
        "[nodes.neoview.reader.subtitle].bottom",
      ),
    },
  }
}
export function parseNeoviewMediaPatch(
  value: unknown,
  current: Models.NeoviewMediaConfig = Models.DEFAULT_NEOVIEW_MEDIA_CONFIG,
): { patch: Models.NeoviewMediaPatch; tomlPatch: Record<string, unknown> } {
  const record = requireRecord(value, "reader media patch")
  if (Object.keys(record).some((key) => key !== "media")) throw new Error("reader media patch contains unsupported fields.")
  const media = requireRecord(record.media, "reader media patch.media")
  const allowed = new Set([
    "supportedImageFormats",
    "videoFormats",
    "mediaMimeTypes",
    "autoPlayAnimatedImages",
    "animatedVideoEnabled",
    "animatedVideoKeywords",
    "videoControlsPinned",
    "videoMinPlaybackRate",
    "videoMaxPlaybackRate",
    "videoPlaybackRateStep",
    "subtitle",
  ])
  const unknown = Object.keys(media).filter((key) => !allowed.has(key))
  if (unknown.length) throw new Error(`reader media patch contains unsupported fields: ${unknown.join(", ")}.`)
  const patch: Models.NeoviewMediaPatch = { media: {} }
  const imageToml: Record<string, unknown> = {}
  const readerToml: Record<string, unknown> = {}
  if (media.supportedImageFormats !== undefined || media.videoFormats !== undefined || media.mediaMimeTypes !== undefined) {
    const formats = new ReaderMediaFormatRegistry({
      supportedImageFormats:
        media.supportedImageFormats === undefined
          ? current.supportedImageFormats
          : requiredStringArray(media.supportedImageFormats, "reader media patch.supportedImageFormats"),
      videoFormats: media.videoFormats === undefined ? current.videoFormats : requiredStringArray(media.videoFormats, "reader media patch.videoFormats"),
      mediaMimeTypes:
        media.mediaMimeTypes === undefined ? current.mediaMimeTypes : requiredStringRecord(media.mediaMimeTypes, "reader media patch.mediaMimeTypes"),
    })
    patch.media.supportedImageFormats = formats.supportedImageFormats
    patch.media.videoFormats = formats.videoFormats
    patch.media.mediaMimeTypes = formats.mediaMimeTypes
    imageToml.supported_formats = formats.supportedImageFormats
    imageToml.video_formats = formats.videoFormats
    imageToml.media_mime_types = formats.mediaMimeTypes
  }
  if (media.autoPlayAnimatedImages !== undefined) {
    patch.media.autoPlayAnimatedImages = requiredBoolean(media.autoPlayAnimatedImages, "reader media patch.autoPlayAnimatedImages")
    imageToml.auto_play_animated_images = patch.media.autoPlayAnimatedImages
  }
  if (media.animatedVideoEnabled !== undefined) {
    patch.media.animatedVideoEnabled = requiredBoolean(media.animatedVideoEnabled, "reader media patch.animatedVideoEnabled")
    imageToml.animated_video_enabled = patch.media.animatedVideoEnabled
  }
  if (media.animatedVideoKeywords !== undefined) {
    patch.media.animatedVideoKeywords = normalizeReaderAnimatedVideoKeywords(media.animatedVideoKeywords)
    imageToml.animated_video_keywords = patch.media.animatedVideoKeywords
  }
  if (media.videoControlsPinned !== undefined) {
    patch.media.videoControlsPinned = requiredBoolean(media.videoControlsPinned, "reader media patch.videoControlsPinned")
    imageToml.video_controls_pinned = patch.media.videoControlsPinned
  }
  if (media.videoMinPlaybackRate !== undefined) {
    patch.media.videoMinPlaybackRate = boundedNumber(
      media.videoMinPlaybackRate,
      0.05,
      64,
      current.videoMinPlaybackRate,
      "reader media patch.videoMinPlaybackRate",
    )
    imageToml.video_min_playback_rate = patch.media.videoMinPlaybackRate
  }
  if (media.videoMaxPlaybackRate !== undefined) {
    patch.media.videoMaxPlaybackRate = boundedNumber(
      media.videoMaxPlaybackRate,
      0.05,
      64,
      current.videoMaxPlaybackRate,
      "reader media patch.videoMaxPlaybackRate",
    )
    imageToml.video_max_playback_rate = patch.media.videoMaxPlaybackRate
  }
  if (media.videoPlaybackRateStep !== undefined) {
    patch.media.videoPlaybackRateStep = boundedNumber(
      media.videoPlaybackRateStep,
      0.01,
      4,
      current.videoPlaybackRateStep,
      "reader media patch.videoPlaybackRateStep",
    )
    imageToml.video_playback_rate_step = patch.media.videoPlaybackRateStep
  }
  const nextMinimum = patch.media.videoMinPlaybackRate ?? current.videoMinPlaybackRate
  const nextMaximum = patch.media.videoMaxPlaybackRate ?? current.videoMaxPlaybackRate
  if (nextMaximum < nextMinimum) throw new Error("reader media patch.videoMaxPlaybackRate must not be less than videoMinPlaybackRate.")
  if (media.subtitle !== undefined) {
    const subtitle = requireRecord(media.subtitle, "reader media patch.subtitle")
    const subtitleAllowed = new Set(["fontSize", "color", "backgroundOpacity", "bottomPercent"])
    const unknownSubtitle = Object.keys(subtitle).filter((key) => !subtitleAllowed.has(key))
    if (unknownSubtitle.length) throw new Error(`reader media patch.subtitle contains unsupported fields: ${unknownSubtitle.join(", ")}.`)
    const subtitlePatch: Partial<Models.NeoviewSubtitleConfig> = {}
    const subtitleToml: Record<string, unknown> = {}
    if (subtitle.fontSize !== undefined) {
      subtitlePatch.fontSize = boundedNumber(subtitle.fontSize, 0.5, 3, current.subtitle.fontSize, "reader media patch.subtitle.fontSize")
      subtitleToml.font_size = subtitlePatch.fontSize
    }
    if (subtitle.color !== undefined) {
      subtitlePatch.color = normalizedSubtitleColor(subtitle.color, "reader media patch.subtitle.color")
      subtitleToml.color = subtitlePatch.color
    }
    if (subtitle.backgroundOpacity !== undefined) {
      subtitlePatch.backgroundOpacity = boundedNumber(
        subtitle.backgroundOpacity,
        0,
        1,
        current.subtitle.backgroundOpacity,
        "reader media patch.subtitle.backgroundOpacity",
      )
      subtitleToml.bg_opacity = subtitlePatch.backgroundOpacity
    }
    if (subtitle.bottomPercent !== undefined) {
      subtitlePatch.bottomPercent = boundedNumber(subtitle.bottomPercent, 0, 30, current.subtitle.bottomPercent, "reader media patch.subtitle.bottomPercent")
      subtitleToml.bottom = subtitlePatch.bottomPercent
    }
    if (!Object.keys(subtitlePatch).length) throw new Error("reader media patch.subtitle must change at least one field.")
    patch.media.subtitle = subtitlePatch
    readerToml.subtitle = subtitleToml
  }
  if (!Object.keys(patch.media).length) throw new Error("reader media patch must change at least one field.")
  const tomlPatch: Record<string, unknown> = {}
  if (Object.keys(imageToml).length) tomlPatch.image = imageToml
  if (Object.keys(readerToml).length) tomlPatch.reader = readerToml
  return { patch, tomlPatch }
}
export function normalizedSubtitleColor(value: unknown, path: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{5})?$/.test(value)) {
    throw new Error(`${path} must be a #RGB, #RRGGBB or #RRGGBBAA color.`)
  }
  return value.toLowerCase()
}
