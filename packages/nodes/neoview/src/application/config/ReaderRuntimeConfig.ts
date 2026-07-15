import { DEFAULT_READER_LAYOUT } from "../../domain/frame/frame.js"
import type { TailOverflowBehavior } from "../../domain/navigation/navigation.js"
import type { ReaderSessionOptions } from "../reader/contracts.js"

export interface NeoviewRuntimeConfig {
  schemaVersion: 1
  sessionOptions: Partial<ReaderSessionOptions>
}

export function parseNeoviewRuntimeConfig(value: unknown): NeoviewRuntimeConfig {
  if (value === undefined) return { schemaVersion: 1, sessionOptions: {} }
  const config = requireRecord(value, "[nodes.neoview]")
  const schemaVersion = config.schema_version ?? 1
  if (schemaVersion !== 1) throw new Error(`[nodes.neoview].schema_version must be 1, received ${String(schemaVersion)}.`)
  const reader = optionalRecord(config.reader, "[nodes.neoview.reader]")
  if (!reader) return { schemaVersion: 1, sessionOptions: {} }

  const direction = optionalEnum(
    reader.reading_direction ?? nestedValue(reader, "book", "reading_direction"),
    "[nodes.neoview.reader].reading_direction",
    ["left-to-right", "right-to-left"] as const,
  )
  const doublePage = optionalBoolean(
    reader.double_page_view ?? nestedValue(reader, "book", "double_page_view"),
    "[nodes.neoview.reader].double_page_view",
  )
  const tailOverflow = parseTailOverflow(
    reader.tail_overflow_behavior ?? nestedValue(reader, "book", "tail_overflow_behavior"),
  )

  return {
    schemaVersion: 1,
    sessionOptions: {
      direction,
      layout: doublePage === undefined
        ? undefined
        : { ...DEFAULT_READER_LAYOUT, pageMode: doublePage ? "double" : "single" },
      tailOverflow,
    },
  }
}

function parseTailOverflow(value: unknown): TailOverflowBehavior | undefined {
  if (value === undefined) return undefined
  const aliases: Readonly<Record<string, TailOverflowBehavior>> = {
    "do-nothing": "do-nothing",
    doNothing: "do-nothing",
    "stay-on-last-page": "stay-on-last-page",
    stayOnLastPage: "stay-on-last-page",
    "next-book": "next-book",
    nextBook: "next-book",
    loop: "loop",
    loopTopBottom: "loop",
    "seamless-loop": "seamless-loop",
    seamlessLoop: "seamless-loop",
  }
  if (typeof value !== "string" || !aliases[value]) {
    throw new Error("[nodes.neoview.reader].tail_overflow_behavior is invalid.")
  }
  return aliases[value]
}

function nestedValue(record: Record<string, unknown>, section: string, key: string): unknown {
  const nested = record[section]
  return isRecord(nested) ? nested[key] : undefined
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`)
  return value
}

function optionalEnum<const Values extends readonly string[]>(
  value: unknown,
  path: string,
  values: Values,
): Values[number] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${path} must be one of: ${values.join(", ")}.`)
  }
  return value as Values[number]
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  return requireRecord(value, path)
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be a table.`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
