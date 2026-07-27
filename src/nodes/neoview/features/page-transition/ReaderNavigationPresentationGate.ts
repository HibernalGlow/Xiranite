import { flushSync } from "react-dom"
import type { ReaderPageTransitionSettings } from "@xiranite/node-neoview/ui-core"

/** Commits one reader page before accepting the next continuous input action. */
export async function commitReaderNavigationForPresentation(commit: () => void, transitionDurationMs: number): Promise<void> {
  flushSync(commit)
  await waitForCommittedPaint()
  if (transitionDurationMs > 0) await new Promise<void>((resolve) => { globalThis.setTimeout(resolve, transitionDurationMs) })
}

export async function commitReaderNavigation(
  commit: () => void,
  transition: ReaderPageTransitionSettings,
  renderEveryPage: boolean,
): Promise<void> {
  if (!renderEveryPage || !transition.renderEveryRepeatedPage) {
    commit()
    return
  }
  await commitReaderNavigationForPresentation(commit, transition.enabled && transition.type !== "none" ? transition.duration : 0)
}

function waitForCommittedPaint(): Promise<void> {
  return waitForNextAnimationFrame().then(waitForNextAnimationFrame)
}

function waitForNextAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve()
  return new Promise((resolve) => { requestAnimationFrame(() => resolve()) })
}
