import type { FoliaTrack } from "@hibernalglow/folia-player"

export interface XiraniteFoliaTrackSource {
  title: string
  artist?: string
  fileName?: string
  relativePath?: string
  lastModified?: number
}

export interface XiraniteFoliaTrack extends FoliaTrack {
  xiraniteSource?: XiraniteFoliaTrackSource
}
