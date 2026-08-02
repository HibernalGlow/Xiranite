import { posix, win32 } from "node:path"
import type { DirectoryScoresResult } from "@xiranite/node-clipm/contracts"

import type { ReaderDirectoryClipmScoreProvider } from "../../ports/ReaderDirectoryClipmScoreProvider.js"
import type { ReaderDirectoryEntry } from "../../ports/ReaderDirectoryListingProvider.js"

const MAXIMUM_DIRECTORY_PATHS_PER_REQUEST = 500

export interface ReaderDirectoryClipmScoreGateway {
  getDirectoryScores(
    directoryPaths: readonly string[],
    options?: { signal?: AbortSignal },
  ): Promise<DirectoryScoresResult>
}

export class PlatformReaderDirectoryClipmScoreProvider implements ReaderDirectoryClipmScoreProvider {
  constructor(private readonly gateway: ReaderDirectoryClipmScoreGateway) {}

  async hydrate(
    entries: readonly ReaderDirectoryEntry[],
    signal?: AbortSignal,
  ): Promise<readonly ReaderDirectoryEntry[]> {
    const directoryPaths = [...new Set(entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path))]
    if (!directoryPaths.length) return entries

    const scores = new Map<string, DirectoryScoresResult["directories"][number]>()
    for (let cursor = 0; cursor < directoryPaths.length; cursor += MAXIMUM_DIRECTORY_PATHS_PER_REQUEST) {
      signal?.throwIfAborted()
      const result = await this.gateway.getDirectoryScores(
        directoryPaths.slice(cursor, cursor + MAXIMUM_DIRECTORY_PATHS_PER_REQUEST),
        { signal },
      )
      for (const directory of result.directories) scores.set(directoryPathKey(directory.directoryPath), directory)
    }
    signal?.throwIfAborted()

    return entries.map((entry) => {
      if (entry.kind !== "directory") return entry
      const work = scores.get(directoryPathKey(entry.path))?.work
      return work ? {
        ...entry,
        clipmScore: {
          label: work.label,
          score: work.score,
          bundleVersion: work.bundleVersion,
          shortCode: work.shortCode,
          sourcePath: work.path,
        },
      } : entry
    })
  }
}

function directoryPathKey(path: string): string {
  return process.platform === "win32"
    ? win32.normalize(path).replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US")
    : posix.normalize(path).replace(/\/+$/u, "")
}
