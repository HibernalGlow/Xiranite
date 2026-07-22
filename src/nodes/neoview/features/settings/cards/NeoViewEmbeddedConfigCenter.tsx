import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { Archive, Download, FileJson, GitPullRequestArrow, Save, Upload } from "lucide-react"
import type { NodeConfigHistoryRepositoryStatus } from "@xiranite/contract"

import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { createBackendAdapters } from "@/nodes/shared/NodeConfigPopover"
import { useNodeI18n } from "@/nodes/shared/useNodeI18n"
import { NeoViewConfigOverview } from "./NeoViewConfigOverview"

const LazyHistory = lazy(() => import("@/nodes/shared/NodeConfigHistoryPanel"))

export function NeoViewEmbeddedConfigCenter({ config, tomlSource, onReload }: { config: Record<string, unknown>; tomlSource?: string; onReload: () => Promise<void> }) {
  const { t } = useNodeI18n("neoview")
  const [tab, setTab] = useState("current")
  const adapters = useMemo(() => createBackendAdapters("neoview", onReload), [onReload])

  return <Tabs value={tab} onValueChange={setTab} className="min-h-0 gap-0 overscroll-contain">
    <div className="overflow-x-auto border-b px-3 py-2">
      <TabsList variant="line" className="min-w-max">
        <TabsTrigger value="current">{t("config.tabs.current", "Current configuration")}</TabsTrigger>
        <TabsTrigger value="presets">{t("config.tabs.presets", "Presets")}</TabsTrigger>
        <TabsTrigger value="history">{t("config.tabs.history", "Change history")}</TabsTrigger>
        <TabsTrigger value="transfer">{t("config.tabs.transfer", "Import / export")}</TabsTrigger>
        <TabsTrigger value="backup">{t("config.tabs.backup", "Backup / sync")}</TabsTrigger>
      </TabsList>
    </div>
    <TabsContent value="current"><NeoViewConfigOverview config={config} tomlSource={tomlSource} /></TabsContent>
    <TabsContent value="presets" className="p-4"><Empty>{t("config.presets.empty", "This node does not declare presets.")}</Empty></TabsContent>
    <TabsContent value="history" className="h-[480px] min-h-0 p-3">
      {tab === "history" ? <Suspense fallback={<Empty>{t("config.history.loading", "Loading history...")}</Empty>}><LazyHistory adapter={adapters.history} t={t} /></Suspense> : null}
    </TabsContent>
    <TabsContent value="transfer" className="p-4"><TransferPanel transfer={adapters.transfer} onReload={onReload} t={t} /></TabsContent>
    <TabsContent value="backup" className="p-4">{tab === "backup" ? <BackupPanel backup={adapters.backup} t={t} /> : null}</TabsContent>
  </Tabs>
}

function TransferPanel({ transfer, onReload, t }: { transfer: ReturnType<typeof createBackendAdapters>["transfer"]; onReload: () => Promise<void>; t: ReturnType<typeof useNodeI18n>["t"] }) {
  const [content, setContent] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function exportConfig(format: "toml" | "json") {
    setBusy(true)
    setError(undefined)
    try {
      const result = await transfer.export(format)
      download(result.filename, result.content, result.mimeType)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  async function importConfig() {
    setBusy(true)
    setError(undefined)
    try {
      await transfer.import(content, "auto")
      setContent("")
      await onReload()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  return <div className="grid gap-5 lg:grid-cols-2">
    <section className="space-y-3"><h3 className="text-sm font-semibold">{t("config.export.title", "Export configuration")}</h3><p className="text-xs text-muted-foreground">{t("config.export.description", "Export only this node's section in a portable format.")}</p><div className="flex gap-2"><Button disabled={busy} variant="outline" onClick={() => void exportConfig("toml")}><Download />TOML</Button><Button disabled={busy} variant="outline" onClick={() => void exportConfig("json")}><FileJson />JSON</Button></div></section>
    <section className="space-y-3"><h3 className="text-sm font-semibold">{t("config.import.title", "Import configuration")}</h3><p className="text-xs text-muted-foreground">{t("config.import.description", "Paste TOML or JSON. Only this node's section will be updated.")}</p><Textarea className="min-h-52 font-mono text-xs" value={content} onChange={(event) => setContent(event.currentTarget.value)} placeholder="[nodes.neoview]" /><Button disabled={busy || !content.trim()} onClick={() => void importConfig()}><Upload />{t("config.import.action", "Import and reload")}</Button>{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}</section>
  </div>
}

function BackupPanel({ backup, t }: { backup: ReturnType<typeof createBackendAdapters>["backup"]; t: ReturnType<typeof useNodeI18n>["t"] }) {
  const [status, setStatus] = useState<NodeConfigHistoryRepositoryStatus>()
  const [remote, setRemote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => { void backup.status().then((next) => { setStatus(next); setRemote(next.remoteUrl ?? "") }, (cause) => setError(message(cause))) }, [backup])

  async function run(action: () => Promise<NodeConfigHistoryRepositoryStatus>) {
    setBusy(true)
    setError(undefined)
    try { setStatus(await action()) } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }

  return <div className="grid gap-5 lg:grid-cols-2">
    <section className="space-y-3"><h3 className="text-sm font-semibold">{t("config.backup.title", "Local Git backup")}</h3><p className="text-xs text-muted-foreground">{t("config.backup.description", "Snapshots are incremental and stored outside the live TOML file.")}</p><div className="rounded-md border bg-muted/20 p-3 font-mono text-xs break-all">{status?.path ?? t("config.backup.loading", "Loading repository...")}</div><Button disabled={busy || !status} onClick={() => void backup.create()}><Archive />{t("config.backup.create", "Create backup")}</Button></section>
    <section className="space-y-3"><h3 className="text-sm font-semibold">{t("config.sync.title", "Remote synchronization")}</h3><p className="text-xs text-muted-foreground">{t("config.sync.description", "Pull updates history only.")}</p><Field><FieldLabel htmlFor="neoview-history-remote">{t("config.sync.remote", "Git remote")}</FieldLabel><Input id="neoview-history-remote" value={remote} onChange={(event) => setRemote(event.currentTarget.value)} /></Field><div className="flex flex-wrap gap-2"><Button disabled={busy || !status} variant="outline" onClick={() => void run(() => backup.setRemote(remote.trim() || null))}><Save />{t("config.sync.saveRemote", "Save remote")}</Button><Button disabled={busy || !status?.remoteUrl} variant="outline" onClick={() => void run(() => backup.sync("pull"))}><GitPullRequestArrow />{t("config.sync.pull", "Pull history")}</Button><Button disabled={busy || !status?.remoteUrl} variant="outline" onClick={() => void run(() => backup.sync("push"))}><Upload />{t("config.sync.push", "Push history")}</Button></div>{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}</section>
  </div>
}

function Empty({ children }: { children: React.ReactNode }) { return <div className="grid min-h-40 place-items-center rounded-md border border-dashed p-4 text-sm text-muted-foreground">{children}</div> }
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause) }
function download(filename: string, content: string, mimeType: string) { const url = URL.createObjectURL(new Blob([content], { type: mimeType })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url) }
