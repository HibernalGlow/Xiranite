import { Database } from "bun:sqlite"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inflateSync } from "node:zlib"
import { writePsdBuffer, type BlendMode, type Layer, type PixelData, type Psd } from "ag-psd"
import { extractClipSqlite, parseClipChunks, parseClipExternalChunks, type ClipExternalChunk } from "./clip-format.js"

type SqlValue = string | number | bigint | boolean | Uint8Array | null
type SqlRow = Record<string, SqlValue>

const BLEND_MODES: Record<number, BlendMode> = {
  0: "normal", 1: "darken", 2: "multiply", 3: "color burn", 4: "linear burn", 5: "subtract", 6: "darker color",
  7: "lighten", 8: "screen", 9: "color dodge", 10: "color dodge", 11: "linear dodge", 12: "linear dodge", 13: "lighter color",
  14: "overlay", 15: "soft light", 16: "hard light", 17: "vivid light", 18: "linear light", 19: "pin light", 20: "hard mix",
  21: "difference", 22: "exclusion", 23: "hue", 24: "saturation", 25: "color", 26: "luminosity", 30: "pass through", 36: "divide",
}

export interface ClipToPsdOptions {
  psb?: boolean
}

export async function convertClipToPsd(sourcePath: string, outputPath: string, options: ClipToPsdOptions = {}): Promise<void> {
  const workspace = await mkdtemp(join(tmpdir(), "xlchemy-clip-"))
  const sqlitePath = join(workspace, "clip.sqlite")
  try {
    const chunks = parseClipChunks(await readFile(sourcePath))
    await writeFile(sqlitePath, extractClipSqlite(chunks))
    const externalChunks = parseClipExternalChunks(chunks)
    const database = new Database(sqlitePath, { readonly: true, strict: true })
    try {
      const document = readClipDocument(database, externalChunks)
      const buffer = writePsdBuffer(document, { compress: true, noBackground: true, psb: options.psb ?? outputPath.toLowerCase().endsWith(".psb"), trimImageData: true })
      await writeFile(outputPath, buffer)
    } finally {
      database.close()
    }
  } finally {
    await rm(workspace, { force: true, recursive: true })
  }
}

function readClipDocument(database: Database, chunks: Map<string, ClipExternalChunk>): Psd {
  const canvas = queryOne(database, "SELECT CanvasWidth, CanvasHeight, CanvasResolution, CanvasRootFolder FROM Canvas")
  const width = numberValue(canvas.CanvasWidth)
  const height = numberValue(canvas.CanvasHeight)
  const rootFolder = numberValue(canvas.CanvasRootFolder)
  if (width <= 0 || height <= 0) throw new Error("CLIP canvas has invalid dimensions.")

  const layers = queryAll(database, "SELECT * FROM Layer")
  const layerById = new Map(layers.map((layer) => [numberValue(layer.MainId), layer]))
  const offscreens = new Map(queryAll(database, "SELECT MainId, LayerId, BlockData, Attribute FROM Offscreen").map((row) => [numberValue(row.MainId), row]))
  const mipmaps = new Map(queryAll(database, "SELECT MainId, BaseMipmapInfo FROM Mipmap").map((row) => [numberValue(row.MainId), row]))
  const mipmapInfo = new Map(queryAll(database, "SELECT MainId, Offscreen FROM MipmapInfo").map((row) => [numberValue(row.MainId), row]))

  const children = buildChildren(rootFolder, layerById, (row) => createLayer(row, chunks, offscreens, mipmaps, mipmapInfo))
  return { width, height, children, imageResources: { resolutionInfo: { horizontalResolution: numberValue(canvas.CanvasResolution) || 72, horizontalResolutionUnit: "PPI", widthUnit: "Inches", verticalResolution: numberValue(canvas.CanvasResolution) || 72, verticalResolutionUnit: "PPI", heightUnit: "Inches" } } }
}

