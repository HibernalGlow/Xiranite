#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { access, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { availableParallelism } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import {
  loadXlchemyCorpusManifest,
  verifyXlchemyOutputs,
  verifyXlchemySources,
} from "./lib/xlchemy-large-batch-corpus.js"
import {
  ProcessTreeSampler,
  round,
  type ProcessTreeSample,
} from "./lib/runtime-benchmark-metrics.js"

interface Options {
  referenceRoot: string
  workspace: string
  count: number
  minimumShortSide: number
  minimumLongSide: number
  threads: number
  quality: number
  runs: number
  timeoutMinutes: number
}

interface ReferenceEvent {
  type: "started" | "finished"
  run: number
  timestampMs: number
  elapsedMs?: number
  converted?: number
  errors?: number
  heapAllocBytes?: number
  heapSysBytes?: number
  sysBytes?: number
}

const MIB = 1024 * 1024
const EVENT_PREFIX = "XIRANITE_REFERENCE_EVENT "
const options = parseOptions(process.argv.slice(2))
await access(options.referenceRoot)
const manifest = await loadXlchemyCorpusManifest(
  options.workspace,
  options.count,
  options.minimumShortSide,
  options.minimumLongSide,
)
const artifactRoot = join(options.workspace, "go-reference")
const outputRoot = join(artifactRoot, "output")
const overlaySourcePath = join(artifactRoot, "xlchemy_acceptance_overlay_test.go")
const overlayPath = join(artifactRoot, "overlay.json")
const testBinary = join(artifactRoot, "xlchemy-reference-acceptance.test.exe")
const samplingReadyPath = join(artifactRoot, "sampling-ready")
const sourceDll = process.env.SLIMG_CFFI_PATH?.trim() || "C:\\Windows\\System32\\slimg_cffi.dll"
const testDll = join(artifactRoot, "slimg_cffi.dll")
await mkdir(outputRoot, { recursive: true })
await rm(samplingReadyPath, { force: true })
await copyFile(sourceDll, testDll)

const sourcePreflight = await verifyXlchemySources(manifest.entries, "go-reference-preflight")
assertVerified(sourcePreflight, "Go reference source preflight")
await writeJson(join(artifactRoot, "source-preflight.json"), sourcePreflight)
await writeFile(overlaySourcePath, goReferenceOverlaySource())
const syntheticTestPath = join(options.referenceRoot, "xlchemy_acceptance_overlay_test.go")
await writeJson(overlayPath, { Replace: { [syntheticTestPath]: overlaySourcePath } })

const goExecutable = Bun.which("go")
if (!goExecutable) throw new Error("Go is required to build the XLchemy reference baseline.")
await runChecked([
  goExecutable,
  "test",
  "-c",
  "-p",
  "1",
  "-overlay",
  overlayPath,
  "-o",
  testBinary,
  ".",
], options.referenceRoot, options.timeoutMinutes)

const child = Bun.spawn([
  testBinary,
  "-test.run",
  "^TestXiraniteXLchemyReference$",
  "-test.v",
], {
  cwd: options.referenceRoot,
  env: {
    ...process.env,
    XIRANITE_XLCHEMY_REFERENCE_MANIFEST: join(options.workspace, "corpus-manifest.json"),
    XIRANITE_XLCHEMY_REFERENCE_OUTPUT: outputRoot,
    XIRANITE_XLCHEMY_REFERENCE_THREADS: String(options.threads),
    XIRANITE_XLCHEMY_REFERENCE_QUALITY: String(options.quality),
    XIRANITE_XLCHEMY_REFERENCE_RUNS: String(options.runs),
    XIRANITE_XLCHEMY_REFERENCE_SAMPLING_READY: samplingReadyPath,
  },
  stdout: "pipe",
  stderr: "pipe",
})
const sampler = new ProcessTreeSampler(child.pid, 500, { refreshTreeIntervalMs: 0 })
sampler.start()
try {
  await sampler.waitForFirstSample()
  await writeFile(samplingReadyPath, "ready\n")
} catch (error) {
  child.kill()
  await child.exited.catch(() => undefined)
  await sampler.stop()
  throw error
}
const stdoutPromise = new Response(child.stdout).text()
const stderrPromise = new Response(child.stderr).text()
const timeout = setTimeout(() => child.kill(), options.timeoutMinutes * 60_000)
const [stdout, stderr, exitCode] = await Promise.all([stdoutPromise, stderrPromise, child.exited])
clearTimeout(timeout)
const processTree = await sampler.stop()
const samples = sampler.samples()
await writeFile(join(artifactRoot, "reference-stdout.log"), stdout)
await writeFile(join(artifactRoot, "reference-stderr.log"), stderr)
await writeSamples(join(artifactRoot, "reference-samples.ndjson"), samples)
if (exitCode !== 0) throw new Error(`Go reference baseline exited with ${exitCode}: ${stderr.trim() || stdout.trim()}`)

