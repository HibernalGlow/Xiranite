import { Database, FileClock, GitCompareArrows, Import } from "lucide-react"

import { NodeConfigCenterButton } from "@/nodes/shared/NodeConfigPopover"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardShell } from "../SettingsCardShell"
import { NeoViewConfigOverview } from "./NeoViewConfigOverview"

const NEOVIEW_CONFIG_PRESENTATION = { current: NeoViewConfigOverview }

export function DataMigrationSettingsCard() {
  const { t } = useNodeI18n("neoview")
  return (
    <SettingsCardShell
      id="data-migration-settings"
      title={t("configData.title", "Data and configuration")}
      description={t("configData.description", "Manage NeoView's project TOML configuration and incremental version history.")}
      icon={Database}
      actions={<NodeConfigCenterButton nodeKey="neoview" presentation={NEOVIEW_CONFIG_PRESENTATION} />}
    >
      <ConfigCapabilityRow
        icon={Database}
        title={t("configData.project.title", "Project configuration")}
        description={t("configData.project.description", "Read and display [nodes.neoview] while keeping other node sections independent.")}
      />
      <ConfigCapabilityRow
        icon={FileClock}
        title={t("configData.history.title", "Change history")}
        description={t("configData.history.description", "Store redacted incremental snapshots with system Git and filter them by NeoView changes.")}
      />
      <ConfigCapabilityRow
        icon={GitCompareArrows}
        title={t("configData.restore.title", "Diff and restore")}
        description={t("configData.restore.description", "Inspect semantic and unified diffs; restoration writes only the NeoView section.")}
      />
      <ConfigCapabilityRow
        icon={Import}
        title={t("configData.transfer.title", "Transfer and sync")}
        description={t("configData.transfer.description", "Import or export node-level TOML/JSON, create local backups, and synchronize Git history.")}
      />
    </SettingsCardShell>
  )
}

function ConfigCapabilityRow({ icon: Icon, title, description }: { icon: typeof Database; title: string; description: string }) {
  return <div className="flex items-start gap-3 border-b pb-3 last:border-b-0 last:pb-0">
    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    <div className="min-w-0"><h3 className="text-sm font-medium">{title}</h3><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p></div>
  </div>
}

export function SettingsDataMigrationCard(_context: ReaderSettingsCardContext) {
  return <DataMigrationSettingsCard />
}

export default function DockedDataMigrationSettingsCard(_context: ReaderPanelContext) {
  return <DataMigrationSettingsCard />
}
