/**
 * Prints the SRI pins for plugin resources so an installer can paste them into a manifest.
 *
 *   bun scripts/plugin-integrity.ts http://127.0.0.1:4176/mf-manifest.json http://127.0.0.1:4176/remoteEntry.js
 *
 * Exists because `@module-federation/runtime` has no integrity concept to reuse (§6 第 5 条), so the
 * hash has to be produced by someone. Standard Node syntax with the global `fetch`/`crypto` — no Bun
 * APIs (ADR-0075).
 */

import process from "node:process"

const urls = process.argv.slice(2).filter((value) => value.trim().length > 0)

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
