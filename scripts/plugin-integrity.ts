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

import { buildCoverageReport, fillDigests, parseCliRequest } from "./plugin-integrity-report.js"

const request = parseCliRequest(process.argv.slice(2))

if (request.kind === "error") {
  console.error(request.message)
  // Spelled here because the two destinations for a digest differ in separator, and guessing costs a
  // failed install: stdout is one `url<TAB>sha384-…` line per argument. The manifest wants the pair as
  // a TOML entry under `[frontend.integrity]`; the dev install page wants `url|sha384-…` (a pipe).
  console.error("输出：每个 URL 一行 `url<TAB>sha384-…`；清单里写 \"<url>\" = \"sha384-…\"（[frontend.integrity]），dev 页写 &pin=<url>|<sha384-…>。")
  process.exit(2)
}

if (request.kind === "coverage") {
  const report = buildCoverageReport({
    tomlText: readFileSync(request.manifestPath, "utf8"),
    metadataJson: readFileSync(request.metadataPath, "utf8"),
    base: request.base,
  })
  if (!report.ok) {
    console.error("清单读不过：" + report.issues.map((issue) => `${issue.field}: ${issue.message}`).join("；"))
    process.exit(1)
  }
  // Unreachable origin is answered, not thrown: a pre-publish check must not require the site to be
  // live already. Only the digest column gives up, and it says so.
  const lines = await fillDigests(report.report, report.unpinned, async (url) => {
    try {
      return await sriFor(url)
    } catch {
      return undefined
    }
  })
  console.log(lines.join("\n"))
  process.exit(0)
}

for (const url of request.urls) {
  try {
    console.log(`${url}\t${await sriFor(url)}`)
  } catch (error) {
    console.error(`${url}\tFAILED\t${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

async function sriFor(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  const digest = await globalThis.crypto.subtle.digest("SHA-384", await response.arrayBuffer())
  let binary = ""
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return `sha384-${Buffer.from(binary, "binary").toString("base64")}`
}
