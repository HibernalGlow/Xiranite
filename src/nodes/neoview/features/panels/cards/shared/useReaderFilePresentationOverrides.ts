import { useCallback, useEffect, useRef, useState } from "react"

import type {
  ReaderFilePresentationOverridesDto,
  ReaderFilePresentationOverridesPatch,
} from "../../../../adapters/reader-http-client"
import { applyReaderFilePresentationOverridePatch } from "../../readerFilePresentation"

export function useReaderFilePresentationOverrides(
  configured: ReaderFilePresentationOverridesDto,
  persist: ((patch: ReaderFilePresentationOverridesPatch) => Promise<ReaderFilePresentationOverridesDto>) | undefined,
) {
  const [draft, setDraft] = useState<ReaderFilePresentationOverridesDto>(() => ({ ...configured }))
  const confirmedRef = useRef<ReaderFilePresentationOverridesDto>({ ...configured })
  const generationRef = useRef(0)

  useEffect(() => {
    if (generationRef.current !== 0) return
    confirmedRef.current = { ...configured }
    setDraft({ ...configured })
  }, [configured.bannerWidthPercent, configured.contentWidthPercent, configured.thumbnailWidthPercent, configured.viewMode])

  const preview = useCallback((patch: ReaderFilePresentationOverridesPatch) => {
    setDraft((current) => applyReaderFilePresentationOverridePatch(current, patch))
  }, [])

  const commit = useCallback(async (patch: ReaderFilePresentationOverridesPatch) => {
    const generation = ++generationRef.current
    const optimistic = applyReaderFilePresentationOverridePatch(draft, patch)
    setDraft(optimistic)
    try {
      const confirmed = persist ? await persist(patch) : optimistic
      if (generation === generationRef.current) {
        confirmedRef.current = { ...confirmed }
        setDraft({ ...confirmed })
      }
      return confirmed
    } catch (error) {
      if (generation === generationRef.current) setDraft({ ...confirmedRef.current })
      throw error
    } finally {
      if (generation === generationRef.current) generationRef.current = 0
    }
  }, [draft, persist])

  return { overrides: draft, preview, commit, pending: generationRef.current !== 0 }
}
