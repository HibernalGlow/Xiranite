/**
 * `@types/readable-stream` covers the class surface but not every member the runtime build actually exports
 * (measured: `Object.keys(await import("readable-stream"))` includes the eight below). These declarations are
 * loose on purpose — they exist so the shim's re-export list compiles, not to model the contracts.
 */
declare module "readable-stream" {
  export const addAbortSignal: (signal: unknown, stream: unknown) => unknown
  export const compose: (...streams: unknown[]) => unknown
  export const destroy: (stream: unknown, error?: Error) => void
  export const isDisturbed: (stream: unknown) => boolean
  export const isErrored: (stream: unknown) => boolean
  export const isReadable: (stream: unknown) => boolean
  export const isWritable: (stream: unknown) => boolean
  export const wrap: (stream: unknown, options?: unknown) => unknown
}

export {}
