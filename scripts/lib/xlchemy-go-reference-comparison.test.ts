import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  compareXlchemyGoReference,
  loadXlchemyGoReferenceSummary,
  type XlchemyGoReferenceSummary,
} from "./xlchemy-go-reference-comparison.js"

const REFERENCE_COMMIT = "75f58f97c8f9e6a4fb3749fe37f958f986893707"

describe("XLchemy Go reference comparison", () => {
  test("accepts only the exact corpus, DLL, commit, and conversion configuration", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "xlchemy-reference-comparison-"))
    const manifest = "{\"schemaVersion\":2}\n"
    const summaryPath = join(workspace, "reference.json")
    const corpusRoot = join(workspace, "corpus")
    const summary = referenceSummary(corpusRoot, createHash("sha256").update(manifest).digest("hex"))
    try {
      await writeFile(join(workspace, "corpus-manifest.json"), manifest)
      await writeFile(summaryPath, JSON.stringify(summary))
      await expect(loadXlchemyGoReferenceSummary({
        summaryPath,
        workspace,
        corpusRoot,
        corpusCount: 10_000,
        threads: 16,
        quality: 60,
        runs: 4,
        slimgSha256: "same-dll",
      })).resolves.toEqual(summary)

      await writeFile(summaryPath, JSON.stringify({ ...summary, reference: { commit: "wrong" } }))
      await expect(loadXlchemyGoReferenceSummary({
        summaryPath,
        workspace,
        corpusRoot,
        corpusCount: 10_000,
        threads: 16,
        quality: 60,
        runs: 4,
        slimgSha256: "same-dll",
      })).rejects.toThrow("does not match")
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  test("rejects a warmed Bun median below 95 percent of the Go reference", () => {
    const reference = referenceSummary("D:/corpus", "manifest")
    expect(compareXlchemyGoReference({ medianImagesPerSecond: 95, medianPeakPrivateMiB: 900 }, reference)).toMatchObject({
      throughputRatio: 0.95,
    })
    expect(() => compareXlchemyGoReference({ medianImagesPerSecond: 94.99, medianPeakPrivateMiB: 900 }, reference)).toThrow("gate is 95%")
  })
})

function referenceSummary(corpusRoot: string, manifestSha256: string): XlchemyGoReferenceSummary {
  return {
    schemaVersion: 1,
    reference: { commit: REFERENCE_COMMIT },
    corpus: { root: corpusRoot, count: 10_000, manifestSha256 },
    configuration: { threads: 16, quality: 60, runs: 4 },
    slimg: { sha256: "same-dll" },
    processTree: { available: true, samples: 10 },
    runs: Array.from({ length: 4 }, (_, index) => ({ run: index + 1, converted: 10_000, errors: 0, maximumSamplingGapMs: 850 })),
    warmedMedian: { runCount: 3, medianImagesPerSecond: 100, medianPeakPrivateMiB: 1_000 },
    outputVerification: { expected: 10_000, verified: 10_000, errors: [] },
    sourcePreflight: { expected: 10_000, verified: 10_000, errors: [] },
    sourcePostflight: { expected: 10_000, verified: 10_000, errors: [] },
  }
}
