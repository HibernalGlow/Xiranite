/**
 * This is Simiu's domain scorer, intentionally independent of Czkawka's
 * upstream image-hash algorithms and result DTOs.
 */
export interface SimiuImageFeature {
  path: string
  size: number
  modifiedDate: number
  width: number
  height: number
  ratio: number
  meanRgb: readonly [number, number, number]
  phash: string
}

export const SIMIU_MAX_RATIO_DELTA = 0.2
export const SIMIU_SCORE_WEIGHTS = {
  phash: 0.68,
  ratio: 0.14,
  color: 0.10,
  fileSize: 0.08,
} as const

export function scoreSimiuImagePair(left: SimiuImageFeature, right: SimiuImageFeature): number {
  return SIMIU_SCORE_WEIGHTS.phash * normalizedHammingDistance(left.phash, right.phash)
    + SIMIU_SCORE_WEIGHTS.ratio * Math.min(Math.abs(left.ratio - right.ratio), 1)
    + SIMIU_SCORE_WEIGHTS.color * normalizedRgbDistance(left.meanRgb, right.meanRgb)
    + SIMIU_SCORE_WEIGHTS.fileSize * normalizedFileSizeDistance(left.size, right.size)
}

/**
 * Matches the original Simiu union-find behavior, including singleton groups
 * for files that could not be decoded into image features.
 */
export function clusterSimiuImagePaths(imagePaths: readonly string[], features: readonly SimiuImageFeature[], threshold: number): string[][] {
  const featureByPath = new Map(features.map((feature) => [feature.path, feature]))
  const validPaths = imagePaths.filter((path) => featureByPath.has(path))
  if (!validPaths.length) return []

  const ordered = [...validPaths].sort((left, right) => featureByPath.get(left)!.ratio - featureByPath.get(right)!.ratio)
  const groups = new SimiuUnionFind(validPaths)
  for (let index = 0; index < ordered.length; index += 1) {
    const leftPath = ordered[index]!
    const left = featureByPath.get(leftPath)!
    for (let candidateIndex = index + 1; candidateIndex < ordered.length; candidateIndex += 1) {
      const rightPath = ordered[candidateIndex]!
      const right = featureByPath.get(rightPath)!
      if (groups.find(leftPath) === groups.find(rightPath)) continue
      if (Math.abs(left.ratio - right.ratio) > SIMIU_MAX_RATIO_DELTA) break
      if (scoreSimiuImagePair(left, right) <= threshold) groups.union(leftPath, rightPath)
    }
  }

  const clusters = new Map<string, string[]>()
  for (const path of validPaths) {
    const root = groups.find(path)
    const members = clusters.get(root) ?? []
    members.push(path)
    clusters.set(root, members)
  }
  for (const path of imagePaths) if (!featureByPath.has(path)) clusters.set(path, [path])

  return [...clusters.values()]
    .map((paths) => paths.sort(comparePaths))
    .sort((left, right) => right.length - left.length || comparePaths(right[0] ?? "", left[0] ?? ""))
}

function normalizedHammingDistance(left: string, right: string): number {
  if (left.length === 0 || left.length !== right.length) return 1
  let different = 0
  for (let index = 0; index < left.length; index += 1) if (left.charCodeAt(index) !== right.charCodeAt(index)) different += 1
  return different / left.length
}

function normalizedRgbDistance(left: readonly [number, number, number], right: readonly [number, number, number]): number {
  const red = left[0] - right[0]
  const green = left[1] - right[1]
  const blue = left[2] - right[2]
  return Math.sqrt(red * red + green * green + blue * blue) / (255 * Math.sqrt(3))
}

function normalizedFileSizeDistance(left: number, right: number): number {
  if (left <= 0 || right <= 0) return 1
  return 1 - Math.min(left, right) / Math.max(left, right)
}

class SimiuUnionFind {
  readonly #parent = new Map<string, string>()
  readonly #rank = new Map<string, number>()

  constructor(items: readonly string[]) {
    for (const item of items) {
      this.#parent.set(item, item)
      this.#rank.set(item, 0)
    }
  }

  find(item: string): string {
    const parent = this.#parent.get(item)
    if (!parent) throw new Error(`Unknown Simiu image path: ${item}`)
    if (parent === item) return item
    const root = this.find(parent)
    this.#parent.set(item, root)
    return root
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left)
    const rightRoot = this.find(right)
    if (leftRoot === rightRoot) return
    const leftRank = this.#rank.get(leftRoot) ?? 0
    const rightRank = this.#rank.get(rightRoot) ?? 0
    if (leftRank < rightRank) this.#parent.set(leftRoot, rightRoot)
    else if (leftRank > rightRank) this.#parent.set(rightRoot, leftRoot)
    else {
      this.#parent.set(rightRoot, leftRoot)
      this.#rank.set(leftRoot, leftRank + 1)
    }
  }
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
}
