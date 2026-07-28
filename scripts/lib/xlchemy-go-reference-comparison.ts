import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export interface XlchemyGoReferenceSummary {
  schemaVersion: number
  reference: { commit: string }
  corpus: { root: string; count: number; manifestSha256: string }
  configuration: { threads: number; quality: number; runs: number }
  slimg: { sha256: string }
  processTree: { available: boolean; samples: number }
  runs: Array<{ run: number; converted: number; errors?: number; maximumSamplingGapMs: number }>
  warmedMedian: { runCount: number; medianImagesPerSecond: number; medianPeakPrivateMiB: number }
  outputVerification: VerificationEvidence
  sourcePreflight: VerificationEvidence
  sourcePostflight: VerificationEvidence
}

interface VerificationEvidence { expected: number; verified: number; errors: string[] }

export interface XlchemyWarmedSummary {
  medianImagesPerSecond: number
  medianPeakPrivateMiB: number
}

interface ReferenceExpectation {
  summaryPath: string
  workspace: string
  corpusRoot: string
  corpusCount: number
  threads: number
  quality: number
  runs: number
  slimgSha256: string
}

const GO_REFERENCE_COMMIT = "75f58f97c8f9e6a4fb3749fe37f958f986893707"

export async function loadXlchemyGoReferenceSummary(expectation: ReferenceExpectation): Promise<XlchemyGoReferenceSummary> {
  const summary = JSON.parse(await readFile(expectation.summaryPath, "utf8")) as XlchemyGoReferenceSummary
  const manifestSha256 = createHash("sha256").update(await readFile(join(expectation.workspace, "corpus-manifest.json"))).digest("hex")
  if (summary.schemaVersion !== 1
    || summary.reference.commit !== GO_REFERENCE_COMMIT
    || resolve(summary.corpus.root).toLocaleLowerCase("en-US") !== resolve(expectation.corpusRoot).toLocaleLowerCase("en-US")
    || summary.corpus.count !== expectation.corpusCount
    || summary.corpus.manifestSha256 !== manifestSha256
    || summary.slimg.sha256 !== expectation.slimgSha256
    || summary.configuration.threads !== expectation.threads
    || summary.configuration.quality !== expectation.quality
    || summary.configuration.runs !== expectation.runs
    || summary.processTree.available !== true
    || summary.processTree.samples < 2
    || !validRuns(summary.runs, expectation.runs, expectation.corpusCount)
    || summary.warmedMedian.runCount !== Math.max(1, expectation.runs - 1)
    || !(summary.warmedMedian.medianImagesPerSecond > 0)) {
    throw new Error(`Go reference summary does not match this corpus and conversion configuration: ${expectation.summaryPath}`)
  }
  for (const [label, evidence] of [["outputs", summary.outputVerification], ["source preflight", summary.sourcePreflight], ["source postflight", summary.sourcePostflight]] as const) {
    if (!validVerification(evidence, expectation.corpusCount)) throw new Error(`Go reference ${label} evidence is incomplete: ${expectation.summaryPath}`)
  }
  return summary
}

export function compareXlchemyGoReference(warmed: XlchemyWarmedSummary, reference: XlchemyGoReferenceSummary) {
  const ratio = warmed.medianImagesPerSecond / reference.warmedMedian.medianImagesPerSecond
  const allowedMinimum = reference.warmedMedian.medianImagesPerSecond * 0.95
  if (warmed.medianImagesPerSecond < allowedMinimum) {
    throw new Error(`Xiranite warmed throughput ${warmed.medianImagesPerSecond} images/s is ${(ratio * 100).toFixed(2)}% of the Go reference ${reference.warmedMedian.medianImagesPerSecond} images/s; gate is 95%.`)
  }
  return {
    xiraniteMedianImagesPerSecond: warmed.medianImagesPerSecond,
    goReferenceMedianImagesPerSecond: reference.warmedMedian.medianImagesPerSecond,
    throughputRatio: round(ratio),
    xiraniteMedianPeakPrivateMiB: warmed.medianPeakPrivateMiB,
    goReferenceMedianPeakPrivateMiB: reference.warmedMedian.medianPeakPrivateMiB,
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function validRuns(runs: XlchemyGoReferenceSummary["runs"], expectedRuns: number, expectedCount: number): boolean {
  return Array.isArray(runs)
    && runs.length === expectedRuns
    && runs.every((run, index) => run.run === index + 1 && run.converted === expectedCount && (run.errors ?? 0) === 0 && run.maximumSamplingGapMs <= 1_000)
}

function validVerification(evidence: VerificationEvidence | undefined, expectedCount: number): boolean {
  return evidence?.expected === expectedCount && evidence.verified === expectedCount && Array.isArray(evidence.errors) && evidence.errors.length === 0
}
