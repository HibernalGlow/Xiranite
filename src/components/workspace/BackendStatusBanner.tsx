import { RefreshCcw, Server, Settings } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useLocalBackendStatus } from "@/hooks/useLocalBackendStatus"
import { useWorkspaceActions } from "@/store/workspaceContext"
import { Button } from "@/components/ui/button"

export function BackendStatusBanner() {
  const { t } = useTranslation()
  const statusQuery = useLocalBackendStatus()
  const workspaceActions = useWorkspaceActions()
  const status = statusQuery.data?.status

  if (!status || status === "ready") return null

  const backendUrl = statusQuery.data?.config?.baseUrl
  const message = status === "missing-config"
    ? t("settings:backendBanner.missingConfig")
    : t("settings:backendBanner.unreachable", { url: backendUrl ?? t("common:unknown") })

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-shrink-0 items-center gap-3 border-b border-destructive/25 bg-destructive/8 px-4 py-2 text-xs text-destructive"
    >
      <Server className="h-3.5 w-3.5 flex-shrink-0" />
      <p className="min-w-0 flex-1 truncate" title={statusQuery.data?.error ?? message}>
        {message}
      </p>
      <div className="xiranite-app-region-no-drag flex flex-shrink-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={statusQuery.isFetching}
          onClick={() => statusQuery.refetch()}
        >
          <RefreshCcw className="h-3 w-3" />
          {statusQuery.isFetching ? t("settings:developerRuntime.statusChecking") : t("settings:backendBanner.retry")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => workspaceActions.setOverlay("settings")}
        >
          <Settings className="h-3 w-3" />
          {t("settings:backendBanner.openRuntime")}
        </Button>
      </div>
    </div>
  )
}
