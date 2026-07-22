export interface MelodeckLyricLine {
  time?: number
  text: string
}

export interface EmbeddedLyricsTag {
  text?: string
  syncText?: Array<{ timestamp?: number; text?: string }>
}

export function parseLrc(text: string): MelodeckLyricLine[] {
  const lines: MelodeckLyricLine[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const stamps = [...rawLine.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!stamps.length) continue
    const lyricText = rawLine.replace(/\[[^\]]+\]/g, "").trim()
    if (!lyricText) continue

    for (const stamp of stamps) {
      const minutes = Number(stamp[1])
      const seconds = Number(stamp[2])
      const fraction = stamp[3] ? Number(`0.${stamp[3].padEnd(3, "0").slice(0, 3)}`) : 0
      const time = minutes * 60 + seconds + fraction
      if (Number.isFinite(time)) lines.push({ time, text: lyricText })
    }
  }
  return lines.sort(compareLyricLines)
}

export function extractEmbeddedLyrics(tags: EmbeddedLyricsTag[] | undefined): MelodeckLyricLine[] {
  if (!tags?.length) return []

  for (const tag of tags) {
    if (tag.text) {
      const lines = parseLrc(tag.text)
      if (lines.length) return lines
    }
    const synchronized = tag.syncText
      ?.filter((entry) => entry.timestamp != null && Number.isFinite(entry.timestamp) && Boolean(entry.text?.trim()))
      .map((entry) => ({ time: entry.timestamp! / 1000, text: entry.text!.trim() }))
      .sort(compareLyricLines)
    if (synchronized?.length) return synchronized
  }

  for (const tag of tags) {
    const plain = tag.text
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ text: line }))
    if (plain?.length) return plain
  }
  return []
}

export function lyricPathCandidates(filePath: string): string[] {
  const base = filePath.replace(/\.[^./\\]+$/, "")
  return Array.from(new Set([`${base}.lrc`, `${base}.LRC`]))
}

export function currentLyricIndex(lines: MelodeckLyricLine[], currentTime: number): number {
  let low = 0
  let high = lines.length - 1
  let active = -1
  const target = currentTime + 0.25
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const time = lines[middle]?.time
    if (time == null || time > target) {
      high = middle - 1
    } else {
      active = middle
      low = middle + 1
    }
  }
  return active
}

export function currentLyricLine(lines: MelodeckLyricLine[], currentTime: number): string | undefined {
  const active = currentLyricIndex(lines, currentTime)
  if (active >= 0) return lines[active]?.text
  return lines.some((line) => line.time != null) ? undefined : lines.find((line) => line.text)?.text
}

function compareLyricLines(left: MelodeckLyricLine, right: MelodeckLyricLine): number {
  return (left.time ?? Number.POSITIVE_INFINITY) - (right.time ?? Number.POSITIVE_INFINITY)
}