const events = parseReferenceEvents(stdout)
const runs = pairReferenceRuns(events, samples, manifest.entries.length)
if (runs.length !== options.runs) throw new Error(`Go reference emitted ${runs.length} completed run(s); expected ${options.runs}.`)
const outputVerification = await verifyXlchemyOutputs(manifest.entries, outputRoot)
assertVerified(outputVerification, "Go reference output verification")
await writeJson(join(artifactRoot, "output-verification.json"), outputVerification)
const sourcePostflight = await verifyXlchemySources(manifest.entries, "go-reference-postflight")
assertVerified(sourcePostflight, "Go reference source postflight")
await writeJson(join(artifactRoot, "source-postflight.json"), sourcePostflight)

const warmedRuns = runs.length > 1 ? runs.slice(1) : runs
const warmedThroughput = warmedRuns.map((run) => run.imagesPerSecond).sort((left, right) => left - right)
const referenceCommit = await commandOutput("git", ["-C", options.referenceRoot, "rev-parse", "HEAD"])
const dllStat = await stat(testDll)
const summary = {
  schemaVersion: 1,
  completedAt: new Date().toISOString(),
  reference: { root: options.referenceRoot, commit: referenceCommit },
  corpus: {
    root: manifest.corpusRoot,
    count: manifest.entries.length,
    manifestPath: join(options.workspace, "corpus-manifest.json"),
    manifestSha256: await hashFile(join(options.workspace, "corpus-manifest.json")),
  },
  configuration: { threads: options.threads, quality: options.quality, runs: options.runs },
  runtime: { goVersion: await commandOutput(goExecutable, ["version"]), logicalProcessors: availableParallelism() },
  slimg: { sourcePath: sourceDll, testPath: testDll, sizeBytes: dllStat.size, sha256: await hashFile(testDll) },
  processTree,
  runs,
  warmedMedian: {
    runCount: warmedRuns.length,
    medianImagesPerSecond: round(percentile(warmedThroughput, 0.5)),
    medianElapsedMs: round(percentile(warmedRuns.map((run) => run.elapsedMs).sort((left, right) => left - right), 0.5)),
    medianPeakPrivateMiB: round(percentile(warmedRuns.map((run) => run.peakPrivateMiB).sort((left, right) => left - right), 0.5)),
  },
  outputVerification,
  sourcePreflight,
  sourcePostflight,
}
await writeJson(join(artifactRoot, "summary.json"), summary)
process.stdout.write(`[xlchemy-reference] acceptance baseline passed: ${join(artifactRoot, "summary.json")}\n`)

function pairReferenceRuns(events: ReferenceEvent[], samples: ProcessTreeSample[], expectedCount: number) {
  return events.filter((event) => event.type === "finished").map((finished) => {
    const started = events.find((event) => event.type === "started" && event.run === finished.run)
    if (!started || !finished.elapsedMs || finished.converted !== expectedCount || (finished.errors ?? 0) !== 0) {
      throw new Error(`Invalid Go reference run ${finished.run}: ${JSON.stringify({ started, finished })}`)
    }
    const covered = samples.filter((sample) => sample.timestampMs >= started.timestampMs && sample.timestampMs <= finished.timestampMs)
    if (covered.length < 2) throw new Error(`Go reference run ${finished.run} has only ${covered.length} process sample(s).`)
    const gaps = covered.slice(1).map((sample, index) => sample.timestampMs - covered[index]!.timestampMs)
    const maximumGapMs = Math.max(finished.timestampMs - covered.at(-1)!.timestampMs, covered[0]!.timestampMs - started.timestampMs, ...gaps)
    if (maximumGapMs > 1_000) throw new Error(`Go reference run ${finished.run} process sampling gap reached ${maximumGapMs} ms.`)
    const first = covered[0]!
    const last = covered.at(-1)!
    const sampledElapsedMs = Math.max(1, last.timestampMs - first.timestampMs)
    const sampledCpuMs = Math.max(0, last.cpu100ns - first.cpu100ns) / 10_000
    return {
      run: finished.run,
      classification: finished.run === 1 ? "cold runtime / warm filesystem" : "warm runtime / warm filesystem",
      startedAt: new Date(started.timestampMs).toISOString(),
      finishedAt: new Date(finished.timestampMs).toISOString(),
      elapsedMs: finished.elapsedMs,
      converted: finished.converted,
      errors: finished.errors,
      imagesPerSecond: round(expectedCount / (finished.elapsedMs / 1_000)),
      peakPrivateMiB: round(Math.max(...covered.map((sample) => sample.privateBytes)) / MIB),
      peakRssMiB: round(Math.max(...covered.map((sample) => sample.rssBytes)) / MIB),
      averageActiveCores: round(sampledCpuMs / sampledElapsedMs),
      maximumSamplingGapMs: maximumGapMs,
      goHeapAllocMiB: round((finished.heapAllocBytes ?? 0) / MIB),
      goHeapSysMiB: round((finished.heapSysBytes ?? 0) / MIB),
      goSysMiB: round((finished.sysBytes ?? 0) / MIB),
    }
  })
}

