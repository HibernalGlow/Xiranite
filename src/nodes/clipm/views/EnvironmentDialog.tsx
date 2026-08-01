import { useEffect, useState } from "react"
import { Cpu, FolderInput, FolderOpen, Gauge, HardDriveDownload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ClipmWorkspaceController } from "../useClipmWorkspace"

export function EnvironmentDialog({
  controller,
  mode,
}: {
  controller: ClipmWorkspaceController
  mode: "setup" | "migrate"
}) {
  const { environmentConfig, running } = controller
  const currentRoot = environmentConfig.value?.runtime_root ?? ""
  const [open, setOpen] = useState(false)
  const [runtimeRoot, setRuntimeRoot] = useState("")
  const [device, setDevice] = useState<"cuda" | "cpu">(environmentConfig.value?.device ?? "cuda")
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    if (!open) return
    setRuntimeRoot(mode === "setup" ? currentRoot : "")
    setDevice(environmentConfig.value?.device ?? "cuda")
    setConfirmed(false)
  }, [currentRoot, environmentConfig.value?.device, mode, open])

  const normalized = runtimeRoot.trim()
  const valid = isAbsoluteWindowsPath(normalized)
    && (mode === "setup" ? confirmed : normalized.toLowerCase() !== currentRoot.toLowerCase())

  async function pickDirectory() {
    const selected = await controller.pickEnvironmentDirectory()
    if (selected) setRuntimeRoot(selected)
  }

  async function submit() {
    if (!valid) return
    const succeeded = mode === "setup"
      ? await controller.configureEnvironment(normalized, device)
      : await controller.migrateEnvironment(normalized)
    if (succeeded) setOpen(false)
  }

  const TriggerIcon = mode === "setup" ? FolderInput : HardDriveDownload
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild>
      <Button size="sm" variant={mode === "setup" ? "default" : "outline"} disabled={running || environmentConfig.loading}>
        <TriggerIcon />{mode === "setup" ? "设置环境" : "迁移环境"}
      </Button>
    </DialogTrigger>
    <DialogContent className="w-[min(94vw,560px)] sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>{mode === "setup" ? "设置 ClipM 运行环境" : "迁移 ClipM 运行环境"}</DialogTitle>
        <DialogDescription>{mode === "setup" ? "选择外置运行目录和计算设备。" : "目标目录必须为空；原目录会保留。"}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 py-1">
        {mode === "migrate" ? <div className="grid gap-1">
          <Label>当前目录</Label>
          <div className="truncate border bg-muted/30 px-3 py-2 font-mono text-xs" title={currentRoot}>{currentRoot}</div>
        </div> : null}
        <div className="grid gap-1.5">
          <Label htmlFor={`clipm-${mode}-runtime-root`}>目标目录</Label>
          <div className="flex gap-2">
            <Input
              id={`clipm-${mode}-runtime-root`}
              aria-invalid={Boolean(normalized) && !isAbsoluteWindowsPath(normalized)}
              className="font-mono text-xs"
              placeholder="D:\\ClipM"
              value={runtimeRoot}
              onChange={(event) => setRuntimeRoot(event.currentTarget.value)}
            />
            <Button type="button" size="icon" variant="outline" aria-label="选择 ClipM 运行目录" onClick={() => void pickDirectory()}><FolderOpen /></Button>
          </div>
        </div>
        {mode === "setup" ? <div className="grid gap-1.5">
          <Label>计算设备</Label>
          <ToggleGroup className="grid grid-cols-2" type="single" value={device} onValueChange={(value) => value && setDevice(value as "cuda" | "cpu")}>
            <ToggleGroupItem value="cuda"><Gauge />CUDA</ToggleGroupItem>
            <ToggleGroupItem value="cpu"><Cpu />CPU</ToggleGroupItem>
          </ToggleGroup>
          {device === "cpu" ? <p role="status" className="text-xs text-amber-700 dark:text-amber-400">CPU 模式性能较低，不会安装或切换另一套环境。</p> : null}
        </div> : null}
        {mode === "setup" ? <Label className="items-start gap-2 font-normal">
          <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
          <span className="text-xs leading-5">已确认目录位于非系统盘，并允许在其中保存 Python、模型和缓存。</span>
        </Label> : null}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
        <Button disabled={!valid || running} onClick={() => void submit()}><HardDriveDownload />{mode === "setup" ? "创建并检查" : "迁移并切换"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function isAbsoluteWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)
}
