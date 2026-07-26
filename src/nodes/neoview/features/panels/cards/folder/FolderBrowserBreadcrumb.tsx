import { lazy, Suspense } from "react"

import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"

const FolderBreadcrumb = lazy(() => import("./FolderBreadcrumb"))

export default function FolderBrowserBreadcrumb({
  path,
  disabled,
  loading,
  vertical,
  canGoBack,
  canGoForward,
  canGoUp,
  client,
  sessionId,
  canCreateTab,
  onCreateTab,
  onNavigate,
  onNavigateAction,
  onCopyPath,
}: {
  path: string
  disabled: boolean
  loading: boolean
  vertical: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  canGoUp: boolean
  client: ReaderHttpClient
  sessionId?: string
  canCreateTab: boolean
  onCreateTab(): void
  onNavigate(path: string): void
  onNavigateAction(action: "back" | "forward" | "up"): void
  onCopyPath?: (value: string) => void | Promise<void>
}) {
  return (
    <Suspense fallback={<div className="h-8 rounded-md border bg-background" aria-label="正在加载路径导航" />}>
      <FolderBreadcrumb path={path} disabled={disabled} loading={loading} vertical={vertical} canGoBack={canGoBack} canGoForward={canGoForward} canGoUp={canGoUp} client={client} sessionId={sessionId} canCreateTab={canCreateTab} onCreateTab={onCreateTab} onNavigate={onNavigate} onNavigateAction={onNavigateAction} onCopyPath={onCopyPath} />
    </Suspense>
  )
}
