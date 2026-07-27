import { useCallback, useEffect, useRef, useState } from "react"
import type { NodeComponentProps } from "@xiranite/contract"

import { createLogger } from "@/lib/logger"
import { pickCzkawkaNodeConfig, type CzkawkaNodeConfig } from "./node-config"
import type { CzkawkaCardState } from "./types"

const logger = createLogger("czkawka.config")

type Host = NodeComponentProps<CzkawkaCardState>["host"]

interface UseCzkawkaNodeConfigOptions {
  host: Host
  applyCardStatePatch: (patch: Partial<CzkawkaCardState>) => void
}

export function useCzkawkaNodeConfig({ host, applyCardStatePatch }: UseCzkawkaNodeConfigOptions) {
  const loadedRef = useRef(false)
  const pendingPatchRef = useRef<Partial<CzkawkaNodeConfig>>({})
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [, setRevision] = useState(0)

  const save = useCallback((patch: Partial<CzkawkaNodeConfig>) => {
    if (!Object.keys(patch).length) return
    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        if (host.config?.save) await host.config.save(patch)
        else await host.saveNodeConfig?.(patch)
      })
      .catch((error) => {
        logger.error("Failed to save Czkawka node configuration", error)
      })
  }, [host])

  const persistCardStatePatch = useCallback((patch: Partial<CzkawkaCardState>) => {
    const configPatch = pickCzkawkaNodeConfig(patch)
    if (!Object.keys(configPatch).length) return
    if (!loadedRef.current) {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...configPatch }
      return
    }
    save(configPatch)
  }, [save])

  useEffect(() => {
    let active = true
    const request = host.config?.get?.<Partial<CzkawkaNodeConfig>>() ?? host.getNodeConfig?.<Partial<CzkawkaNodeConfig>>()
    if (!request) {
      loadedRef.current = true
      return undefined
    }

    void request.then(
      (response) => {
        if (!active) return
        const pendingPatch = pendingPatchRef.current
        pendingPatchRef.current = {}
        loadedRef.current = true
        const savedConfig = pickCzkawkaNodeConfig(response.config)
        const restoredConfig = { ...savedConfig, ...pendingPatch }
        if (Object.keys(restoredConfig).length) {
          applyCardStatePatch(restoredConfig)
          setRevision((revision) => revision + 1)
        }
        save(pendingPatch)
      },
      (error) => {
        if (!active) return
        loadedRef.current = true
        logger.error("Failed to load Czkawka node configuration", error)
        const pendingPatch = pendingPatchRef.current
        pendingPatchRef.current = {}
        save(pendingPatch)
      },
    )

    return () => {
      active = false
    }
  }, [applyCardStatePatch, host, save])

  return persistCardStatePatch
}
