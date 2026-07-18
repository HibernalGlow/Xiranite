import { useEffect, useRef, useState, type FormEvent } from "react"

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

import type { ReaderHttpClient } from "../../../../adapters/reader-http-client"

export interface FolderRenameEntry {
  path: string
  name: string
  kind: "file" | "directory"
}

export default function FolderRenameDialog({ client, entry, onClose, onRenamed }: {
  client: ReaderHttpClient
  entry: FolderRenameEntry
  onClose(): void
  onRenamed(destinationPath: string): void | Promise<void>
}) {
  const [name, setName] = useState(entry.name)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)
  const operationRef = useRef<AbortController>()
  const validationError = validateFolderEntryName(name, entry.path)
  const changed = name !== entry.name

  useEffect(() => () => operationRef.current?.abort(), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending || validationError || !changed) return
    const execute = client.executeFileOperations
    if (!execute) {
      setError("当前后端不支持重命名文件。")
      return
    }
    const operation = new AbortController()
    operationRef.current?.abort()
    operationRef.current = operation
    setPending(true)
    setError(undefined)
    const destinationPath = siblingPath(entry.path, name)
    try {
      const result = await execute([{
        kind: "rename",
        sourcePath: entry.path,
        destinationPath,
        overwrite: false,
      }], false, operation.signal)
      const failed = result.results.find((item) => item.status !== "succeeded")
      if (failed || result.succeeded !== 1) {
        setError(fileOperationError(failed?.errorCode, failed?.error))
        return
      }
      await onRenamed(destinationPath)
      onClose()
    } catch (cause) {
      if (!operation.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = undefined
        setPending(false)
      }
    }
  }

  function close() {
    operationRef.current?.abort()
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const input = inputRef.current
          if (!input) return
          const [start, end] = renameEditableRange(entry.name, entry.kind)
          input.focus()
          input.setSelectionRange(start, end)
        }}
      >
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
            <DialogDescription>输入新的{entry.kind === "directory" ? "文件夹" : "文件"}名称。文件扩展名默认保持不变。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Input
              ref={inputRef}
              aria-label="新名称"
              value={name}
              disabled={pending}
              maxLength={255}
              spellCheck={false}
              onChange={(event) => {
                setName(event.target.value)
                setError(undefined)
              }}
            />
            {validationError ? <div role="alert" className="text-xs text-destructive">{validationError}</div> : null}
            {!validationError && error ? <div role="alert" className="text-xs text-destructive">{error}</div> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>取消</Button>
            <Button type="submit" disabled={pending || Boolean(validationError) || !changed}>
              {pending ? "正在重命名" : "重命名"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const WINDOWS_INVALID_NAME = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function validateFolderEntryName(name: string, sourcePath: string): string | undefined {
  if (!name.length) return "名称不能为空。"
  if (name === "." || name === "..") return "名称不能是 . 或 ..。"
  if (name.length > 255) return "名称不能超过 255 个字符。"
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return "名称不能包含路径分隔符。"
  if (!isWindowsPath(sourcePath)) return undefined
  if (WINDOWS_INVALID_NAME.test(name)) return "名称包含 Windows 不允许的字符。"
  if (name.endsWith(".") || name.endsWith(" ")) return "Windows 名称不能以句点或空格结尾。"
  if (RESERVED_WINDOWS_NAME.test(name)) return "该名称是 Windows 保留名称。"
  return undefined
}

export function renameEditableRange(name: string, kind: FolderRenameEntry["kind"]): readonly [number, number] {
  if (kind === "directory") return [0, name.length]
  const extension = name.lastIndexOf(".")
  return [0, extension > 0 ? extension : name.length]
}

export function siblingPath(sourcePath: string, name: string): string {
  const slash = Math.max(sourcePath.lastIndexOf("/"), sourcePath.lastIndexOf("\\"))
  if (slash < 0) return name
  return `${sourcePath.slice(0, slash + 1)}${name}`
}

function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.includes("\\")
}

function fileOperationError(code?: string, message?: string): string {
  if (code === "EEXIST") return "同一文件夹中已经存在同名项目。"
  if (code === "EPERM" || code === "EACCES") return "没有权限重命名此项目。"
  if (code === "ENOENT") return "原项目已经不存在，请刷新文件夹。"
  return message || "重命名失败。"
}
