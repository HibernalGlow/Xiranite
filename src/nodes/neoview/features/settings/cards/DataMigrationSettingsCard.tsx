import { useCallback, useEffect, useState } from "react"
import { Database, RefreshCw } from "lucide-react"

import { exportNodeConfigFromBackend, getNodeConfigFromBackend } from "@/backend/configRpcClient"
import { Button } from "@/components/ui/button"
import { NodeConfigCenterButton } from "@/nodes/shared/NodeConfigPopover"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardShell } from "../SettingsCardShell"
import { NeoViewConfigOverview } from "./NeoViewConfigOverview"

const NEOVIEW_CONFIG_PRESENTATION = { current: NeoViewConfigOverview }

export function DataMigrationSettingsCard() {
  const { t } = useNodeI18n("neoview")
  const [config, setConfig] = useState<Record<string, unknown>>()
  const [tomlSource, setTomlSource] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const [loaded, exported] = await Promise.all([
        getNodeConfigFromBackend<Record<string, unknown>>("neoview"),
        exportNodeConfigFromBackend("neoview", "toml"),
      ])
      setConfig(loaded.config)
      setTomlSource(exported.content)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadConfig() }, [loadConfig])

  return (
    <SettingsCardShell
      id="data-migration-settings"
      title={t("configData.title", "Data and configuration")}
      description={t("configData.description", "Manage NeoView's project TOML configuration and incremental version history.")}
      icon={Database}
      className="overflow-hidden"
      actions={<div className="flex items-center gap-1"><Button aria-label={t("configData.refresh", "Refresh configuration")} disabled={loading} size="icon-sm" variant="ghost" onClick={() => void loadConfig()}><RefreshCw className={loading ? "animate-spin" : undefined} /></Button><NodeConfigCenterButton nodeKey="neoview" presentation={NEOVIEW_CONFIG_PRESENTATION} onConfigChange={loadConfig} /></div>}
    >
      {loading && !config ? <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">{t("configData.loading", "Loading NeoView configuration...")}</div> : null}
      {error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
      {config ? <div className="-mx-3 -mb-3 border-t"><NeoViewConfigOverview config={config} tomlSource={tomlSource} /></div> : null}
    </SettingsCardShell>
  )
}

export function SettingsDataMigrationCard(_context: ReaderSettingsCardContext) {
  return <DataMigrationSettingsCard />
}

export default function DockedDataMigrationSettingsCard(_context: ReaderPanelContext) {
  return <DataMigrationSettingsCard />
}
