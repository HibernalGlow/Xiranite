import type { ReaderEmmCatalogTag } from "./ReaderEmmTagCatalogStore.js"

/** Stable, platform-independent key used to correlate EMM translations. */
export function emmTranslationKey(value: ReaderEmmCatalogTag): string {
  const namespace = emmTranslationNamespace(value.category)
  return `${namespace}\0${value.tag.normalize("NFKC").toLocaleLowerCase()}`
}

export function emmTranslationNamespace(value: string): string {
  const normalized = value.trim().toLocaleLowerCase()
  return (ABBREVIATIONS[normalized] ?? normalized).normalize("NFKC").toLocaleLowerCase()
}

const ABBREVIATIONS: Readonly<Record<string, string>> = {
  l: "language",
  p: "parody",
  c: "character",
  g: "group",
  a: "artist",
  m: "male",
  f: "female",
  x: "mixed",
  r: "reclass",
  cos: "cosplayer",
  o: "other",
}
