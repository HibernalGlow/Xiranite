/**
 * `node:readline` — refused as a module, with the missing host operation named.
 *
 * Why it exists: `packages/logging/dist/node.js:5` imports `createInterface` and drives it over
 * `createReadStream(...)` — a host-held byte stream, which the fs shim already refuses for the same reason
 * (ADR-0074 decision 2 keeps byte streams on the host side). A line reader built on a stream that cannot exist
 * in the realm would be a fake, so every member is a refusal carrying the operation that would unlock it.
 *
 * The practical alternative for a node that needs lines today: the host answers `fs.readText` for a whole
 * document, and splitting in JS is the node's business (its own code already does that for small files).
 */
import { notImplemented, notImplementedClass } from "./internal.ts"

const LINES_OPERATION = "readline over a host-held stream (fs.readLines(path) or a byte handle)"
const TTY_OPERATION = "tty control (the realm owns no terminal)"

export const createInterface: (...args: unknown[]) => never = notImplemented("readline", "createInterface", LINES_OPERATION)
export const Interface: new (...args: unknown[]) => never = notImplementedClass("readline", "Interface", LINES_OPERATION)
export const emitKeypressEvents: (...args: unknown[]) => never = notImplemented("readline", "emitKeypressEvents", TTY_OPERATION)
export const clearLine: (...args: unknown[]) => never = notImplemented("readline", "clearLine", TTY_OPERATION)
export const clearScreenDown: (...args: unknown[]) => never = notImplemented("readline", "clearScreenDown", TTY_OPERATION)
export const cursorTo: (...args: unknown[]) => never = notImplemented("readline", "cursorTo", TTY_OPERATION)
export const moveCursor: (...args: unknown[]) => never = notImplemented("readline", "moveCursor", TTY_OPERATION)
export const promises: (...args: unknown[]) => never = notImplemented("readline", "promises", LINES_OPERATION)

export default {
  createInterface,
  Interface,
  emitKeypressEvents,
  clearLine,
  clearScreenDown,
  cursorTo,
  moveCursor,
}
