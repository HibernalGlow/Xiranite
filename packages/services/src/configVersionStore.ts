import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getNodeConfig, parseToml, stringifyXiraniteConfig, type XiraniteConfig } from "@xiranite/config"
import { create, type Delta } from "jsondiffpatch"
import PQueue from "p-queue"
import { simpleGit, type SimpleGit } from "simple-git"

const SNAPSHOT_FILENAME = "xiranite.config.toml"
const REDACTED = "[REDACTED]"
const SENSITIVE_KEY = /(?:^|_)(?:api_?key|auth|credential|password|private_?key|secret|token)(?:$|_)/i

export interface ConfigVersionRecordInput {
  nodeId: string
  source: string
  before: XiraniteConfig
  after: XiraniteConfig
  message?: string
  fields?: string[]
  force?: boolean
}

export interface ConfigVersion {
  revision: string
  nodeId: string
  source: string
  message: string
  createdAt: string
  fields: string[]
}

export interface ConfigVersionDetail extends ConfigVersion {
  before: unknown
  after: unknown
  delta: Delta | undefined
  patch: string
}

export interface ConfigVersionStore {
  record(input: ConfigVersionRecordInput): Promise<ConfigVersion | null>
  listNode(nodeId: string, options?: { limit?: number }): Promise<ConfigVersion[]>
  inspectNode(nodeId: string, revision: string): Promise<ConfigVersionDetail>
  getRepositoryStatus(): Promise<ConfigHistoryRepositoryStatus>
  setRemote(url: string | null): Promise<ConfigHistoryRepositoryStatus>
  sync(direction: "pull" | "push"): Promise<ConfigHistoryRepositoryStatus>
}

export interface ConfigHistoryRepositoryStatus {
  path: string
  branch: string
  remoteUrl: string | null
}

export interface GitConfigVersionStoreOptions {
  repositoryPath: string
  git?: SimpleGit
}

export class GitConfigVersionStore implements ConfigVersionStore {
  private readonly repositoryPath: string
  private readonly git: SimpleGit
  private readonly queue = new PQueue({ concurrency: 1 })
  private ready: Promise<void> | undefined
  private commitsSinceMaintenance = 0

  constructor(options: GitConfigVersionStoreOptions) {
    this.repositoryPath = options.repositoryPath
    this.git = options.git ?? simpleGit({
      config: [
        "user.name=Xiranite Config History",
        "user.email=config-history@xiranite.local",
      ],
      maxConcurrentProcesses: 4,
    })
  }

  record(input: ConfigVersionRecordInput): Promise<ConfigVersion | null> {
    return this.queue.add(async () => {
      await this.ensureRepository()
      const before = sanitizeConfig(input.before)
      const after = sanitizeConfig(input.after)
      const beforeText = stringifyXiraniteConfig(before as Record<string, unknown>)
      const afterText = stringifyXiraniteConfig(after as Record<string, unknown>)

      await this.ensureBaseline(beforeText)
      if (!input.force && beforeText === afterText) return null

      await writeFile(this.snapshotPath(), afterText, "utf8")
      const fields = input.fields ?? changedTopLevelFields(
        getNodeConfig(before, input.nodeId),
        getNodeConfig(after, input.nodeId),
      )
      const message = input.message ?? `config(${input.nodeId}): update settings`
      const commit = await this.git.commit(
        commitMessage(message, input.nodeId, input.source, fields),
        input.force ? { "--allow-empty": null } : { "--all": null },
      )
      this.commitsSinceMaintenance += 1
      if (this.commitsSinceMaintenance >= 32) {
        await this.git.raw(["gc", "--auto"])
        this.commitsSinceMaintenance = 0
      }
      return {
        revision: commit.commit,
        nodeId: input.nodeId,
        source: input.source,
        message,
        createdAt: new Date().toISOString(),
        fields,
      }
    })
  }

