import { useEffect, useRef, useState } from "react"

const INITIAL_QUIET_WINDOW_MS = 1_000
const NAVIGATION_QUIET_WINDOW_MS = 280
const IDLE_CALLBACK_TIMEOUT_MS = 250
const INPUT_RETRY_DELAY_MS = 80

export interface ReaderSpeculativePreloadGateOptions {
  sessionId?: string
  frameGeneration?: number
  enabled: boolean
  initialQuietWindowMs?: number
  navigationQuietWindowMs?: number
  idleCallbackTimeoutMs?: number
}

interface ReaderSpeculativePreloadAdmission {
  sessionId?: string
  frameGeneration?: number
  allowed: boolean
}

/**
 * Keeps optional decode and upscale work out of the critical open/turn path.
 * The backend still decides the actual resource budget after this browser gate
 * confirms that the reader has been quiet long enough to spend it.
 */
export function useReaderSpeculativePreloadGate({
  sessionId,
  frameGeneration,
  enabled,
  initialQuietWindowMs = INITIAL_QUIET_WINDOW_MS,
  navigationQuietWindowMs = NAVIGATION_QUIET_WINDOW_MS,
  idleCallbackTimeoutMs = IDLE_CALLBACK_TIMEOUT_MS,
}: ReaderSpeculativePreloadGateOptions): boolean {
  const [admission, setAdmission] = useState<ReaderSpeculativePreloadAdmission>({ allowed: false })
  const admittedSessionRef = useRef<string>()

  useEffect(() => {
    setAdmission({ sessionId, frameGeneration, allowed: false })
    if (!enabled || !sessionId || typeof window === "undefined") return

    const initialAdmission = admittedSessionRef.current !== sessionId
    admittedSessionRef.current = sessionId
    let disposed = false
    let quietTimer: ReturnType<typeof window.setTimeout> | undefined
    let fallbackTimer: ReturnType<typeof window.setTimeout> | undefined
    let idleHandle: number | undefined

    const cancelPending = () => {
      if (quietTimer !== undefined) window.clearTimeout(quietTimer)
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer)
      if (idleHandle !== undefined && typeof cancelIdleCallback === "function") cancelIdleCallback(idleHandle)
      quietTimer = undefined
      fallbackTimer = undefined
      idleHandle = undefined
    }
    const canAdmit = () => {
      if (typeof document === "undefined" || document.visibilityState === "hidden") return false
      return typeof document.hasFocus !== "function" || document.hasFocus()
    }
    const hasPendingInput = () => {
      const scheduling = (navigator as Navigator & {
        scheduling?: { isInputPending?: (options?: { includeContinuous?: boolean }) => boolean }
      }).scheduling
      return scheduling?.isInputPending?.({ includeContinuous: true }) === true
    }
    const scheduleAdmission = (quietWindowMs: number) => {
      cancelPending()
      if (!canAdmit()) return
      quietTimer = window.setTimeout(() => {
        const admit = () => {
          idleHandle = undefined
          fallbackTimer = undefined
          if (disposed || !canAdmit()) return
          if (hasPendingInput()) {
            scheduleAdmission(INPUT_RETRY_DELAY_MS)
            return
          }
          setAdmission({ sessionId, frameGeneration, allowed: true })
        }
        if (typeof requestIdleCallback === "function") {
          idleHandle = requestIdleCallback(admit, { timeout: idleCallbackTimeoutMs })
        } else {
          fallbackTimer = window.setTimeout(admit, 0)
        }
      }, quietWindowMs)
    }
    const resetAfterInput = () => {
      setAdmission({ sessionId, frameGeneration, allowed: false })
      scheduleAdmission(navigationQuietWindowMs)
    }
    const resumeAfterFocus = () => {
      if (!canAdmit()) {
        setAdmission({ sessionId, frameGeneration, allowed: false })
        cancelPending()
        return
      }
      setAdmission({ sessionId, frameGeneration, allowed: false })
      scheduleAdmission(navigationQuietWindowMs)
    }

    scheduleAdmission(initialAdmission ? initialQuietWindowMs : navigationQuietWindowMs)
    window.addEventListener("pointerdown", resetAfterInput, true)
    window.addEventListener("keydown", resetAfterInput, true)
    window.addEventListener("wheel", resetAfterInput, true)
    window.addEventListener("focus", resumeAfterFocus)
    window.addEventListener("blur", resumeAfterFocus)
    document.addEventListener("visibilitychange", resumeAfterFocus)
    return () => {
      disposed = true
      cancelPending()
      window.removeEventListener("pointerdown", resetAfterInput, true)
      window.removeEventListener("keydown", resetAfterInput, true)
      window.removeEventListener("wheel", resetAfterInput, true)
      window.removeEventListener("focus", resumeAfterFocus)
      window.removeEventListener("blur", resumeAfterFocus)
      document.removeEventListener("visibilitychange", resumeAfterFocus)
    }
  }, [enabled, frameGeneration, idleCallbackTimeoutMs, initialQuietWindowMs, navigationQuietWindowMs, sessionId])

  // Effects run after child effects. Never expose a prior book/frame admission
  // during that gap, otherwise a new first paint can begin speculative work.
  return admission.allowed
    && admission.sessionId === sessionId
    && admission.frameGeneration === frameGeneration
}
