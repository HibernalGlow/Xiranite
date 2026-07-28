import { XLCHEMY_INPUT_SIZE_CACHE_LIMIT } from "./input-source-model"

interface ListedInputPath {
  path: string
  isDirectory: boolean
  sizeBytes: number
}

export interface XlchemyInputPathInspection {
  directoryPaths: string[]
  fileSizes: Array<[string, number]>
}

const INPUT_INSPECTION_CONCURRENCY = 16

export async function inspectXlchemyInputPaths(
  paths: readonly string[],
  listPath: (path: string, options: { limit: number }) => Promise<ListedInputPath[]>,
): Promise<XlchemyInputPathInspection> {
  const directoryPaths: string[] = []
  const fileSizes: Array<[string, number]> = []
  for (let index = 0; index < paths.length; index += INPUT_INSPECTION_CONCURRENCY) {
    const batch = paths.slice(index, index + INPUT_INSPECTION_CONCURRENCY)
    const inspected = await Promise.all(batch.map(async (path) => {
      const listed = await listPath(path, { limit: 1 }).catch(() => [])
      const direct = listed.find((entry) => normalizedPath(entry.path) === normalizedPath(path))
      return { path, direct }
    }))
    for (const item of inspected) {
      if (!item.direct || item.direct.isDirectory) directoryPaths.push(item.path)
      else if (fileSizes.length < XLCHEMY_INPUT_SIZE_CACHE_LIMIT) fileSizes.push([item.path, item.direct.sizeBytes])
    }
  }
  return { directoryPaths, fileSizes }
}

function normalizedPath(path: string): string {
  return path.replace(/\\/g, "/").toLocaleLowerCase("en-US")
}
