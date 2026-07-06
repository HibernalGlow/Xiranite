import { useEffect, useRef } from "react"
import "@blocknote/core/fonts/inter.css"
import type { PartialBlock } from "@blocknote/core"
import { useCreateBlockNote } from "@blocknote/react"
import { BlockNoteView } from "@blocknote/shadcn"
import "@blocknote/shadcn/style.css"

import { useComponentData } from "@/hooks/useComponentData"
import type { ModuleProps } from "./ModuleRenderer"

interface BlockNoteData {
  doc?: PartialBlock[]
}

export default function BlockNoteModule({ compId }: ModuleProps) {
  const [data, setData] = useComponentData<BlockNoteData>(compId)
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useCreateBlockNote({
    initialContent: data.doc,
  })

  useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current)
    }
  }, [])

  function handleChange() {
    if (flushTimer.current) clearTimeout(flushTimer.current)
    // Avoid dispatching workspace persistence on every editor transaction.
    flushTimer.current = setTimeout(() => {
      setData({ doc: editor.document })
    }, 400)
  }

  return (
    <div className="h-full w-full overflow-auto bn-shadcn">
      <BlockNoteView
        editor={editor}
        onChange={handleChange}
      />
    </div>
  )
}
