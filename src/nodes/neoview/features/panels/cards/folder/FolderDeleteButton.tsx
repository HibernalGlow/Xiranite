import { Trash2 } from "lucide-react"

export type FolderDeleteStrategy = "trash" | "permanent"

export default function FolderDeleteButton({
  entry,
  strategy,
  disabled = false,
  overlay = false,
  placement = "corner",
  confirm = true,
}: {
  entry: { index: number; path: string; name: string; kind: "file" | "directory"; readerSupported: boolean }
  strategy: FolderDeleteStrategy
  disabled?: boolean
  overlay?: boolean
  placement?: "corner" | "leading"
  confirm?: boolean
}) {
  const label = strategy === "trash" ? `移到回收站：${entry.name}` : `永久删除：${entry.name}`
  return (
    <button
      type="button"
      className={overlay || placement === "leading"
        ? placement === "leading"
          ? "absolute left-1 top-1/2 z-10 grid size-7 -translate-y-1/2 place-items-center rounded bg-background/90 text-destructive shadow-sm hover:bg-destructive/10"
          : "absolute left-1 top-1 z-10 grid size-7 place-items-center rounded bg-background/90 text-destructive shadow-sm hover:bg-destructive/10"
        : "grid size-6 shrink-0 place-items-center rounded text-destructive hover:bg-destructive/10"}
      aria-label={label}
      title={label}
      disabled={disabled}
      data-folder-delete-button="true"
      data-folder-delete-strategy={strategy}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.dispatchEvent(new CustomEvent("neoview-folder-delete-request", {
          bubbles: true,
          detail: { ...entry, strategy, confirm },
        }))
      }}
      onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation() }}
    >
      <Trash2 className="size-4" />
    </button>
  )
}
