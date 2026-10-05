/**
 * `buffer@6.0.3` ships a 194-line `index.d.ts` that declares only the `Buffer` class. The runtime module also
 * carries the three names below (measured: `exports.SlowBuffer` :19, `exports.INSPECT_MAX_BYTES` :20,
 * `exports.kMaxLength` :23), and `safe-buffer` reads `SlowBuffer` off `require('buffer')`, so the shim needs them
 * typed. Augmentation, not a replacement: the class surface stays upstream's.
 */
declare module "node-buffer" {
  export const SlowBuffer: new (length: number) => Buffer
  export const kMaxLength: number
  export const INSPECT_MAX_BYTES: number
}

export {}
