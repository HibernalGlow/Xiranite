import { useRef, useState } from "react"

import type { ReaderExternalOpenRequest, ReaderExternalOpenResult } from "./ReaderAppModules"

export function useReaderExternalFolderOpen() {
  const [externalFolderOpenRequest, setExternalFolderOpenRequest] = useState<ReaderExternalOpenRequest>()
  const resolversRef = useRef(new Map<string, (result: ReaderExternalOpenResult) => void>())

  function beginExternalFolderOpen(request: ReaderExternalOpenRequest): Promise<ReaderExternalOpenResult> {
    return new Promise<ReaderExternalOpenResult>((resolve) => {
      resolversRef.current.set(request.requestId, resolve)
      setExternalFolderOpenRequest(request)
    })
  }

  function completeExternalFolderOpen(result: ReaderExternalOpenResult): void {
    const requestId = result.requestId
    if (!requestId) return
    const resolve = resolversRef.current.get(requestId)
    if (!resolve) return
    resolversRef.current.delete(requestId)
    setExternalFolderOpenRequest((current) => current?.requestId === requestId ? undefined : current)
    resolve(result)
  }

  return { externalFolderOpenRequest, beginExternalFolderOpen, completeExternalFolderOpen }
}
