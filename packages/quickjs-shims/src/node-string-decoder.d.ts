/**
 * The `string_decoder` npm package (installed under the alias `node-string-decoder`) ships no types (`main` is
 * `lib/string_decoder.js`, no `types` field). Measured: it exports exactly one name,
 * `exports.StringDecoder` (`lib/string_decoder.js:78`), and reaches `Buffer` through
 * `require('safe-buffer')` — which is why `buffer` must be an aliased specifier, not only a realm global.
 */
declare module "node-string-decoder" {
  export class StringDecoder {
    constructor(encoding?: string)
    write(buffer: unknown): string
    end(buffer?: unknown): string
    readonly encoding: string
    text?: string
    lastNeed?: number
    lastCharSize?: number
    [key: string]: unknown
  }
}