  listNode(nodeId: string, options: { limit?: number } = {}): Promise<ConfigVersion[]> {
    return this.queue.add(async () => {
      await this.ensureRepository()
      if (!(await this.hasHead())) return []
      const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 50)))
      const output = await this.git.raw([
        "log",
        `--max-count=${limit}`,
        "--fixed-strings",
        `--grep=Xiranite-Node: ${nodeId}`,
        "--format=%H%x00%cI%x00%s%x00%b%x1e",
      ])
      return parseLog(output).filter((version) => version.nodeId === nodeId)
    })
  }

  inspectNode(nodeId: string, revision: string): Promise<ConfigVersionDetail> {
    return this.queue.add(async () => {
      await this.ensureRepository()
      assertRevision(revision)
      const [metadataText, beforeText, afterText, patch] = await Promise.all([
        this.git.raw(["show", "-s", "--format=%H%x00%cI%x00%s%x00%b", revision]),
        this.git.show([`${revision}^:${SNAPSHOT_FILENAME}`]),
        this.git.show([`${revision}:${SNAPSHOT_FILENAME}`]),
        this.git.show(["--format=", "--unified=3", revision, "--", SNAPSHOT_FILENAME]),
      ])
      const metadata = parseLog(`${metadataText}\x1e`)[0]
      if (!metadata || metadata.nodeId !== nodeId) throw new Error(`Config revision does not belong to node: ${nodeId}`)
      const before = getNodeConfig(parseSnapshot(beforeText), nodeId)
      const after = getNodeConfig(parseSnapshot(afterText), nodeId)
      return {
        ...metadata,
        before,
        after,
        delta: create({ objectHash: objectIdentity }).diff(before, after),
        patch,
      }
    })
  }

  getRepositoryStatus(): Promise<ConfigHistoryRepositoryStatus> {
    return this.queue.add(async () => {
      await this.ensureRepository()
      return this.readRepositoryStatus()
    })
  }

  setRemote(url: string | null): Promise<ConfigHistoryRepositoryStatus> {
    return this.queue.add(async () => {
      await this.ensureRepository()
      const remotes = await this.git.getRemotes(true)
      const origin = remotes.find((remote) => remote.name === "origin")
      if (!url) {
        if (origin) await this.git.removeRemote("origin")
      } else if (origin) {
        await this.git.remote(["set-url", "origin", url])
      } else {
        await this.git.addRemote("origin", url)
      }
      return this.readRepositoryStatus()
    })
  }

  sync(direction: "pull" | "push"): Promise<ConfigHistoryRepositoryStatus> {
    return this.queue.add(async () => {
      await this.ensureRepository()
      const status = await this.readRepositoryStatus()
      if (!status.remoteUrl) throw new Error("Config history remote is not configured")
      if (direction === "pull") {
        await this.git.pull("origin", status.branch, { "--rebase": "true" })
      } else {
        await this.git.push("origin", status.branch, { "--set-upstream": null })
      }
      return this.readRepositoryStatus()
    })
  }

  private async ensureRepository(): Promise<void> {
    if (!this.ready) {
      this.ready = this.initializeRepository().catch((error) => {
        this.ready = undefined
        throw error
      })
    }
    return this.ready
  }

  private async initializeRepository(): Promise<void> {
    await mkdir(this.repositoryPath, { recursive: true })
    await this.git.cwd(this.repositoryPath)
    if (!(await this.git.checkIsRepo())) await this.git.init(false, { "--initial-branch": "main" })
  }

  private async ensureBaseline(content: string): Promise<void> {
    if (await this.hasHead()) {
      const tracked = await readFile(this.snapshotPath(), "utf8").catch(() => "")
      if (tracked === content) return
    }
    await writeFile(this.snapshotPath(), content, "utf8")
    await this.git.add(SNAPSHOT_FILENAME)
    await this.git.commit(commitMessage("config: record baseline", "__baseline__", "baseline", []))
  }

  private async hasHead(): Promise<boolean> {
    return this.git.revparse(["--verify", "HEAD"]).then(() => true, () => false)
  }

  private async readRepositoryStatus(): Promise<ConfigHistoryRepositoryStatus> {
    const branch = (await this.git.revparse(["--abbrev-ref", "HEAD"]).catch(() => "main")).trim() || "main"
    const remotes = await this.git.getRemotes(true)
    return {
      path: this.repositoryPath,
      branch,
      remoteUrl: remotes.find((remote) => remote.name === "origin")?.refs.fetch ?? null,
    }
  }

  private snapshotPath(): string {
    return join(this.repositoryPath, SNAPSHOT_FILENAME)
  }
}

export function mergeRedactedValues(historical: unknown, current: unknown): unknown {
  if (historical === REDACTED) return current
  if (Array.isArray(historical)) {
    const currentItems = Array.isArray(current) ? current : []
    return historical.map((value, index) => mergeRedactedValues(value, currentItems[index]))
  }
  if (isRecord(historical)) {
    const currentRecord = isRecord(current) ? current : {}
    return Object.fromEntries(Object.entries(historical).map(([key, value]) => [key, mergeRedactedValues(value, currentRecord[key])]))
  }
  return historical
}

function sanitizeConfig(value: XiraniteConfig): XiraniteConfig {
  return redactValue(value) as XiraniteConfig
}

function redactValue(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED
  if (Array.isArray(value)) return value.map((item) => redactValue(item))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactValue(child, childKey)]))
  return value
}

function changedTopLevelFields(before: unknown, after: unknown): string[] {
  const beforeRecord = isRecord(before) ? before : {}
  const afterRecord = isRecord(after) ? after : {}
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])
  return [...keys].filter((key) => JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key])).sort()
}

function commitMessage(message: string, nodeId: string, source: string, fields: string[]): string[] {
  return [message, `Xiranite-Node: ${nodeId}\nXiranite-Source: ${source}\nXiranite-Fields: ${fields.join(",")}`]
}

function parseLog(output: string): ConfigVersion[] {
  return output.split("\x1e").flatMap((record) => {
    const [revision, createdAt, message, body = ""] = record.trim().split("\x00")
    if (!revision || !createdAt || !message) return []
    return [{
      revision,
      createdAt,
      message,
      nodeId: trailer(body, "Xiranite-Node"),
      source: trailer(body, "Xiranite-Source"),
      fields: trailer(body, "Xiranite-Fields").split(",").filter(Boolean),
    }]
  })
}

function trailer(body: string, name: string): string {
  const prefix = `${name}: `
  return body.split(/\r?\n/).find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() ?? ""
}

function parseSnapshot(content: string): XiraniteConfig {
  return parseToml(content) as XiraniteConfig
}

function objectIdentity(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const id = value.id ?? value.key ?? value.name
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined
}

function assertRevision(revision: string): void {
  if (!/^[a-f\d]{7,40}$/i.test(revision)) throw new Error("Invalid config revision")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
