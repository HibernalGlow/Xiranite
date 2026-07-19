import { useCallback, useEffect, useRef, useState } from "react"

import type {
  ReaderHttpClient,
  ReaderSuperResolutionConfigDto,
  ReaderSuperResolutionPatchDto,
  ReaderSuperResolutionPreferencesDto,
} from "../../../adapters/reader-http-client"

export function useSuperResolutionPreferences(
  client: ReaderHttpClient,
  initial: ReaderSuperResolutionConfigDto | undefined,
  onChange?: (patch: ReaderSuperResolutionPatchDto["superResolution"]) => Promise<ReaderSuperResolutionConfigDto>,
) {
  const [config, setConfig] = useState(initial)
  const [feedback, setFeedback] = useState<string>()
  const revisionRef = useRef(0)
  const queueRef = useRef(Promise.resolve())

  useEffect(() => {
    if (initial) setConfig(initial)
  }, [initial])

  const commit = useCallback((patch: ReaderSuperResolutionPreferencesDto) => {
    const previous = config
    const nextPreferences = { ...(previous?.preferences ?? {}), ...patch }
    const next = previous ? { ...previous, preferences: nextPreferences } : undefined
    setConfig(next)
    setFeedback(undefined)
    const revision = ++revisionRef.current
    const write = async () => {
      try {
        const updated = onChange
          ? await onChange({ preferences: patch })
          : client.updateSuperResolution
            ? await client.updateSuperResolution({ superResolution: { preferences: patch } })
            : (() => { throw new Error("当前 Reader 不支持超分配置写入") })()
        if (revision === revisionRef.current) setConfig(updated)
      } catch (error) {
        if (revision === revisionRef.current) {
          setConfig(previous)
          setFeedback(error instanceof Error ? error.message : "超分配置保存失败")
        }
      }
    }
    queueRef.current = queueRef.current.then(write, write)
  }, [client, config, onChange])

  const commitConfig = useCallback((patch: ReaderSuperResolutionPatchDto["superResolution"]) => {
    const previous = config
    const next = previous ? {
      ...previous,
      ...(patch.modelsDirectory === undefined ? {} : { modelsDirectory: patch.modelsDirectory }),
      ...(patch.modelSources === undefined ? {} : { modelSources: patch.modelSources }),
      ...(patch.preferences ? { preferences: { ...previous.preferences, ...patch.preferences } } : {}),
    } : undefined
    setConfig(next)
    setFeedback(undefined)
    const revision = ++revisionRef.current
    const write = async () => {
      try {
        const updated = onChange
          ? await onChange(patch)
          : client.updateSuperResolution
            ? await client.updateSuperResolution({ superResolution: patch })
            : (() => { throw new Error("当前 Reader 不支持超分配置写入") })()
        if (revision === revisionRef.current) setConfig(updated)
      } catch (error) {
        if (revision === revisionRef.current) {
          setConfig(previous)
          setFeedback(error instanceof Error ? error.message : "超分配置保存失败")
        }
      }
    }
    queueRef.current = queueRef.current.then(write, write)
  }, [client, config, onChange])

  return { config, preferences: config?.preferences, feedback, commit, commitConfig }
}
