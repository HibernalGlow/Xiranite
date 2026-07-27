import type { ReaderSession } from "../../application/reader/contracts.js"
import type { ReaderPage } from "../../domain/page/page.js"
import { ArchivePageContent } from "../content/ArchivePageContent.js"
import {
  deleteZipArchiveEntry,
  type DeleteZipArchiveEntryRequest,
  type DeleteZipArchiveEntryResult,
} from "../archives/zip/ZipArchiveEntryDeletion.js"
import { jsonResponse } from "./ReaderHttpControllerHelpers.js"

export interface ReaderArchiveEntryDeleteHttpControllerOptions {
  enabled: boolean
  releaseSession(session: ReaderSession): Promise<void>
  deleteEntry?: (request: DeleteZipArchiveEntryRequest) => Promise<DeleteZipArchiveEntryResult>
}

export class ReaderArchiveEntryDeleteHttpController {
  readonly #deleteEntry: NonNullable<ReaderArchiveEntryDeleteHttpControllerOptions["deleteEntry"]>

  constructor(private readonly options: ReaderArchiveEntryDeleteHttpControllerOptions) {
    this.#deleteEntry = options.deleteEntry ?? deleteZipArchiveEntry
  }

  async delete(session: ReaderSession, page: ReaderPage, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    if (!isArchiveDeleteRequest(body)) {
      return jsonResponse({ error: "Archive entry deletion requires action=delete and confirmed=true." }, 400)
    }
    const target = zipDeletionTarget(session, page)
    if (!target) return jsonResponse({ error: "Only root .zip and .cbz reader pages support archive entry deletion." }, 400)
    if (!this.options.enabled) return jsonResponse({ error: "Archive entry deletion is disabled." }, 403)

    try {
      await this.options.releaseSession(session)
      signal.throwIfAborted()
      return jsonResponse(await this.#deleteEntry({ ...target, signal }))
    } catch (error) {
      if (signal.aborted) throw error
      return jsonResponse({ error: errorMessage(error), sourcePath: target.archivePath, sessionClosed: true }, 409)
    }
  }
}

function isArchiveDeleteRequest(body: Record<string, unknown>): boolean {
  return Object.keys(body).every((key) => key === "action" || key === "confirmed")
    && body.action === "delete"
    && body.confirmed === true
}

function zipDeletionTarget(session: ReaderSession, page: ReaderPage): Omit<DeleteZipArchiveEntryRequest, "signal"> | undefined {
  if (session.book.source.kind !== "archive" || session.book.source.entryPaths?.length || !page.entryPath) return undefined
  if (!(page.content instanceof ArchivePageContent) || page.content.entryPaths.length) return undefined
  const match = /^zip-(\d+)-\d+$/u.exec(page.content.entryId)
  if (!match) return undefined
  const entryIndex = Number(match[1])
  return Number.isSafeInteger(entryIndex) ? { archivePath: session.book.source.path, entryIndex } : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
