import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import type { EnvuConfigRuntime } from "./core.js"

export function createNodeEnvuConfigRuntime(): EnvuConfigRuntime {
  return {
    listFiles,
    copyFile,
    writeText: (path, content) => writeFile(path, content, "utf8"),
    makeDir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    join,
    dirname,
  }
}

async function listFiles(root: string): Promise<Array<{ path: string; relativePath: string; size: number; modifiedMs: number }>> {
  const base = resolve(root)
  const files: Array<{ path: string; relativePath: string; size: number; modifiedMs: number }> = []
  async function visit(path: string) {
    const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const fullPath = join(path, entry.name)
      if (entry.isDirectory()) {
        await visit(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(fullPath)
      files.push({ path: fullPath, relativePath: relative(base, fullPath), size: info.size, modifiedMs: info.mtimeMs })
    }
  }
  await visit(base)
  return files
}
