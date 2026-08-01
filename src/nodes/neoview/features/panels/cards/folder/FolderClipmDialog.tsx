import type { WorkScoreResult } from "@xiranite/node-clipm/contracts"
import { LoaderCircle } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export interface FolderClipmDialogProps {
  open: boolean
  name: string
  work?: FolderClipmDialogWork
  loading: boolean
  error?: string
  onClose(): void
  onSave(label: "P" | "N", score: number): Promise<void>
}

export type FolderClipmDialogWork = Omit<WorkScoreResult, "workId"> & { workId?: string }

export default function FolderClipmDialog({ open, name, work, loading, error, onClose, onSave }: FolderClipmDialogProps) {
  const [label, setLabel] = useState<"P" | "N">("P")
  const [score, setScore] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!work) return
    setLabel(work.label)
    setScore(work.score)
  }, [work])

  const valid = Number.isInteger(score) && score >= 0 && score <= 1000
  const changed = Boolean(work && (label !== work.label || score !== work.score))
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving && !loading) onClose() }}>
      <DialogContent showCloseButton={!saving && !loading} className="max-h-[calc(100vh-2rem)] max-w-md overflow-y-auto" data-folder-clipm-dialog="true">
        <DialogHeader>
          <DialogTitle>ClipM 单本评分</DialogTitle>
          <DialogDescription className="break-all">{name}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="size-4 animate-spin" />正在读取作品评分…
          </div>
        ) : work ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">模型原分类</span><span className="font-medium">{work.predictedLabel ?? "--"}</span>
              <span className="text-muted-foreground">模型原评分</span><span className="font-mono tabular-nums">{work.predictedScore ?? "--"}</span>
              <span className="text-muted-foreground">当前分类</span><span>{work.label}{work.classificationCorrected ? "（人工修正）" : ""}</span>
              <span className="text-muted-foreground">当前评分</span><span>{work.score}{work.rankingCorrected ? "（人工修正）" : ""}</span>
              <span className="text-muted-foreground">模型 / 短码</span><span className="font-mono">v{work.bundleVersion} / {work.shortCode}</span>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">喜欢分类</span>
              <ToggleGroup type="single" value={label} onValueChange={(value) => { if (value === "P" || value === "N") setLabel(value) }} className="grid grid-cols-2">
                <ToggleGroupItem value="P" aria-label="P 喜欢">P 喜欢</ToggleGroupItem>
                <ToggleGroupItem value="N" aria-label="N 不喜欢">N 不喜欢</ToggleGroupItem>
              </ToggleGroup>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">评分（0-1000）</span>
              <Input type="number" min={0} max={1000} step={1} value={score} aria-label="ClipM 人工评分" onChange={(event) => setScore(Number(event.target.value))} />
            </label>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving || loading} onClick={onClose}>取消</Button>
          <Button
            type="button"
            disabled={!work?.workId || loading || saving || !valid || !changed}
            onClick={() => {
              setSaving(true)
              void onSave(label, score).finally(() => setSaving(false))
            }}
          >
            {saving ? <LoaderCircle className="animate-spin" /> : null}保存修正
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
