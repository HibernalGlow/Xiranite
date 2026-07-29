import { Bookmark } from "lucide-react"

import { DropdownMenuCheckboxItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { useReaderStartupRestorePreference } from "../../../../app/ReaderStartupRestorePreferenceContext"

export function FolderStartupRestoreMenuItem({ disabled, showSeparator = true }: { disabled: boolean; showSeparator?: boolean }) {
  const startupRestore = useReaderStartupRestorePreference()
  return (
    <>
      {showSeparator ? <DropdownMenuSeparator /> : null}
      <DropdownMenuCheckboxItem
        checked={startupRestore?.restoreLastBook === true}
        disabled={disabled || !startupRestore?.canUpdate || startupRestore.pending}
        onCheckedChange={(checked) => { void startupRestore?.setRestoreLastBook(checked === true) }}
        data-reader-startup-restore-toggle="true"
      >
        <Bookmark className="size-4" />
        启动时恢复上次阅读
      </DropdownMenuCheckboxItem>
    </>
  )
}
