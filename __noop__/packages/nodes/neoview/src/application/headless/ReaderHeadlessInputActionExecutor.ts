import type { ReaderInputAction } from "../../domain/input/ReaderInputActions.js"
import type { HeadlessReaderSnapshot } from "./ReaderHeadlessController.js"
import type { ReaderDirectorySortRule } from "../browser/ReaderDirectorySort.js"

export interface ReaderHeadlessInputActionPort {
  inspect(): HeadlessReaderSnapshot
  next?(signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  previous?(signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  goTo?(pageIndex: number, signal?: AbortSignal): Promise<HeadlessReaderSnapshot>
  openAdjacent?(direction: "next" | "previous", sort?: ReaderDirectorySortRule, signal?: AbortSignal): Promise<HeadlessReaderSnapshot | undefined>
  closeBook?(): Promise<void>
}

export type ReaderHeadlessInputActionResult =
  | { handled: true; action: ReaderInputAction; snapshot?: HeadlessReaderSnapshot; boundary?: true }
  | { handled: false; action: ReaderInputAction; reason: "unsupported-on-headless-surface" | "missing-controller-capability" }

/** Projects only actions with a real headless controller capability. */
export async function executeReaderHeadlessInputAction(
  action: ReaderInputAction,
  controller: ReaderHeadlessInputActionPort,
  signal?: AbortSignal,
): Promise<ReaderHeadlessInputActionResult> {
  signal?.throwIfAborted()
  const snapshot = controller.inspect()
  switch (action) {
    case "reader.previous-page": return navigate(action, controller.previous, controller, signal)
    case "reader.next-page": return navigate(action, controller.next, controller, signal)
    case "reader.first-page": return goTo(action, controller, 0, signal)
    case "reader.last-page": return goTo(action, controller, Math.max(0, snapshot.book.pageCount - 1), signal)
    case "reader.page-left": return snapshot.frame.direction === "right-to-left"
      ? navigate(action, controller.next, controller, signal)
      : navigate(action, controller.previous, controller, signal)
    case "reader.page-right": return snapshot.frame.direction === "right-to-left"
      ? navigate(action, controller.previous, controller, signal)
      : navigate(action, controller.next, controller, signal)
    case "reader.next-book": return adjacent(action, controller, "next", signal)
    case "reader.previous-book": return adjacent(action, controller, "previous", signal)
    case "file.close":
      if (!controller.closeBook) return missing(action)
      await controller.closeBook()
      return { handled: true, action }
    default: return { handled: false, action, reason: "unsupported-on-headless-surface" }
  }
}

async function navigate(
  action: ReaderInputAction,
  operation: ReaderHeadlessInputActionPort["next"],
  receiver: ReaderHeadlessInputActionPort,
  signal?: AbortSignal,
): Promise<ReaderHeadlessInputActionResult> {
  if (!operation) return missing(action)
  return { handled: true, action, snapshot: await operation.call(receiver, signal) }
}

async function goTo(
  action: ReaderInputAction,
  controller: ReaderHeadlessInputActionPort,
  pageIndex: number,
  signal?: AbortSignal,
): Promise<ReaderHeadlessInputActionResult> {
  if (!controller.goTo) return missing(action)
  return { handled: true, action, snapshot: await controller.goTo(pageIndex, signal) }
}

async function adjacent(
  action: ReaderInputAction,
  controller: ReaderHeadlessInputActionPort,
  direction: "next" | "previous",
  signal?: AbortSignal,
): Promise<ReaderHeadlessInputActionResult> {
  if (!controller.openAdjacent) return missing(action)
  const snapshot = await controller.openAdjacent(direction, undefined, signal)
  return snapshot ? { handled: true, action, snapshot } : { handled: true, action, boundary: true }
}

function missing(action: ReaderInputAction): ReaderHeadlessInputActionResult {
  return { handled: false, action, reason: "missing-controller-capability" }
}
