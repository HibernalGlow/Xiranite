import {
  LEGACY_SETTINGS_MODULES,
  LegacySettingsCodec,
  type DecodedLegacySettings,
  type LegacySettingsModule,
} from "../../migration/LegacySettingsCodec.js"

export type ReaderSettingsImportStrategy = "merge" | "overwrite"

export interface ReaderSettingsMigrationCommitReceipt {
  changed: boolean
  configPath?: string
  backupPath?: string
}

export interface ReaderSettingsMigrationCommitter {
  commit(
    patch: Record<string, unknown>,
    strategy: ReaderSettingsImportStrategy,
  ): Promise<ReaderSettingsMigrationCommitReceipt>
}

export interface ReaderSettingsMigrationInput {
  content: string
  modules?: readonly string[]
}

export interface ReaderSettingsImportInput extends ReaderSettingsMigrationInput {
  strategy?: ReaderSettingsImportStrategy
  confirmed: boolean
}

export interface ReaderSettingsImportResult extends ReaderSettingsMigrationCommitReceipt {
  decoded: DecodedLegacySettings
  strategy: ReaderSettingsImportStrategy
}

const DEFAULT_MAX_INPUT_BYTES = 64 * 1024 * 1024

export class ReaderSettingsMigrationService {
  readonly #knownModules = new Set<string>(LEGACY_SETTINGS_MODULES)

  constructor(
    private readonly committer?: ReaderSettingsMigrationCommitter,
    private readonly codec = new LegacySettingsCodec(),
    private readonly maxInputBytes = DEFAULT_MAX_INPUT_BYTES,
  ) {
    if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) throw new TypeError("maxInputBytes must be a positive integer")
  }

  inspect(input: ReaderSettingsMigrationInput): DecodedLegacySettings {
    const modules = this.#validate(input)
    return this.codec.decode(input.content, { modules })
  }

  async import(input: ReaderSettingsImportInput): Promise<ReaderSettingsImportResult> {
    const strategy = input.strategy ?? "merge"
    return this.commit(this.inspect(input), strategy, input.confirmed)
  }

  async commit(
    decoded: DecodedLegacySettings,
    strategy: ReaderSettingsImportStrategy = "merge",
    confirmed = false,
  ): Promise<ReaderSettingsImportResult> {
    if (!confirmed) throw new Error("Settings import requires explicit confirmation after inspection.")
    if (!this.committer) throw new Error("Settings import is not available in this runtime.")
    if (strategy !== "merge" && strategy !== "overwrite") throw new Error("Settings import strategy must be merge or overwrite.")
    const receipt = await this.committer.commit(decoded.configPatch, strategy)
    return { ...receipt, decoded, strategy }
  }

  #validate(input: ReaderSettingsMigrationInput): LegacySettingsModule[] | undefined {
    if (typeof input.content !== "string") throw new TypeError("Settings migration content must be a string.")
    const inputBytes = Buffer.byteLength(input.content, "utf8")
    if (inputBytes > this.maxInputBytes) throw new Error(`Settings migration input exceeds ${this.maxInputBytes} bytes.`)
    if (input.modules === undefined) return undefined
    if (!Array.isArray(input.modules) || input.modules.length < 1 || input.modules.length > LEGACY_SETTINGS_MODULES.length) {
      throw new Error("Settings migration modules must contain 1..13 entries.")
    }
    const modules = input.modules.map((module) => {
      if (typeof module !== "string" || !this.#knownModules.has(module)) throw new Error(`Unknown settings module: ${String(module)}.`)
      return module as LegacySettingsModule
    })
    if (new Set(modules).size !== modules.length) throw new Error("Settings migration modules must be unique.")
    return modules
  }
}
