#!/usr/bin/env bun
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { startBackend, type StartBackendOptions } from "../packages/backend/src/index"

export const DEFAULT_TEST_BACKEND_TTL_SECONDS = 10 * 60
export const MAX_TEST_BACKEND_TTL_SECONDS = 60 * 60

export interface IsolatedTestBackend {
  backend: Awaited<ReturnType<typeof startBackend>>
  dataDir: string
  close(): Promise<void>
}

export interface TestBackendCliOptions {
  ttlSeconds: number
}

type IsolatedBackendOptions = Omit<
  StartBackendOptions,
  "configPath" | "dataDir" | "databaseAuthToken" | "databasePath" | "databaseUrl" | "legacyEmmDatabasePaths" | "legacyThumbnailDatabasePath" | "logDirectory"
>

export async function startIsolatedTestBackend(options: IsolatedBackendOptions = {}): Promise<IsolatedTestBackend> {
  const dataDir = await mkdtemp(join(tmpdir(), "xiranite-test-backend-"))
  let backend: Awaited<ReturnType<typeof startBackend>>
  try {
    backend = await startBackend({
      ...options,
      configPath: join(dataDir, "xiranite.config.toml"),
      dataDir,
      legacyEmmDatabasePaths: false,
      legacyThumbnailDatabasePath: false,
      logDirectory: join(dataDir, "logs"),
    })
  } catch (error) {
    await removeWithWindowsRetry(dataDir)
    throw error
  }

  let closePromise: Promise<void> | undefined
  return {
    backend,
    dataDir,
    close() {
      closePromise ??= (async () => {
        await backend.close()
        await removeWithWindowsRetry(dataDir)
      })()
      return closePromise
    },
  }
}

export function parseTestBackendCliOptions(argv: readonly string[]): TestBackendCliOptions {
  const { values } = parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      "ttl-seconds": { type: "string", default: String(DEFAULT_TEST_BACKEND_TTL_SECONDS) },
    },
  })
  const ttlSeconds = Number(values["ttl-seconds"])
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_TEST_BACKEND_TTL_SECONDS) {
    throw new Error(`--ttl-seconds must be an integer between 1 and ${MAX_TEST_BACKEND_TTL_SECONDS}.`)
  }
  return { ttlSeconds }
}

async function run(): Promise<void> {
  const options = parseTestBackendCliOptions(process.argv.slice(2))
  const isolated = await startIsolatedTestBackend()
  const { backend } = isolated
  try {
    process.stdout.write(`${JSON.stringify({
      pid: process.pid,
      baseUrl: backend.url,
      token: backend.token,
      dataDir: isolated.dataDir,
      expiresAt: new Date(Date.now() + options.ttlSeconds * 1000).toISOString(),
    })}\n`)

    let finish!: (reason: string) => void
    const finished = new Promise<string>((resolveFinished) => { finish = resolveFinished })
    const timer = setTimeout(() => finish("ttl expired"), options.ttlSeconds * 1000)
    timer.unref()
    process.once("SIGINT", () => finish("SIGINT"))
    process.once("SIGTERM", () => finish("SIGTERM"))

    const reason = await finished
    process.stderr.write(`[xiranite-test-backend] stopping: ${reason}\n`)
  } finally {
    await isolated.close()
  }
}

async function removeWithWindowsRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      await access(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      if (attempt === 7) throw error
    }
    await Bun.sleep(50 * (attempt + 1))
  }
}

if (import.meta.main) {
  await run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exit(1)
  })
}
