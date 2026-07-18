import { stat } from "node:fs/promises"
import { dirname, normalize, resolve } from "node:path"

import type { ViewSource } from "../../domain/book/book.js"
import type { ReaderFileTreeChange } from "../../ports/ReaderFileTreeWatcher.js"
import type {
  ReaderSourceChange,
  ReaderSourceSubscription,
  ReaderSourceWatcher,
} from "../../ports/ReaderSourceWatcher.js"
import { PlatformFileTreeWatcher } from "./PlatformFileTreeWatcher.js"

export class PlatformReaderSourceWatcher implements ReaderSourceWatcher {
  constructor(private readonly watcher = new PlatformFileTreeWatcher()) {}

  async subscribe(
    source: ViewSource,
    onChanges: (changes: readonly ReaderSourceChange[]) => void,
    onError?: () => void,
  ): Promise<ReaderSourceSubscription> {
    const plan = await sourceWatchPlan(source)
    return this.watcher.subscribe(plan.rootPath, (changes) => {
      const relevant = changes.filter(plan.accepts).map(({ kind }) => ({ kind }))
      if (relevant.length) onChanges(relevant)
    }, () => onError?.())
  }
}

interface SourceWatchPlan {
  rootPath: string
  accepts(change: ReaderFileTreeChange): boolean
}

async function sourceWatchPlan(source: ViewSource): Promise<SourceWatchPlan> {
  const sourcePath = normalized(source.path)
  const directory = source.kind === "directory"
    || source.kind === "path" && await isDirectory(source.path)
  if (directory) {
    const prefix = sourcePath.endsWith("\\") ? sourcePath : `${sourcePath}\\`
    return {
      rootPath: source.path,
      accepts: (change) => {
        const changedPath = normalized(change.path)
        return changedPath === sourcePath || changedPath.startsWith(prefix)
      },
    }
  }
  return {
    rootPath: dirname(resolve(source.path)),
    accepts: (change) => normalized(change.path) === sourcePath,
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function normalized(path: string): string {
  const value = normalize(resolve(path))
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value
}