function parseReferenceEvents(stdout: string): ReferenceEvent[] {
  return stdout.split(/\r?\n/).flatMap((line) => {
    const marker = line.indexOf(EVENT_PREFIX)
    return marker < 0 ? [] : [JSON.parse(line.slice(marker + EVENT_PREFIX.length)) as ReferenceEvent]
  })
}

async function runChecked(command: string[], cwd: string, timeoutMinutes: number): Promise<void> {
  process.stdout.write(`[xlchemy-reference] ${command.join(" ")}\n`)
  const child = Bun.spawn(command, { cwd, stdout: "inherit", stderr: "inherit" })
  const timeout = setTimeout(() => child.kill(), timeoutMinutes * 60_000)
  const exitCode = await child.exited
  clearTimeout(timeout)
  if (exitCode !== 0) throw new Error(`${command[0]} exited with ${exitCode}.`)
}

async function commandOutput(command: string, args: string[]): Promise<string> {
  const child = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${stderr.trim()}`)
  return stdout.trim()
}

async function hashFile(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex")
}

function assertVerified(result: { expected: number; verified: number; errors: string[] }, label: string): void {
  if (result.verified !== result.expected || result.errors.length) throw new Error(`${label} failed: ${JSON.stringify(result.errors.slice(0, 20))}`)
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!
}

async function writeSamples(path: string, samples: readonly unknown[]): Promise<void> {
  await writeFile(path, samples.map((sample) => JSON.stringify(sample)).join("\n") + (samples.length ? "\n" : ""))
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseOptions(argv: string[]): Options {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      "reference-root": { type: "string" },
      workspace: { type: "string" },
      count: { type: "string", default: "10000" },
      "minimum-short-side": { type: "string", default: "1080" },
      "minimum-long-side": { type: "string", default: "1920" },
      threads: { type: "string", default: "16" },
      quality: { type: "string", default: "60" },
      runs: { type: "string", default: "4" },
      "timeout-minutes": { type: "string", default: "360" },
    },
  })
  if (!parsed.values["reference-root"] || !parsed.values.workspace) throw new Error("--reference-root and --workspace are required.")
  return {
    referenceRoot: resolve(parsed.values["reference-root"]),
    workspace: resolve(parsed.values.workspace),
    count: positiveInteger(parsed.values.count, "--count"),
    minimumShortSide: positiveInteger(parsed.values["minimum-short-side"], "--minimum-short-side"),
    minimumLongSide: positiveInteger(parsed.values["minimum-long-side"], "--minimum-long-side"),
    threads: positiveInteger(parsed.values.threads, "--threads"),
    quality: boundedInteger(parsed.values.quality, "--quality", 0, 100),
    runs: positiveInteger(parsed.values.runs, "--runs"),
    timeoutMinutes: positiveInteger(parsed.values["timeout-minutes"], "--timeout-minutes"),
  }
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`)
  return parsed
}