function buildChildren(parentId: number, layers: Map<number, SqlRow>, create: (row: SqlRow) => Layer): Layer[] {
  const parent = layers.get(parentId)
  if (!parent) throw new Error(`CLIP layer tree references missing folder ${parentId}.`)
  const output: Layer[] = []
  const visited = new Set<number>()
  let childId = numberValue(parent.LayerFirstChildIndex)
  while (childId) {
    if (visited.has(childId)) throw new Error(`CLIP layer tree contains a cycle at ${childId}.`)
    visited.add(childId)
    const row = layers.get(childId)
    if (!row) throw new Error(`CLIP layer tree references missing layer ${childId}.`)
    const layer = create(row)
    if (numberValue(row.LayerFolder)) {
      layer.children = buildChildren(childId, layers, create)
      layer.opened = (numberValue(row.LayerFolder) & 16) === 0
      delete layer.imageData
    }
    output.push(layer)
    childId = numberValue(row.LayerNextIndex)
  }
  return output
}

function createLayer(row: SqlRow, chunks: Map<string, ClipExternalChunk>, offscreens: Map<number, SqlRow>, mipmaps: Map<number, SqlRow>, mipmapInfo: Map<number, SqlRow>): Layer {
  const image = resolveBitmap(row.LayerRenderMipmap, chunks, offscreens, mipmaps, mipmapInfo)
  const mask = resolveBitmap(row.LayerLayerMaskMipmap, chunks, offscreens, mipmaps, mipmapInfo)
  const left = numberValue(row.LayerOffsetX) + numberValue(row.LayerRenderOffscrOffsetX)
  const top = numberValue(row.LayerOffsetY) + numberValue(row.LayerRenderOffscrOffsetY)
  const layer: Layer = {
    name: stringValue(row.LayerName) || `Layer ${numberValue(row.MainId)}`,
    blendMode: BLEND_MODES[numberValue(row.LayerComposite)] ?? "normal",
    opacity: Math.max(0, Math.min(1, numberValue(row.LayerOpacity, 256) / 256)),
    clipping: Boolean(numberValue(row.LayerClip)),
    hidden: !Boolean(numberValue(row.LayerVisibility) & 1) || Boolean(row.OutputAttribute),
    transparencyProtected: Boolean(numberValue(row.LayerLock) & 16),
    left,
    top,
  }
  if (image) layer.imageData = image
  if (mask) layer.mask = { imageData: mask, left: numberValue(row.LayerMaskOffsetX) + numberValue(row.LayerMaskOffscrOffsetX), top: numberValue(row.LayerMaskOffsetY) + numberValue(row.LayerMaskOffscrOffsetY), disabled: !(numberValue(row.LayerVisibility) & 2), positionRelativeToLayer: !(numberValue(row.LayerSelect) & 256) }
  return layer
}

function resolveBitmap(mipmapIdValue: SqlValue | undefined, chunks: Map<string, ClipExternalChunk>, offscreens: Map<number, SqlRow>, mipmaps: Map<number, SqlRow>, mipmapInfo: Map<number, SqlRow>): PixelData | undefined {
  const mipmapId = numberValue(mipmapIdValue)
  if (!mipmapId) return undefined
  const mipmap = mipmaps.get(mipmapId)
  const info = mipmap && mipmapInfo.get(numberValue(mipmap.BaseMipmapInfo))
  const offscreen = info && offscreens.get(numberValue(info.Offscreen))
  if (!offscreen) return undefined
  const chunk = chunks.get(binaryKey(offscreen.BlockData))
  if (!chunk?.bitmapBlocks) return undefined
  return decodeBitmap(bytesValue(offscreen.Attribute), chunk.bitmapBlocks)
}

