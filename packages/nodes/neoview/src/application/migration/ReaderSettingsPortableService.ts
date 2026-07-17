import type { ReaderSettingsMigrationCommitter, ReaderSettingsImportStrategy } from "./ReaderSettingsMigrationService.js"
import { ReaderSettingsPortableCodec, type ReaderSettingsPortablePayload } from "./ReaderSettingsPortableCodec.js"

export interface ReaderSettingsConfigReader {
  read(): Promise<Record<string, unknown>>
}

export interface ReaderSettingsPortableImportResult {
  payload: ReaderSettingsPortablePayload
  strategy: ReaderSettingsImportStrategy
  changed: boolean
  backupCreated: boolean
}

export interface ReaderSettingsBackupProvider {
  create(destinationPath: string, signal?: AbortSignal): Promise<{ manifest: unknown }>
  inspect(bundlePath: string, signal?: AbortSignal): Promise<{ manifest: unknown; settings: { omittedSensitivePaths: string[] }; database: { compatibility: string; quickCheck: "ok"; metadataVersion?: string; userVersion?: number } }>
}

export class ReaderSettingsPortableService {
  constructor(
    private readonly reader: ReaderSettingsConfigReader,
    private readonly committer?: ReaderSettingsMigrationCommitter,
    private readonly codec = new ReaderSettingsPortableCodec(),
    private readonly backupProvider?: ReaderSettingsBackupProvider,
  ) {}

  async export(): Promise<ReaderSettingsPortablePayload> {
    return this.codec.encode(await this.reader.read())
  }

  inspect(content: string): ReaderSettingsPortablePayload {
    return this.codec.decode(content)
  }

  async import(
    content: string,
    strategy: ReaderSettingsImportStrategy = "merge",
    confirmed = false,
  ): Promise<ReaderSettingsPortableImportResult> {
    if (!confirmed) throw new Error("Portable settings import requires explicit confirmation after inspection.")
    if (!this.committer) throw new Error("Portable settings import is not available in this runtime.")
    if (strategy !== "merge" && strategy !== "overwrite") throw new Error("Portable settings strategy must be merge or overwrite.")
    const payload = this.codec.decode(content)
    const committed = await this.committer.commit(payload.nodeConfig, strategy)
    return {
      payload,
      strategy,
      changed: committed.changed,
      backupCreated: Boolean(committed.backupPath),
    }
  }

  async backup(destinationPath: string, signal?: AbortSignal): Promise<{ manifest: unknown }> {
    if (!this.backupProvider) throw new Error("Reader backup is not available in this runtime.")
    return this.backupProvider.create(destinationPath, signal)
  }

  async inspectBackup(bundlePath: string, signal?: AbortSignal) {
    if (!this.backupProvider) throw new Error("Reader backup is not available in this runtime.")
    return this.backupProvider.inspect(bundlePath, signal)
  }

  withBackupProvider(provider: ReaderSettingsBackupProvider): ReaderSettingsPortableService {
    return new ReaderSettingsPortableService(this.reader, this.committer, this.codec, provider)
  }
}
