import type { ReaderExternalOpenRequest, ReaderExternalOpenResult } from "./ReaderAppModules"

export interface ReaderExternalOpenPort {
  prepareFolder(request: ReaderExternalOpenRequest): void
  openReader(path: string): Promise<ReaderExternalOpenResult>
  openFolder(request: ReaderExternalOpenRequest): Promise<ReaderExternalOpenResult>
}

export async function openReaderExternalTarget(
  request: ReaderExternalOpenRequest,
  port: ReaderExternalOpenPort,
): Promise<ReaderExternalOpenResult> {
  const path = request.path.trim()
  if (!path) return { opened: false, message: "External open target is empty." }

  const normalized = { ...request, path }
  port.prepareFolder(normalized)
  if (request.kind === "directory") return await port.openFolder(normalized)

  const [reader, folder] = await Promise.all([
    port.openReader(path),
    port.openFolder(normalized),
  ])
  if (reader.opened && folder.opened) return { opened: true }

  const failures = [
    reader.opened ? undefined : `Reader: ${reader.message ?? "could not open the file."}`,
    folder.opened ? undefined : `Folder: ${folder.message ?? "could not position the file."}`,
  ].filter((message): message is string => Boolean(message))
  return { opened: false, message: failures.join(" ") }
}
