import { ArrowDown, ArrowUp, Folder, FolderOpen, FolderPlus, Plus, Save, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { ReaderFolderMigrationTarget } from "../../../../adapters/reader-http-client"
import {
  createFolderMigrationTarget,
  hasFolderMigrationPath,
  MAX_FOLDER_MIGRATION_TARGETS,
  moveFolderMigrationTarget,
  normalizeFolderMigrationTargets,
  removeFolderMigrationTarget,
  updateFolderMigrationTarget,
  validateFolderMigrationTargets,
} from "./FolderMigrationTargets"

export default function FolderMigrationTargetsDialog({
  targets,
  pickDirectory,
  onSave,
  onClose,
}: {
  targets: readonly ReaderFolderMigrationTarget[]
  pickDirectory?(): Promise<string | undefined>
  onSave(targets: ReaderFolderMigrationTarget[]): void | Promise<void>
  onClose(): void
}) {
  const [draft, setDraft] = useState<ReaderFolderMigrationTarget[]>(() => targets.map((target) => ({ ...target })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const normalized = useMemo(() => normalizeFolderMigrationTargets(draft), [draft])
  const validationError = validateFolderMigrationTargets(normalized)
  const changed = !sameTargets(normalized, targets)

  async function pickNewTarget() {
    if (!pickDirectory || busy || draft.length >= MAX_FOLDER_MIGRATION_TARGETS) return
    setBusy(true)
    setError(undefined)
    try {
      const path = await pickDirectory()
      if (!path) return
      if (hasFolderMigrationPath(draft, path)) {
        setError("该目录已经在常用目录中。")
        return
      }
      setDraft((current) => [...current, createFolderMigrationTarget(path, createTargetId(), current)])
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function changeTargetPath(target: ReaderFolderMigrationTarget) {
    if (!pickDirectory || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const path = await pickDirectory()
      if (!path) return
      if (hasFolderMigrationPath(draft, path, target.id)) {
        setError("该目录已经在常用目录中。")
        return
      }
      setDraft((current) => updateFolderMigrationTarget(current, target.id, { path }))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function addManualTarget() {
    if (busy || draft.length >= MAX_FOLDER_MIGRATION_TARGETS) return
    setDraft((current) => [...current, createFolderMigrationTarget("", createTargetId(), current)])
    setError(undefined)
  }

  async function save() {
    if (busy || validationError || !changed) return
    setBusy(true)
    setError(undefined)
    try {
      await onSave(normalized)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[min(42rem,calc(100vh-2rem))] max-w-2xl overflow-hidden p-0" showCloseButton={false}>
        <DialogHeader className="border-b px-5 py-4 pr-4">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-base">常用迁移目录</DialogTitle>
            <div className="flex items-center gap-1">
              <Button type="button" size="sm" variant="outline" disabled={busy || draft.length >= MAX_FOLDER_MIGRATION_TARGETS} onClick={addManualTarget}>
                <Plus />
                添加路径
              </Button>
              {pickDirectory ? (
                <Button type="button" size="sm" variant="outline" disabled={busy || draft.length >= MAX_FOLDER_MIGRATION_TARGETS} onClick={() => void pickNewTarget()}>
                  <FolderPlus />
                  添加目录
                </Button>
              ) : null}
            </div>
          </div>
          <DialogDescription className="sr-only">管理迁移菜单中的常用目录名称、路径和顺序。</DialogDescription>
        </DialogHeader>

        <div className="min-h-40 overflow-y-auto px-5" data-folder-migration-target-list>
          {draft.length === 0 ? (
            <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">尚未添加常用目录</div>
          ) : draft.map((target, index) => (
            <div key={target.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b py-3 last:border-b-0">
              <Folder className="size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                className="h-8 min-w-0 text-sm"
                aria-label={`目录名称 ${index + 1}`}
                maxLength={128}
                value={target.name}
                disabled={busy}
                onChange={(event) => {
                  setDraft((current) => updateFolderMigrationTarget(current, target.id, { name: event.currentTarget.value }))
                  setError(undefined)
                }}
              />
              <div className="row-span-2 flex items-center gap-0.5">
                <Button type="button" size="icon-xs" variant="ghost" title="上移" aria-label={`上移 ${target.name}`} disabled={busy || index === 0} onClick={() => setDraft((current) => moveFolderMigrationTarget(current, target.id, -1))}><ArrowUp /></Button>
                <Button type="button" size="icon-xs" variant="ghost" title="下移" aria-label={`下移 ${target.name}`} disabled={busy || index === draft.length - 1} onClick={() => setDraft((current) => moveFolderMigrationTarget(current, target.id, 1))}><ArrowDown /></Button>
                {pickDirectory ? <Button type="button" size="icon-xs" variant="ghost" title="更换目录" aria-label={`更换 ${target.name} 的目录`} disabled={busy} onClick={() => void changeTargetPath(target)}><FolderOpen /></Button> : null}
                <Button type="button" size="icon-xs" variant="ghost" className="text-destructive hover:text-destructive" title="删除" aria-label={`删除 ${target.name}`} disabled={busy} onClick={() => setDraft((current) => removeFolderMigrationTarget(current, target.id))}><Trash2 /></Button>
              </div>
              <Input
                className="col-start-2 h-7 min-w-0 font-mono text-xs"
                aria-label={`目录路径 ${index + 1}`}
                maxLength={4096}
                placeholder="../归档 或 D:/归档"
                value={target.path}
                disabled={busy}
                onChange={(event) => {
                  setDraft((current) => updateFolderMigrationTarget(current, target.id, { path: event.currentTarget.value }))
                  setError(undefined)
                }}
              />
            </div>
          ))}
        </div>

        <div className="border-t px-5 py-3">
          {validationError || error ? <div role="alert" className="mb-2 text-xs text-destructive">{validationError ?? error}</div> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button>
            <Button type="button" disabled={busy || Boolean(validationError) || !changed} onClick={() => void save()}>
              <Save />
              {busy ? "正在保存" : "保存"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function createTargetId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `migration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function sameTargets(left: readonly ReaderFolderMigrationTarget[], right: readonly ReaderFolderMigrationTarget[]): boolean {
  return left.length === right.length && left.every((target, index) => {
    const candidate = right[index]
    return candidate?.id === target.id && candidate.name === target.name && candidate.path === target.path
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
