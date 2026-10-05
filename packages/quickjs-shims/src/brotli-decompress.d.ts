/**
 * `brotli/decompress` ships no types. This declares the one function the shim imports; the runtime contract is
 * the package's own (hand-ported pure JS decoder, verified in-realm against Node-produced bytes).
 */
declare module "brotli/decompress" {
  const decompress: (input: Uint8Array, outSize?: number) => Uint8Array
  export default decompress
}
