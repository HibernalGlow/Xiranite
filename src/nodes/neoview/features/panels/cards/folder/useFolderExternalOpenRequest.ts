import { useEffect, useRef } from "react"

import type { ReaderFolderExternalOpenRequest, ReaderFolderExternalOpenResult } from "../../registry"
import type { FolderBrowserOpenResult } from "./FolderBrowserOpen"

export function useFolderExternalOpenRequest(
  request: ReaderFolderExternalOpenRequest | undefined,
  openBrowser: (path: string) => Promise<FolderBrowserOpenResult>,
  onResult: ((result: ReaderFolderExternalOpenResult) => void) | undefined,
): void {
  const handledRequestIdRef = useRef<string>()
  const openBrowserRef = useRef(openBrowser)
  const onResultRef = useRef(onResult)
  openBrowserRef.current = openBrowser
  onResultRef.current = onResult

  useEffect(() => {
    if (!request || handledRequestIdRef.current === request.requestId) return
    handledRequestIdRef.current = request.requestId
    void openBrowserRef.current(request.path).then((result) => {
      onResultRef.current?.({ requestId: request.requestId, ...result })
    })
  }, [request?.requestId])
}
