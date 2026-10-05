/**
 * `node:stream` — the real implementation, taken wholesale from the `readable-stream` npm package.
 *
 * Why it exists: `comfygure`/`bandia`/`dissolvef` platform closures reach `require("stream").Stream` through
 * bundled npm. Writing a stream implementation is the one case where "port it" is the wrong answer — Node's
 * stream is a few thousand lines of subtle backpressure state, and the userland port of exactly that code
 * (`readable-stream`, the package browserify/webpack have shipped for a decade, MIT) is the direct-use path.
 * Nothing here is ours except the re-export list and the two refusals below.
 *
 * The `default` export is the `Stream` class, as in Node (`import Stream from "node:stream"`).
 */
export {
  Stream,
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  ReadableState,
  pipeline,
  finished,
  addAbortSignal,
  compose,
  destroy,
  isDisturbed,
  isErrored,
  isReadable,
  isWritable,
  from,
  wrap,
} from "readable-stream"

export { Stream as default } from "readable-stream"

import { notImplemented } from "./internal.ts"

/**
 * Two Node 18+ members `readable-stream` does not carry. They are configuration knobs over the same
 * high-water-mark the port already uses internally, so a node reaching them is refused rather than served a
 * second, divergent answer.
 */
export const setDefaultHighWaterMark: (size: number) => never = notImplemented("stream", "setDefaultHighWaterMark", "stream.defaultHighWaterMark configuration op")
export const getDefaultHighWaterMark: (objectMode?: boolean) => never = notImplemented("stream", "getDefaultHighWaterMark", "stream.defaultHighWaterMark configuration op")