function boundedInteger(value: string | undefined, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`)
  return parsed
}

function goReferenceOverlaySource(): string {
  return String.raw`package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type xiraniteAcceptanceEntry struct {
	CorpusPath string ` + "`json:\"corpusPath\"`" + `
}

type xiraniteAcceptanceManifest struct {
	Entries []xiraniteAcceptanceEntry ` + "`json:\"entries\"`" + `
}

type xiraniteAcceptanceEvent struct {
	Type           string ` + "`json:\"type\"`" + `
	Run            int    ` + "`json:\"run\"`" + `
	TimestampMs    int64  ` + "`json:\"timestampMs\"`" + `
	ElapsedMs      int64  ` + "`json:\"elapsedMs,omitempty\"`" + `
	Converted      int64  ` + "`json:\"converted,omitempty\"`" + `
	Errors         int64  ` + "`json:\"errors,omitempty\"`" + `
	HeapAllocBytes uint64 ` + "`json:\"heapAllocBytes,omitempty\"`" + `
	HeapSysBytes   uint64 ` + "`json:\"heapSysBytes,omitempty\"`" + `
	SysBytes       uint64 ` + "`json:\"sysBytes,omitempty\"`" + `
}

func TestXiraniteXLchemyReference(t *testing.T) {
	waitForAcceptanceGate(t, requiredAcceptanceEnv("XIRANITE_XLCHEMY_REFERENCE_SAMPLING_READY"))
	manifestBytes, err := os.ReadFile(requiredAcceptanceEnv("XIRANITE_XLCHEMY_REFERENCE_MANIFEST"))
	if err != nil { t.Fatal(err) }
	var manifest xiraniteAcceptanceManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil { t.Fatal(err) }
	outputRoot := requiredAcceptanceEnv("XIRANITE_XLCHEMY_REFERENCE_OUTPUT")
	threads := acceptanceInteger(t, "XIRANITE_XLCHEMY_REFERENCE_THREADS")
	quality := acceptanceNonNegativeInteger(t, "XIRANITE_XLCHEMY_REFERENCE_QUALITY")
	runs := acceptanceInteger(t, "XIRANITE_XLCHEMY_REFERENCE_RUNS")
	if err := os.MkdirAll(outputRoot, 0755); err != nil { t.Fatal(err) }

	for run := 1; run <= runs; run++ {
		startedAt := time.Now()
		emitAcceptanceEvent(xiraniteAcceptanceEvent{Type: "started", Run: run, TimestampMs: startedAt.UnixMilli()})
		var converted atomic.Int64
		var errorCount atomic.Int64
		var firstError error
		var firstErrorOnce sync.Once
		semaphore := make(chan struct{}, threads)
		var workers sync.WaitGroup
		for _, entry := range manifest.Entries {
			semaphore <- struct{}{}
			workers.Add(1)
			go func(item xiraniteAcceptanceEntry) {
				defer func() { <-semaphore; workers.Done() }()
				if err := convertAcceptanceImage(item.CorpusPath, outputRoot, quality); err != nil {
					errorCount.Add(1)
					firstErrorOnce.Do(func() { firstError = err })
					return
				}
				converted.Add(1)
			}(entry)
		}
		workers.Wait()
		finishedAt := time.Now()
		var memory runtime.MemStats
		runtime.ReadMemStats(&memory)
		emitAcceptanceEvent(xiraniteAcceptanceEvent{
			Type: "finished", Run: run, TimestampMs: finishedAt.UnixMilli(), ElapsedMs: finishedAt.Sub(startedAt).Milliseconds(),
			Converted: converted.Load(), Errors: errorCount.Load(), HeapAllocBytes: memory.HeapAlloc, HeapSysBytes: memory.HeapSys, SysBytes: memory.Sys,
		})
		if firstError != nil { t.Fatalf("run %d failed after %d conversion error(s): %v", run, errorCount.Load(), firstError) }
	}
}

func waitForAcceptanceGate(t *testing.T, gatePath string) {
	deadline := time.Now().Add(30 * time.Second)
	for {
		if _, err := os.Stat(gatePath); err == nil { return }
		if time.Now().After(deadline) { t.Fatal("process sampler did not become ready") }
		time.Sleep(25 * time.Millisecond)
	}
}

func convertAcceptanceImage(sourcePath, outputRoot string, quality int) error {
	decoded, err := SlimgDecodeFile(sourcePath)
	if err != nil { return err }
	encoded, err := SlimgConvert(decoded.Pixels, decoded.Width, decoded.Height, SlimgFormatAvif, uint8(quality))
	if err != nil { return err }
	base := strings.TrimSuffix(filepath.Base(sourcePath), filepath.Ext(sourcePath))
	return os.WriteFile(filepath.Join(outputRoot, base+".avif"), encoded.Data, 0644)
}

func emitAcceptanceEvent(event xiraniteAcceptanceEvent) {
	encoded, _ := json.Marshal(event)
	fmt.Printf("XIRANITE_REFERENCE_EVENT %s\\n", encoded)
}

func requiredAcceptanceEnv(name string) string {
	value := os.Getenv(name)
	if value == "" { panic(name + " is required") }
	return value
}

func acceptanceInteger(t *testing.T, name string) int {
	value, err := strconv.Atoi(requiredAcceptanceEnv(name))
	if err != nil || value < 1 { t.Fatalf("invalid %s", name) }
	return value
}

func acceptanceNonNegativeInteger(t *testing.T, name string) int {
	value, err := strconv.Atoi(requiredAcceptanceEnv(name))
	if err != nil || value < 0 { t.Fatalf("invalid %s", name) }
	return value
}
`
}
