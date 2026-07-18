import { LegacyBookSettingsCodec, type DecodedLegacyBookSettings } from "../../migration/LegacyBookSettingsCodec.js"
import { LegacyBookSettingsImporter, type LegacyBookSettingsImportResult } from "../../migration/LegacyBookSettingsImporter.js"

export interface ReaderBookSettingsMigrationInspection {
  report: DecodedLegacyBookSettings["report"]
}

export class ReaderBookSettingsMigrationService implements AsyncDisposable {
  #disposed = false

  constructor(
    private readonly importer: LegacyBookSettingsImporter,
    private readonly codec = new LegacyBookSettingsCodec(),
    private readonly disposeDependency?: () => void | Promise<void>,
  ) {}

  inspect(content: string): ReaderBookSettingsMigrationInspection {
    this.#assertActive()
    return { report: this.codec.decode(content).report }
  }

  async import(
    content: string,
    strategy: "merge" | "overwrite",
    confirmed: boolean,
    signal?: AbortSignal,
  ): Promise<LegacyBookSettingsImportResult> {
    this.#assertActive()
    if (!confirmed) throw new Error("Legacy book settings import requires explicit confirmation after inspection.")
    if (strategy !== "merge" && strategy !== "overwrite") throw new Error("Legacy book settings strategy must be merge or overwrite.")
    const decoded = this.codec.decode(content)
    signal?.throwIfAborted()
    return this.importer.import(decoded, strategy, signal)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    await this.disposeDependency?.()
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Reader book settings migration service is disposed.")
  }
}
