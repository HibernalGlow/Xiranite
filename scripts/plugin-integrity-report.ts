/**
 * The testable core of `scripts/plugin-integrity.ts`.
 *
 * The CLI and this module are split for one reason: a script that parses `process.argv` and calls
 * `process.exit()` at import time cannot be tested, and the three things here most worth pinning down are
 * exactly the ones that lie silently — missing `--base`, an unreachable deployment origin, and the
 * "everything is pinned" message that must not become a dead branch.
 *
 * It answers with **the host's own rule** (`@xiranite/contract`'s `describePinCoverage`), never a
 * re-derivation: a pre-publish report that disagrees with what the host will enforce later is worse than
 * no report, because it teaches the distributor which wrong answer is safe.
 */

import {
  classifyPluginArtifacts,
  describePinCoverage,
  parseFrontendPluginManifest,
  UNENFORCEABLE_GUIDANCE,
  type ManifestIssue,
} from "@xiranite/contract"

export type CliRequest =
  | { kind: "digest"; urls: string[] }
  | { kind: "coverage"; manifestPath: string; metadataPath: string; base: string }
  | { kind: "error"; message: string }

/**
 * The `--base` requirement is not ceremony. Pins are matched by absolute href, so comparing the local
 * build's paths against a deployment URL that was never supplied would report *everything* as unpinned —
 * a confidently wrong answer, which is the outcome this function exists to refuse.
 */
export function parseCliRequest(argv: readonly string[]): CliRequest {
  const values = argv.filter((value) => value.trim().length > 0)
  if (values[0] !== "--coverage") {
    const urls = values.filter((value) => !value.startsWith("--"))
    return urls.length === 0
      ? { kind: "error", message: "usage: bun scripts/plugin-integrity.ts <resource-url> [...] 或 --coverage <manifest.toml> <mf-manifest.json> --base <https://…/>" }
      : { kind: "digest", urls }
  }
  const positional = values.slice(1).filter((value) => !value.startsWith("--"))
  const baseIndex = values.indexOf("--base")
  const base = baseIndex >= 0 ? values[baseIndex + 1] : undefined
  if (positional.length < 2) {
    return { kind: "error", message: "usage: bun scripts/plugin-integrity.ts --coverage <manifest.toml> <mf-manifest.json> --base <https://…/>" }
  }
  if (base === undefined || base.trim().length === 0) {
    return { kind: "error", message: "--coverage 需要 --base <部署 origin>：pin 按绝对 URL 匹配，没有它就只能拿本地路径去比，那样什么都比不中" }
  }
  return { kind: "coverage", manifestPath: positional[0]!, metadataPath: positional[1]!, base }
}

export interface CoverageReport {
  entry: string
  /** One line per finding, tab-separated so the output stays greppable and pasteable. */
  lines: string[]
  artifactCount: number
  enforceableCount: number
}

/**
 * Reads a plugin manifest plus the build's federation metadata and says what the pins actually cover.
 *
 * `digest` is injected: when it answers `undefined` (origin not up, offline CI) the report still gives the
 * coverage answer and marks only the digest column as unavailable. A pre-publish check that requires the
 * site to already be live is not a pre-publish check.
 */
export function buildCoverageReport(input: {
  tomlText: string
  metadataJson: string
  base: string
}): { ok: true; report: CoverageReport; unpinned: string[] } | { ok: false; issues: ManifestIssue[] } {
  const parsed = parseFrontendPluginManifest(input.tomlText, { baseUrl: input.base })
  if (!parsed.ok) return { ok: false, issues: parsed.issues }

  let metadata: unknown
  try {
    metadata = JSON.parse(input.metadataJson)
  } catch (error) {
    return {
      ok: false,
      issues: [{ field: "mf-manifest.json", message: `不是能解析的 JSON: ${error instanceof Error ? error.message : String(error)}` }],
    }
  }

  const entry = parsed.manifest.frontend.entry
  const artifacts = classifyPluginArtifacts(entry, metadata)
  const coverage = describePinCoverage({
    integrity: parsed.manifest.frontend.integrity,
    allowedOrigins: parsed.manifest.frontend.allowedOrigins,
    artifacts,
  })

  const lines: string[] = [
    `entry ${entry}`,
    `本次会抓 ${artifacts.length} 份，其中 runtime 亲自取回（pin 有效）的 ${coverage.enforceableArtifactCount} 份`,
  ]
  // The digest column is a placeholder the caller fills (see `fillDigests`): computing hashes means
  // fetching the deployment origin, and that is the CLI's business, not this function's.
  for (const url of coverage.unpinnedArtifacts) lines.push(`没钉\t${url}\tpending`)
  for (const url of coverage.unenforceableArtifacts) lines.push(`钉了也没用\t${url}\t${UNENFORCEABLE_GUIDANCE}`)
  for (const pin of coverage.ineffectivePins) lines.push(`空转pin\t${pin.url}\t${pin.reason}`)
  if (coverage.unpinnedArtifacts.length === 0 && coverage.ineffectivePins.length === 0) {
    lines.push("pin 已覆盖 runtime 会取回的全部产物；未覆盖的那几类见上『钉了也没用』。")
  }

  return {
    ok: true,
    report: {
      entry,
      lines,
      artifactCount: artifacts.length,
      enforceableCount: coverage.enforceableArtifactCount,
    },
    unpinned: [...coverage.unpinnedArtifacts],
  }
}

/** Fills the `pending` digests a report left behind, in one place so the CLI stays three lines. */
export async function fillDigests(
  report: CoverageReport,
  digests: readonly string[],
  lookup: (url: string) => Promise<string | undefined>,
): Promise<string[]> {
  const computed = new Map<string, string>()
  for (const url of digests) {
    const digest = await lookup(url)
    if (digest !== undefined) computed.set(url, digest)
  }
  return report.lines.map((line) => {
    if (!line.startsWith("没钉\t")) return line
    const [, url] = line.split("\t")
    const digest = computed.get(url ?? "")
    return digest === undefined ? `没钉\t${url}\t（摘要未取：部署 origin 现在连不上）` : `没钉\t${url}\t${digest}`
  })
}
