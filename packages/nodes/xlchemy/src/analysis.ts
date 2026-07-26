export interface XlchemyInputAnalysis {
  totalFiles: number
  totalSize: number
  minSize: number
  medianSize: number
  maxSize: number
  formats: Array<{ key: string; count: number; size: number }>
  folders: Array<{ key: string; count: number; size: number }>
  /** Median sampling or folder aggregation was bounded during the stream. */
  sampled: boolean
}

export interface XlchemyOutputAnalysis {
  formats: Array<{ key: string; count: number; sourceBytes: number; outputBytes: number }>
}

interface Distribution { count: number; size: number }
interface OutputDistribution { count: number; sourceBytes: number; outputBytes: number }

export interface XlchemyAnalysisSummary {
  inputCount: number
  inputBytes: number
  knownSizeCount: number
  minSize: number
  maxSize: number
  sizeSamples: number[]
  formats: Map<string, Distribution>
  folders: Map<string, Distribution>
  otherFolderCount: number
  otherFolderSize: number
  outputFormats: Map<string, OutputDistribution>
}

export const INPUT_ANALYSIS_SAMPLE_LIMIT = 2_048
export const INPUT_ANALYSIS_FOLDER_LIMIT = 64

export function createXlchemyAnalysisSummary(): XlchemyAnalysisSummary {
  return { inputCount: 0, inputBytes: 0, knownSizeCount: 0, minSize: Number.POSITIVE_INFINITY, maxSize: 0, sizeSamples: [], formats: new Map(), folders: new Map(), otherFolderCount: 0, otherFolderSize: 0, outputFormats: new Map() }
}

export function appendXlchemyAnalysis(summary: XlchemyAnalysisSummary, file: { sourcePath: string; sourceBytes?: number; outputBytes?: number; status: string }): void {
  const size = Math.max(0, file.sourceBytes ?? 0)
  const extension = sourceExtension(file.sourcePath)
  summary.inputCount += 1
  summary.inputBytes += size
  appendDistribution(summary.formats, extension, size)
  appendFolder(summary, sourceFolder(file.sourcePath), size)
  appendSize(summary, file.sourceBytes, size)
  if (file.status === "converted") appendOutputDistribution(summary.outputFormats, extension, size, Math.max(0, file.outputBytes ?? 0))
}

export function xlchemyAnalysisData(summary: XlchemyAnalysisSummary): { inputAnalysis: XlchemyInputAnalysis; outputAnalysis: XlchemyOutputAnalysis } {
  const samples = [...summary.sizeSamples].sort((left, right) => left - right)
  const folders = [...summary.folders.entries()].map(([key, value]) => ({ key, ...value }))
  if (summary.otherFolderCount) {
    const other = folders.find((item) => item.key === "其他")
    if (other) {
      other.count += summary.otherFolderCount
      other.size += summary.otherFolderSize
    } else folders.push({ key: "其他", count: summary.otherFolderCount, size: summary.otherFolderSize })
  }
  return {
    inputAnalysis: {
      totalFiles: summary.inputCount,
      totalSize: summary.inputBytes,
      minSize: Number.isFinite(summary.minSize) ? summary.minSize : 0,
      medianSize: samples[Math.floor(samples.length / 2)] ?? 0,
      maxSize: summary.maxSize,
      formats: distributionData(summary.formats),
      folders: folders.sort(distributionSort),
      sampled: summary.knownSizeCount !== summary.inputCount || summary.knownSizeCount > INPUT_ANALYSIS_SAMPLE_LIMIT || summary.otherFolderCount > 0,
    },
    outputAnalysis: {
      formats: [...summary.outputFormats.entries()].map(([key, value]) => ({ key, ...value })).sort((left, right) => right.sourceBytes - left.sourceBytes || right.count - left.count),
    },
  }
}

function appendFolder(summary: XlchemyAnalysisSummary, folder: string, size: number): void {
  const existing = summary.folders.get(folder)
  if (existing) {
    existing.count += 1
    existing.size += size
  } else if (summary.folders.size < INPUT_ANALYSIS_FOLDER_LIMIT - 1) summary.folders.set(folder, { count: 1, size })
  else {
    summary.otherFolderCount += 1
    summary.otherFolderSize += size
  }
}

function appendSize(summary: XlchemyAnalysisSummary, sourceBytes: number | undefined, size: number): void {
  if (sourceBytes === undefined) return
  summary.knownSizeCount += 1
  summary.minSize = Math.min(summary.minSize, size)
  summary.maxSize = Math.max(summary.maxSize, size)
  if (summary.sizeSamples.length < INPUT_ANALYSIS_SAMPLE_LIMIT) summary.sizeSamples.push(size)
  else {
    const slot = (Math.imul(summary.knownSizeCount, 2_654_435_761) >>> 0) % summary.knownSizeCount
    if (slot < INPUT_ANALYSIS_SAMPLE_LIMIT) summary.sizeSamples[slot] = size
  }
}

function appendDistribution(values: Map<string, Distribution>, key: string, size: number): void {
  const current = values.get(key) ?? { count: 0, size: 0 }
  current.count += 1
  current.size += size
  values.set(key, current)
}

function appendOutputDistribution(values: Map<string, OutputDistribution>, key: string, sourceBytes: number, outputBytes: number): void {
  const current = values.get(key) ?? { count: 0, sourceBytes: 0, outputBytes: 0 }
  current.count += 1
  current.sourceBytes += sourceBytes
  current.outputBytes += outputBytes
  values.set(key, current)
}

function distributionData(values: Map<string, Distribution>) {
  return [...values.entries()].map(([key, value]) => ({ key, ...value })).sort(distributionSort)
}

function distributionSort(left: Distribution, right: Distribution) {
  return right.size - left.size || right.count - left.count
}

function sourceExtension(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").at(-1) ?? path
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "unknown"
}

function sourceFolder(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  const directory = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : ""
  return directory.split("/").filter(Boolean).at(-1) ?? "/"
}
