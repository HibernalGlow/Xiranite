import { dirname, resolve } from "node:path"
import { resolveXiraniteConfigPath, type ResolveConfigPathOptions } from "@xiranite/config"

import { readNeoviewConfig } from "../config/NeoviewConfigStore.js"

export interface ReaderBackupScheduleConfig {
  enabled: boolean
  directory?: string
  intervalHours: number
  retainCount: number
}

export const DEFAULT_READER_BACKUP_SCHEDULE: Readonly<ReaderBackupScheduleConfig> = Object.freeze({
  enabled: false,
  intervalHours: 24,
  retainCount: 7,
})

export async function loadReaderBackupScheduleConfig(
  options: ResolveConfigPathOptions = {},
): Promise<ReaderBackupScheduleConfig> {
  const configPath = resolveXiraniteConfigPath(options)
  const nodeConfig = await readNeoviewConfig(options)
  return parseReaderBackupScheduleConfig(nodeConfig.backup, dirname(configPath))
}

export function parseReaderBackupScheduleConfig(value: unknown, baseDirectory: string): ReaderBackupScheduleConfig {
  if (value === undefined) return { ...DEFAULT_READER_BACKUP_SCHEDULE }
  const record = requireRecord(value, "[nodes.neoview.backup]")
  const enabled = optionalBoolean(record.enabled, "[nodes.neoview.backup].enabled") ?? false
  const intervalHours = boundedInteger(
    record.interval_hours,
    "[nodes.neoview.backup].interval_hours",
    6,
    720,
    DEFAULT_READER_BACKUP_SCHEDULE.intervalHours,
  )
  const retainCount = boundedInteger(
    record.retain_count,
    "[nodes.neoview.backup].retain_count",
    1,
    64,
    DEFAULT_READER_BACKUP_SCHEDULE.retainCount,
  )
  const directory = optionalDirectory(record.directory, baseDirectory)
  if (enabled && !directory) throw new Error("[nodes.neoview.backup].directory is required when automatic backups are enabled.")
  return { enabled, directory, intervalHours, retainCount }
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`)
  return value
}

function boundedInteger(value: unknown, path: string, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be an integer between ${minimum} and ${maximum}.`)
  }
  return value
}

function optionalDirectory(value: unknown, baseDirectory: string): string | undefined {
  if (value === undefined || value === "") return undefined
  if (typeof value !== "string" || !value.trim() || value.length > 1024 || value.includes("\0")) {
    throw new Error("[nodes.neoview.backup].directory must be a non-empty path without NUL.")
  }
  return resolve(baseDirectory, value.trim())
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be a table.`)
  return value as Record<string, unknown>
}
