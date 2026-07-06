#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Box, Text, useApp, useInput } from "ink"
import { createElement as h, useState } from "react"
import { canRunInkApp, defineCommand, nodeCliName, runInkApp, runMain, writeError, writeLine } from "@xiranite/cli-runtime"
import type { CliCommand, CliHost } from "@xiranite/cli-runtime"


import { filterLines, splitLines } from "./core.js"

const CLI_NAME = nodeCliName("linedup")

interface FilterOptions {
  source?: string
  sourceFile?: string
  filter?: string
  filterFile?: string
  outputFile?: string
  json?: boolean
  caseInsensitive?: boolean
  preserveOrder?: boolean
}

export const cli: CliCommand = {
  name: CLI_NAME,
  description: "Filter source lines by removing any line containing a filter token.",
  async run(args: string[], host: CliHost) {
    await runProgram(args, host)
  },
}

export const program = createProgram()

export async function runProgram(args = process.argv.slice(2), host: CliHost = createDefaultHost()): Promise<void> {
  if (args.length === 0) {
    await runGuided(host)
    return
  }

  await runMain(createProgram(host), { rawArgs: args })
}

function createDefaultHost(): CliHost {
  return {
  cwd: process.cwd(),
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  }
}

function createProgram(host: CliHost = createDefaultHost()) {
  return defineCommand({
    meta: {
      name: CLI_NAME,
      description: "Line filter with Typer-style commands and an Ink guided mode.",
    },
    subCommands: {
      filter: defineCommand({
        meta: {
          name: "filter",
          description: "Filter line content from inline strings or files.",
        },
        args: {
          source: { type: "string", description: "Inline source text. Use \\n for new lines." },
          sourceFile: { type: "string", description: "Source file path." },
          filter: { type: "string", description: "Inline filter text. Use \\n for new lines." },
          filterFile: { type: "string", description: "Filter file path." },
          outputFile: { type: "string", description: "Write kept lines to this file." },
          json: { type: "boolean", description: "Print JSON result." },
          caseInsensitive: { type: "boolean", description: "Match filters case-insensitively." },
          preserveOrder: { type: "boolean", description: "Preserve source order instead of sorting output." },
        },
        async run({ args }) {
          await runFilter(args as FilterOptions, host)
        },
      }),
      guided: defineCommand({
        meta: {
          name: "guided",
          description: "Open a rich terminal guided workflow.",
        },
        async run() {
          await runGuided(host)
        },
      }),
    },
  })
}

async function runGuided(host: CliHost): Promise<void> {
  if (!canRunInkApp(host)) {
    writeError(host, "Guided mode requires an interactive terminal. Use a subcommand such as `filter --help` for scripted use.")
    process.exitCode = 2
    return
  }

  await runInkApp(h(GuidedLinedupApp, { host }))
}

async function runFilter(options: FilterOptions, host: CliHost): Promise<void> {
  const sourceText = await readInput(options.source, options.sourceFile)
  const filterText = await readInput(options.filter, options.filterFile)

  if (!sourceText.trim()) {
    throw new Error("Missing source content. Use --source or --sourceFile, or run guided mode.")
  }

  const result = filterLines({
    sourceLines: splitLines(sourceText),
    filterLines: splitLines(filterText),
    caseSensitive: !options.caseInsensitive,
    sort: !options.preserveOrder,
  })

  if (options.outputFile) {
    await writeFile(options.outputFile, `${result.filteredLines.join("\n")}\n`, "utf8")
  }

  if (options.json) {
    writeLine(host, JSON.stringify(result, null, 2))
    return
  }

  writeLine(host, result.filteredLines.join("\n"))
  writeLine(host, `kept=${result.keptCount} removed=${result.removedCount}`)
}

async function readInput(inline?: string, filePath?: string): Promise<string> {
  if (filePath) {
    return readFile(filePath, "utf8")
  }
  return (inline ?? "").replace(/\\n/g, "\n")
}

function GuidedLinedupApp({ host }: { host: CliHost }) {
  const app = useApp()
  const [step, setStep] = useState<"sourceFile" | "filterFile" | "outputFile" | "done">("sourceFile")
  const [sourceFile, setSourceFile] = useState("")
  const [filterFile, setFilterFile] = useState("")
  const [outputFile, setOutputFile] = useState("")
  const [message, setMessage] = useState("Enter source file path.")
  const [result, setResult] = useState<Awaited<ReturnType<typeof runGuidedFilter>> | null>(null)

  async function submit(value: string) {
    if (step === "sourceFile") {
      setSourceFile(value)
      setStep("filterFile")
      setMessage("Enter filter file path.")
      return
    }

    if (step === "filterFile") {
      setFilterFile(value)
      setStep("outputFile")
      setMessage("Optional output file path. Press Enter to skip.")
      return
    }

    if (step === "outputFile") {
      setOutputFile(value)
      try {
        const next = await runGuidedFilter({ sourceFile, filterFile, outputFile: value || undefined })
        setResult(next)
        setMessage("Completed. Press q to exit.")
        setStep("done")
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error))
      }
    }
  }

  useInput((input) => {
    if (step === "done" && (input === "q" || input === "\u0003")) {
      app.exit()
      if (result?.outputFile) {
        writeLine(host, `saved ${result.outputFile}`)
      }
    }
  })

  return h(
    Box,
    { flexDirection: "column", gap: 1 },
    h(Text, { color: "cyan", bold: true }, "linedup guided"),
    h(Text, null, message),
    step !== "done" ? h(InputLine, { onSubmit: submit }) : null,
    result ? h(Summary, { result }) : null,
  )
}

async function runGuidedFilter(options: { sourceFile: string; filterFile: string; outputFile?: string }) {
  const sourceText = await readFile(options.sourceFile, "utf8")
  const filterText = await readFile(options.filterFile, "utf8")
  const result = filterLines({
    sourceLines: splitLines(sourceText),
    filterLines: splitLines(filterText),
  })

  if (options.outputFile) {
    await writeFile(options.outputFile, `${result.filteredLines.join("\n")}\n`, "utf8")
  }

  return { ...result, outputFile: options.outputFile }
}

function InputLine({ onSubmit }: { onSubmit: (value: string) => void | Promise<void> }) {
  const [value, setValue] = useState("")

  useInput((input, key) => {
    if (key.return) {
      void onSubmit(value.trim())
      setValue("")
      return
    }

    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1))
      return
    }

    if (!key.ctrl && input) {
      setValue((current) => current + input)
    }
  })

  return h(Text, null, "> ", value, h(Text, { inverse: true }, " "))
}

function Summary({ result }: { result: Awaited<ReturnType<typeof runGuidedFilter>> }) {
  return h(
    Box,
    { flexDirection: "column" },
    h(Text, { color: "green" }, `kept ${result.keptCount}`),
    h(Text, { color: "red" }, `removed ${result.removedCount}`),
    result.outputFile ? h(Text, { color: "gray" }, `output ${result.outputFile}`) : null,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runProgram()
}