export function decodeBitmap(attribute: Uint8Array, blocks: Array<Buffer | undefined>): PixelData {
  const reader = new BinaryReader(attribute)
  if (reader.u32() !== 16 || reader.u32() !== 102) throw new Error("Unsupported CLIP offscreen attribute header.")
  const extraSize = reader.u32()
  if (extraSize !== 42 && extraSize !== 58) throw new Error(`Unsupported CLIP offscreen extra section size ${extraSize}.`)
  reader.u32()
  reader.expectUtf16("Parameter")
  const width = reader.u32(), height = reader.u32(), gridWidth = reader.u32(), gridHeight = reader.u32()
  const packing = Array.from({ length: 16 }, () => reader.u32())
  reader.expectUtf16("InitColor")
  reader.u32()
  const defaultWhite = reader.u32()
  reader.u32(); reader.u32(); reader.u32()
  const channelCount = packing[1]! + packing[2]!
  if (!((packing[1] === 1 && packing[2] === 4) || channelCount === 1)) throw new Error(`Unsupported CLIP pixel packing ${packing[1]}+${packing[2]}.`)
  if (packing[8] === 32) throw new Error("1-bit CLIP bitmap packing is not supported.")
  if (gridWidth * gridHeight !== blocks.length) throw new Error("CLIP bitmap grid does not match block count.")
  const rgba = new Uint8ClampedArray(width * height * 4)
  if (defaultWhite) rgba.fill(255)
  const pixelsPerBlock = 256 * 256
  for (let gridY = 0; gridY < gridHeight; gridY += 1) for (let gridX = 0; gridX < gridWidth; gridX += 1) {
    const compressed = blocks[gridY * gridWidth + gridX]
    if (!compressed) continue
    const pixels = inflateSync(compressed)
    if (channelCount === 5 && pixels.length !== pixelsPerBlock * 5) throw new Error("Invalid CLIP RGBA bitmap block length.")
    if (channelCount === 1 && pixels.length !== pixelsPerBlock) throw new Error("Invalid CLIP mask bitmap block length.")
    const blockWidth = Math.min(256, width - gridX * 256), blockHeight = Math.min(256, height - gridY * 256)
    for (let y = 0; y < blockHeight; y += 1) for (let x = 0; x < blockWidth; x += 1) {
      const source = y * 256 + x
      const target = ((gridY * 256 + y) * width + gridX * 256 + x) * 4
      if (channelCount === 5) {
        rgba[target] = pixels[pixelsPerBlock + source * 4 + 2]!
        rgba[target + 1] = pixels[pixelsPerBlock + source * 4 + 1]!
        rgba[target + 2] = pixels[pixelsPerBlock + source * 4]!
        rgba[target + 3] = pixels[source]!
      } else rgba[target] = rgba[target + 1] = rgba[target + 2] = rgba[target + 3] = pixels[source]!
    }
  }
  return { width, height, data: rgba }
}

class BinaryReader {
  private offset = 0
  constructor(private readonly data: Uint8Array) {}
  u32() { if (this.offset + 4 > this.data.length) throw new Error("Truncated CLIP binary attribute."); const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4).getUint32(0); this.offset += 4; return value }
  utf16() { const length = this.u32(); const size = length * 2; if (this.offset + size > this.data.length) throw new Error("Truncated CLIP UTF-16 string."); const buffer = Buffer.from(this.data.buffer, this.data.byteOffset + this.offset, size); this.offset += size; return buffer.swap16().toString("utf16le") }
  expectUtf16(value: string) { const actual = this.utf16(); if (actual !== value) throw new Error(`Expected CLIP attribute ${value}, got ${actual}.`) }
}

function queryAll(database: Database, query: string): SqlRow[] { return database.query(query).all() as SqlRow[] }
function queryOne(database: Database, query: string): SqlRow { const row = database.query(query).get() as SqlRow | null; if (!row) throw new Error(`CLIP database query returned no row: ${query}`); return row }
function numberValue(value: SqlValue | undefined, fallback = 0) { return typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : fallback }
function stringValue(value: SqlValue | undefined) { return typeof value === "string" ? value : "" }
function bytesValue(value: SqlValue | undefined): Uint8Array { if (value instanceof Uint8Array) return value; throw new Error("Expected CLIP database blob.") }
function binaryKey(value: SqlValue | undefined): string { return value instanceof Uint8Array ? Buffer.from(value).toString("ascii") : typeof value === "string" ? value : "" }
