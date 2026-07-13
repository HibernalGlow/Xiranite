import * as React from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { useLocalFileDrop } from "@/nodes/shared/useLocalFileDrop"

interface PathControlProps {
  dropMode?: "append" | "replace"
  extensions?: string[]
  onValueChange: (value: string) => void
  value?: string
}

type PathInputProps = Omit<React.ComponentProps<typeof Input>, "onChange" | "value"> & PathControlProps & {
  onChange?: React.ChangeEventHandler<HTMLInputElement>
}

type PathTextareaProps = Omit<React.ComponentProps<typeof Textarea>, "onChange" | "value"> & PathControlProps & {
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>
}

function PathInput({ className, disabled, dropMode = "replace", extensions, onChange, onValueChange, value = "", ...props }: PathInputProps) {
  const drop = usePathControlDrop({ disabled, dropMode, extensions, onValueChange, value })
  return <Input {...props} {...drop.targetProps} className={cn(drop.dragging && "border-primary bg-primary/5 ring-2 ring-primary/20", className)} disabled={disabled} value={value} onChange={(event) => { onChange?.(event); onValueChange(event.currentTarget.value) }} />
}

function PathTextarea({ className, disabled, dropMode = "append", extensions, onChange, onValueChange, value = "", ...props }: PathTextareaProps) {
  const drop = usePathControlDrop({ disabled, dropMode, extensions, onValueChange, value })
  return <Textarea {...props} {...drop.targetProps} className={cn(drop.dragging && "border-primary bg-primary/5 ring-2 ring-primary/20", className)} disabled={disabled} value={value} onChange={(event) => { onChange?.(event); onValueChange(event.currentTarget.value) }} />
}

function usePathControlDrop(options: Required<Pick<PathControlProps, "dropMode" | "onValueChange">> & Pick<PathControlProps, "extensions" | "value"> & { disabled?: boolean }) {
  return useLocalFileDrop({
    disabled: options.disabled,
    onDropPaths: (paths) => {
      const accepted = filterPaths(paths, options.extensions)
      if (!accepted.length) return
      options.onValueChange(options.dropMode === "replace" ? accepted[0]! : mergePathLines(options.value ?? "", accepted))
    },
  })
}

function filterPaths(paths: string[], extensions?: string[]): string[] {
  if (!extensions?.length) return paths
  const normalized = extensions.map((extension) => extension.toLowerCase().replace(/^\*?\.?/, "."))
  return paths.filter((path) => normalized.some((extension) => path.toLowerCase().endsWith(extension)))
}

export function mergePathLines(current: string, paths: string[]): string {
  return [...new Set([...current.split(/\r?\n/), ...paths].map((path) => path.trim()).filter(Boolean))].join("\n")
}

export { PathInput, PathTextarea }
