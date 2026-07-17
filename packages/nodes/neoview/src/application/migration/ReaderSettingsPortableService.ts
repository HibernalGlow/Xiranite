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

export class ReaderSettingsPortableService {
  constructor(
    private readonly reader: ReaderSettingsConfigReader,
    private readonly committer?: ReaderSettingsMigrationCommitter,
    private readonly codec = new ReaderSettingsPortableCodec(),
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
}
