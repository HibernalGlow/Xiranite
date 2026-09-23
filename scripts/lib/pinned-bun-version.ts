import { readFile } from "node:fs/promises"

const repoRootPackageJson = new URL("../../package.json", import.meta.url)

/**
 * The single source of truth for the Bun release a packaged host embeds, and
 * for the toolchain a developer installs. `packageManager` in the root
 * `package.json` already pins it, so staging, local packaged builds and CI all
 * read it here instead of repeating a version literal in four places.
 */
export async function pinnedBunVersion(packageJsonUrl: URL | string = repoRootPackageJson): Promise<string> {
  const contents = await readFile(packageJsonUrl, "utf8")
  const parsed = JSON.parse(contents) as { packageManager?: unknown }
  return parseBunVersionFromPackageManager(parsed.packageManager)
}

export function parseBunVersionFromPackageManager(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Root package.json must pin packageManager as bun@<version>.")
  }
  const match = /^bun@(\d+\.\d+\.\d+)$/.exec(value.trim())
  if (!match) {
    throw new Error(`Unsupported packageManager value ${JSON.stringify(value)}; expected bun@<x.y.z>.`)
  }
  return match[1]!
}
