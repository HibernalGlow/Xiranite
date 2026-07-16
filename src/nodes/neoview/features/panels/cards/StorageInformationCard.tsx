import type { ReactNode } from "react"

import type { ReaderPanelContext } from "../registry"
import { formatStorageBytes } from "./reader-metadata-format"
import { useReaderMetadata } from "./useReaderMetadata"
import { useReaderStorageDiagnostics } from "./useReaderStorageDiagnostics"

export default function StorageInformationCard({ session, client }: ReaderPanelContext) {
  if (!session) return null
  return <StorageInformationContent session={session} client={client} />
}

function StorageInformationContent({ session, client }: { session: NonNullable<ReaderPanelContext["session"]>; client: ReaderPanelContext["client"] }) {
  const metadata = useReaderMetadata(client, session.sessionId, session.frame.generation)
  const diagnostics = useReaderStorageDiagnostics(client)
  if (metadata.loading) return <div className="h-10 animate-pulse rounded bg-muted" aria-label="正在加载存储信息" />
  if (metadata.error) return <StorageError message={metadata.error} retry={metadata.retry} />
  const page = metadata.value?.page
  if (!page) return <div className="py-2 text-center text-sm text-muted-foreground">暂无存储信息</div>
  const resourceValues = diagnostics.value ? {
    presentation: diagnostics.value.assets.presentation?.bytes,
    thumbnails: diagnostics.value.assets.thumbnails?.cachedBytes,
    archive: diagnostics.value.solidArchiveCache.retainedBytes,
    disk: diagnostics.value.presentationDiskCache.enabled ? diagnostics.value.presentationDiskCache.bytes : undefined,
  } : undefined
  return (
    <div className="space-y-3 text-sm" data-storage-information="true">
      <dl className="space-y-2">
        <StorageRow label="路径"><span className="max-w-[200px] break-words font-mono text-xs" title={page.displayPath}>{page.displayPath || "—"}</span></StorageRow>
        <StorageRow label="大小"><StorageBytes value={page.byteLength} /></StorageRow>
        <StorageRow label="书籍大小"><StorageBytes value={metadata.value?.book.byteLength} /></StorageRow>
      </dl>
      <section className="border-t pt-2" aria-labelledby="storage-resource-heading">
        <h3 id="storage-resource-heading" className="mb-2 text-xs font-medium text-muted-foreground">资源占用</h3>
        <dl className="space-y-2 text-xs">
          <StorageRow label="呈现缓存"><StorageMetric loading={diagnostics.loading} value={resourceValues?.presentation} /></StorageRow>
          <StorageRow label="缩略图缓存"><StorageMetric loading={diagnostics.loading} value={resourceValues?.thumbnails} /></StorageRow>
          <StorageRow label="归档缓存"><StorageMetric loading={diagnostics.loading} value={resourceValues?.archive} /></StorageRow>
          <StorageRow label="磁盘缓存"><StorageMetric loading={diagnostics.loading} value={resourceValues?.disk} /></StorageRow>
        </dl>
        {diagnostics.error ? <StorageError message={diagnostics.error} retry={diagnostics.retry} compact /> : null}
      </section>
    </div>
  )
}

function StorageRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex min-w-0 items-start justify-between gap-3"><dt className="shrink-0 text-muted-foreground">{label}:</dt><dd className="min-w-0 text-right">{children}</dd></div>
}

function StorageBytes({ value }: { value?: number }) {
  return <span className="tabular-nums">{formatStorageBytes(value)}</span>
}

function StorageMetric({ loading, value }: { loading: boolean; value?: number }) {
  return loading
    ? <span className="text-muted-foreground" aria-label="正在加载资源占用">加载中</span>
    : <StorageBytes value={value} />
}

function StorageError({ message, retry, compact = false }: { message: string; retry(): void; compact?: boolean }) {
  return (
    <div className={compact ? "mt-2 flex items-center justify-between gap-2 text-xs" : "space-y-2 text-xs"} role="alert">
      <span className="min-w-0 break-words text-destructive">{message}</span>
      <button type="button" className="shrink-0 text-primary underline-offset-2 hover:underline" onClick={retry}>重试</button>
    </div>
  )
}
