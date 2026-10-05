/**
 * Prints the SRI pins for plugin resources so an installer can paste them into a manifest.
 *
 *   bun scripts/plugin-integrity.ts http://127.0.0.1:4176/mf-manifest.json http://127.0.0.1:4176/remoteEntry.js
 *
 * Exists because `@module-federation/runtime` has no integrity concept to reuse (§6 第 5 条), so the
 * hash has to be produced by someone. Standard Node syntax with the global `fetch`/`crypto` — no Bun
 * APIs (ADR-0075).
 */

import { readFileSync } from "node:fs"
import process from "node:process"

import {
  classifyPluginArtifacts,
  describePinCoverage,
  parseFrontendPluginManifest,
} from "@xiranite/contract"

const argv = process.argv.slice(2).filter((value) => value.trim().length > 0)

/**
 * `--coverage <manifest.toml> <mf-manifest.json> --base <deploy-url>` — tells a distributor, before
 * publishing, which of the build's bytes their pins actually cover.
 *
 * It runs the **host's own** rule (`@xiranite/contract/pinCoverage`), not a re-derivation, so the
 * report cannot disagree with what the host will enforce later. `--base` is required because pins are
 * keyed by absolute href: coverage of local files against the deployment origin is a different question
 * than coverage of local files against each other, and guessing the origin would silently report
 * everything as unpinned.
 */
if (argv[0] === "--coverage") {
  const positional = argv.slice(1).filter((value) => !value.startsWith("--"))
  const base = flagValue("--base")
  if (positional.length < 2 || base === undefined) {
    console.error("usage: bun scripts/plugin-integrity.ts --coverage <manifest.toml> <mf-manifest.json> --base <https://…/>")
    process.exit(2)
  }
  const [manifestPath, metadataPath] = positional
  const parsed = parseFrontendPluginManifest(readFileSync(manifestPath, "utf8"), { baseUrl: base })
  if (!parsed.ok) {
    console.error("清单读不过：" + parsed.issues.map((issue) => `${issue.field}: ${issue.message}`).join("；"))
    process.exit(1)
  }
  const artifacts = classifyPluginArtifacts(parsed.manifest.frontend.entry, JSON.parse(readFileSync(metadataPath, "utf8")))
  const coverage = describePinCoverage({
    integrity: parsed.manifest.frontend.integrity,
    allowedOrigins: parsed.manifest.frontend.allowedOrigins,
    artifacts,
  })

  console.log(`entry ${parsed.manifest.frontend.entry}`)
  console.log(`本次会抓 ${artifacts.length} 份，其中 runtime 亲自取回（pin 有效）的 ${coverage.enforceableArtifactCount} 份`)
  // Digests are a convenience, so a deployment origin that is not up right now must not stop the
  // coverage answer: one probe decides whether to hash, and the report says which half it gave up on.
  const reachable = coverage.unpinnedArtifacts.length > 0 ? await isReachable(coverage.unpinnedArtifacts[0]!) : false
  for (const url of coverage.unpinnedArtifacts) {
    console.log(`没钉\t${url}\t${reachable ? `sha384-${await sriOfUrl(url)}` : "（摘要未取：部署 origin 现在连不上）"}`)
  }
  for (const url of coverage.unenforceableArtifacts) console.log(`钉了也没用\t${url}`)
  for (const pin of coverage.ineffectivePins) console.log(`空转pin\t${pin.url}\t${pin.reason}`)
  if (coverage.unpinnedArtifacts.length === 0 && coverage.ineffectivePins.length === 0) {
    console.log("pin 已覆盖 runtime 会取回的全部产物；未覆盖的那几类见上『钉了也没用』。")
  }
  process.exit(0)
}

const urls = argv.filter((value) => !value.startsWith("--"))

function flagValue(name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

async function isReachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: "HEAD" })).ok
  } catch {
    return false
  }
}

async function sriOfUrl(url: string): Promise<string> {
  // Fetched, not read locally: the host compares the bytes it will download, and a local file can
  // differ from what the deployment origin serves (minified on publish, re-hashed by a CDN).
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
  const digest = await crypto.subtle.digest("SHA-384", bytes)
  let binary = ""
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return Buffer.from(binary, "binary").toString("base64")
}


if (urls.length === 0) {
  console.error("usage: bun scripts/plugin-integrity.ts <resource-url> [...]")
  // Spelled here because the two consumers do not use the same separator, and guessing costs a failed
  // install: stdout is one `url<TAB>sha384-…` line per argument. The manifest wants the pair as a TOML
  // entry under `[frontend.integrity]`; the dev install page wants `url|sha384-…` (a pipe, not a tab).
  console.error("输出：每个 URL 一行 `url<TAB>sha384-…`。")
  console.error("清单里写成  \"<url>\" = \"sha384-…\"  （[frontend.integrity] 表）；")
  console.error("dev 页写成  &pin=<url>|<sha384-…>  （竖线，不是制表符）。")
  process.exit(2)
}

async function sriFor(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  const digest = await globalThis.crypto.subtle.digest("SHA-384", await response.arrayBuffer())
  let binary = ""
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return `sha384-${Buffer.from(binary, "binary").toString("base64")}`
}

for (const url of urls) {
  try {
    console.log(`${url}\t${await sriFor(url)}`)
  } catch (error) {
    console.error(`${url}\tFAILED\t${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
