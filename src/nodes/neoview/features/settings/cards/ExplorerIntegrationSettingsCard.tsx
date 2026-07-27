import { useEffect, useState } from "react"
import { Wrench } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type {
  ReaderExplorerContextMenuPreviewDto,
  ReaderExplorerContextMenuStatusDto,
} from "../../../adapters/reader-http-client"
import { SettingsCardSection, SettingsCardShell, SettingsToggleRow } from "../SettingsCardShell"

export interface ExplorerIntegrationActions {
  preview(): Promise<ReaderExplorerContextMenuPreviewDto>
  status(): Promise<ReaderExplorerContextMenuStatusDto>
  setEnabled(enabled: boolean): Promise<ReaderExplorerContextMenuStatusDto>
  repair(): Promise<ReaderExplorerContextMenuStatusDto>
}

export function ExplorerIntegrationSettingsCard({ actions }: { actions?: ExplorerIntegrationActions }) {
  const [status, setStatus] = useState<ReaderExplorerContextMenuStatusDto>()
  const [preview, setPreview] = useState<ReaderExplorerContextMenuPreviewDto>()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  async function refresh() {
    if (!actions) return
    try {
      setError(undefined)
      setStatus(await actions.status())
    } catch (cause) {
      setError(message(cause))
    }
  }

  useEffect(() => { void refresh() }, [actions])

  async function requestEnable() {
    if (!actions) return
    setPending(true)
    setError(undefined)
    try {
      const nextPreview = await actions.preview()
      setPreview(nextPreview)
      setConfirming(true)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setPending(false)
    }
  }

  async function apply(enabled: boolean) {
    if (!actions) return
    setPending(true)
    setError(undefined)
    try {
      setStatus(await actions.setEnabled(enabled))
      setConfirming(false)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setPending(false)
    }
  }

  async function repair() {
    if (!actions) return
    setPending(true)
    setError(undefined)
    try {
      setStatus(await actions.repair())
    } catch (cause) {
      setError(message(cause))
    } finally {
      setPending(false)
    }
  }

  const state = status?.state ?? (status?.enabled ? "registered" : "disabled")
  const checked = state === "registered" || state === "needs-repair" || state === "conflict"
  const unavailable = !actions || state === "unavailable"
  return (
    <SettingsCardShell id="explorer-integration-settings" title="资源管理器" description="右键菜单仅注册当前 Reader 支持的文件格式、文件夹和文件夹背景。">
      <SettingsCardSection>
        <SettingsToggleRow
          label="使用 NeoView 打开"
          description={statusText(state, status?.reason)}
          control={<Switch aria-label="使用 NeoView 打开" checked={checked} disabled={unavailable || pending} onCheckedChange={(enabled) => {
            if (enabled) void requestEnable()
            else void apply(false)
          }} />}
        />
        {state === "needs-repair" ? (
          <Button type="button" variant="outline" size="sm" className="self-start" disabled={pending || unavailable} onClick={() => void repair()}>
            <Wrench />修复资源管理器集成
          </Button>
        ) : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </SettingsCardSection>

      <AlertDialog open={confirming} onOpenChange={(open) => { if (!open && !pending) setConfirming(false) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>启用“使用 NeoView 打开”</AlertDialogTitle>
            <AlertDialogDescription>
              将写入当前用户的 Windows 右键菜单注册。旧 NeoView、NeeView 和其他应用的条目不会被覆盖或删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <RegistrationPlan preview={preview} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={pending || !preview?.available} onClick={(event) => { event.preventDefault(); void apply(true) }}>
              确认启用
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCardShell>
  )
}

function RegistrationPlan({ preview }: { preview?: ReaderExplorerContextMenuPreviewDto }) {
  if (!preview?.available) return <p className="text-xs text-destructive">{preview?.reason ?? "当前平台不可注册资源管理器菜单。"}</p>
  return <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border bg-muted/20 p-2 font-mono text-[11px]" aria-label="右键菜单注册预览">
    {preview.plan.map((item) => <li key={item.registryPath} className="break-all">{item.registryPath}</li>)}
  </ul>
}

function statusText(state: NonNullable<ReaderExplorerContextMenuStatusDto["state"]>, reason?: string): string {
  if (reason) return reason
  if (state === "registered") return "已注册并与当前格式配置一致。"
  if (state === "needs-repair") return "注册项不完整或已漂移，需要修复。"
  if (state === "conflict") return "同名条目由其他注册拥有，Xiranite 不会覆盖它。"
  if (state === "unavailable") return "当前平台不支持资源管理器注册。"
  return "未注册。"
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
