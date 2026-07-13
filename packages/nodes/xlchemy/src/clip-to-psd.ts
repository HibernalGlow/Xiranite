import { Database } from "bun:sqlite"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { inflateSync } from "node:zlib"
import { writePsdBuffer, type AdjustmentLayer, type BlendMode, type Layer, type PixelData, type Psd } from "ag-psd"
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
      const buffer = writePsdBuffer(document, { compress: true, noBackground: true, psb: options.psb ?? outputPath.toLowerCase().endsWith(".psb") })
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

  const children = buildChildren(rootFolder, layerById, (row) => createLayer(row, chunks, offscreens, mipmaps, mipmapInfo, width, height))
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

function createLayer(row: SqlRow, chunks: Map<string, ClipExternalChunk>, offscreens: Map<number, SqlRow>, mipmaps: Map<number, SqlRow>, mipmapInfo: Map<number, SqlRow>, canvasWidth: number, canvasHeight: number): Layer {
  const image = resolveBitmap(row.LayerRenderMipmap, chunks, offscreens, mipmaps, mipmapInfo)
  const mask = resolveBitmap(row.LayerLayerMaskMipmap, chunks, offscreens, mipmaps, mipmapInfo)
  const left = numberValue(row.LayerOffsetX) + numberValue(row.LayerRenderOffscrOffsetX) + (image?.left ?? 0)
  const top = numberValue(row.LayerOffsetY) + numberValue(row.LayerRenderOffscrOffsetY) + (image?.top ?? 0)
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
  if (image) layer.imageData = image.imageData
  if (mask) layer.mask = { imageData: mask.imageData, left: numberValue(row.LayerMaskOffsetX) + numberValue(row.LayerMaskOffscrOffsetX) + mask.left, top: numberValue(row.LayerMaskOffsetY) + numberValue(row.LayerMaskOffscrOffsetY) + mask.top, disabled: !(numberValue(row.LayerVisibility) & 2), positionRelativeToLayer: !(numberValue(row.LayerSelect) & 256) }
  attachEditableText(layer, row)
  attachEditableGradient(layer, row, canvasWidth, canvasHeight)
  if (row.FilterLayerInfo instanceof Uint8Array) layer.adjustment = parseFilterAdjustment(row.FilterLayerInfo)
  if (row.LayerEffectInfo instanceof Uint8Array) attachLayerEffects(layer, row.LayerEffectInfo)
  return layer
}

function attachLayerEffects(layer: Layer, data: Uint8Array) {
  const name = "EffectEdge", length = Buffer.alloc(4); length.writeUInt32BE(name.length)
  const encoded = Buffer.from(name, "utf16le"); encoded.swap16()
  const marker = Buffer.concat([length, encoded]), buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  const index = buffer.indexOf(marker)
  if (index < 0 || index + marker.length + 24 > buffer.length) return
  const offset = index + marker.length
  if (!buffer.readUInt32BE(offset)) return
  const size = buffer.readDoubleBE(offset + 4)
  const color = { r: buffer.readUInt32BE(offset + 12) >>> 24, g: buffer.readUInt32BE(offset + 16) >>> 24, b: buffer.readUInt32BE(offset + 20) >>> 24 }
  layer.effects = { stroke: [{ enabled: true, present: true, showInDialog: true, position: "outside", fillType: "color", blendMode: "normal", opacity: 1, size: { units: "Pixels", value: size + 0.5 }, color }] }
}

export function parseFilterAdjustment(data: Uint8Array): AdjustmentLayer | undefined {
  if (data.byteLength < 8) throw new Error("Truncated CLIP filter layer data.")
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const filter = view.getUint32(0), size = view.getUint32(4)
  if (size > data.byteLength - 8) throw new Error("Invalid CLIP filter layer size.")
  if (filter === 1 && size >= 8) return { type: "brightness/contrast", brightness: view.getInt32(8), contrast: view.getInt32(12), meanValue: 127, useLegacy: true }
  if (filter === 2 && size >= 10) {
    const channels = Array.from({ length: Math.min(4, Math.floor(size / 10)) }, (_, index) => {
      const offset = 8 + index * 10
      const shadow = view.getUint16(offset), middle = view.getUint16(offset + 2), highlight = view.getUint16(offset + 4), outputShadow = view.getUint16(offset + 6), outputHighlight = view.getUint16(offset + 8)
      const ratio = (middle - shadow) / Math.max(1, highlight - shadow)
      const gamma = Math.max(0.1, Math.min(9.99, -Math.log2(Math.max(ratio, Number.EPSILON))))
      return { shadowInput: Math.floor(shadow / 256), highlightInput: Math.floor(highlight / 256), shadowOutput: Math.floor(outputShadow / 256), highlightOutput: Math.floor(outputHighlight / 256), midtoneInput: gamma }
    })
    return { type: "levels", rgb: channels[0], red: channels[1], green: channels[2], blue: channels[3] }
  }
  if (filter === 3 && size >= 130) {
    const channels = Array.from({ length: Math.min(4, Math.floor(size / 130)) }, (_, channel) => {
      const offset = 8 + channel * 130, count = Math.min(view.getUint16(offset), 32)
      return Array.from({ length: count }, (_, index) => ({ input: Math.floor(view.getUint16(offset + 2 + index * 4) / 256), output: Math.floor(view.getUint16(offset + 4 + index * 4) / 256) }))
    })
    return { type: "curves", rgb: channels[0], red: channels[1], green: channels[2], blue: channels[3] }
  }
  if (filter === 4 && size >= 12) return { type: "hue/saturation", master: { a: 0, b: 0, c: 0, d: 0, hue: view.getInt32(8), saturation: view.getInt32(12), lightness: view.getInt32(16) } }
  if (filter === 6) return { type: "invert" }
  return undefined
}

function attachEditableGradient(layer: Layer, row: SqlRow, canvasWidth: number, canvasHeight: number) {
  if (!(row.GradationFillInfo instanceof Uint8Array)) return
  const gradient = parseGradientFill(row.GradationFillInfo)
  if (!gradient) return
  if (gradient.flatColor) { layer.vectorFill = { type: "color", color: gradient.flatColor }; return }
  if (!gradient.stops?.length || !gradient.geometry) return
  const geometry = gradient.geometry
  const startX = geometry.startX + numberValue(row.LayerOffsetX), startY = geometry.startY + numberValue(row.LayerOffsetY)
  const endX = geometry.endX + numberValue(row.LayerOffsetX), endY = geometry.endY + numberValue(row.LayerOffsetY)
  const dx = endX - startX, dy = endY - startY
  let scale = (Math.abs(dx * canvasHeight) < Math.abs(dy * canvasWidth) ? Math.abs(dy) / canvasHeight : Math.abs(dx) / canvasWidth) * 100
  const radial = geometry.shape !== 0
  if (radial) scale *= 2
  const centerX = radial ? startX : (startX + endX) / 2, centerY = radial ? startY : (startY + endY) / 2
  layer.vectorFill = {
    type: "solid", name: "Imported from CLIP Studio", smoothness: 1,
    colorStops: gradient.stops.map((stop) => ({ color: { r: stop.r, g: stop.g, b: stop.b }, location: stop.position / 100, midpoint: 0.5 })),
    opacityStops: gradient.stops.map((stop) => ({ opacity: stop.opacity / 255, location: stop.position / 100, midpoint: 0.5 })),
    style: radial ? "radial" : "linear", angle: -Math.atan2(dy, dx) * 180 / Math.PI, scale, align: false,
    offset: { x: (centerX - canvasWidth / 2) * 100 / canvasWidth, y: (centerY - canvasHeight / 2) * 100 / canvasHeight },
  }
}

interface ClipGradientStop { r: number; g: number; b: number; opacity: number; position: number }
interface ClipGradientGeometry { repeatMode: number; shape: number; antiAliasing: number; ellipseDiameter: number; startX: number; startY: number; endX: number; endY: number }
export function parseGradientFill(data: Uint8Array): { flatColor?: { r: number; g: number; b: number }; stops?: ClipGradientStop[]; geometry?: ClipGradientGeometry } | undefined {
  const reader = new GradientReader(data)
  reader.u32(); reader.u32()
  const result: { flatColor?: { r: number; g: number; b: number }; stops?: ClipGradientStop[]; geometry?: ClipGradientGeometry } = {}
  while (reader.remaining >= 4) {
    const name = reader.utf16()
    if (name === "GradationData") {
      const section = new GradientReader(reader.bytes(reader.u32()))
      section.u32(); section.u32(); const count = section.u32(); section.u32()
      result.stops = Array.from({ length: count }, () => { const r = section.u32() >>> 24, g = section.u32() >>> 24, b = section.u32() >>> 24, opacity = section.u32() >>> 24; section.u32(); const position = section.u32() * 100 / 2 ** 15; const curvePoints = section.u32(); if (curvePoints) section.bytes(curvePoints * 16); return { r, g, b, opacity, position } })
    } else if (name === "GradationSettingAdd0001") {
      const section = new GradientReader(reader.bytes(reader.u32()))
      if (section.u32()) result.flatColor = { r: section.u32() >>> 24, g: section.u32() >>> 24, b: section.u32() >>> 24 }
    } else if (name === "GradationSetting") {
      const repeatMode = reader.u32(), shape = reader.u32(), antiAliasing = reader.u32(); reader.f64(); const ellipseDiameter = reader.f64(); reader.f64()
      result.geometry = { repeatMode, shape, antiAliasing, ellipseDiameter, startX: reader.f64(), startY: reader.f64(), endX: reader.f64(), endY: reader.f64() }
    } else {
      if (reader.remaining < 4) break
      reader.bytes(reader.u32())
    }
  }
  return result.flatColor || result.stops?.length && result.geometry ? result : undefined
}

function attachEditableText(layer: Layer, row: SqlRow) {
  const strings = collectBlobArray(row.TextLayerString, row.TextLayerStringArray).map((value) => Buffer.from(value).toString("utf8"))
  const attributes = collectBlobArray(row.TextLayerAttributes, row.TextLayerAttributesArray)
  if (!strings.length || !attributes.length) return
  const params = parseTextAttributes(attributes[0]!)
  const fontName = typeof params.font === "string" ? params.font : "Arial"
  const fontSize = typeof params.fontSize === "number" ? params.fontSize / 100 : 12
  const color = Array.isArray(params.color) ? params.color : [0, 0, 0]
  const bbox = Array.isArray(params.bbox) ? params.bbox : undefined
  layer.text = {
    text: strings[0]!,
    shapeType: bbox ? "box" : "point",
    style: { font: { name: fontName }, fontSize, fillColor: { r: Math.round((color[0] ?? 0) * 255), g: Math.round((color[1] ?? 0) * 255), b: Math.round((color[2] ?? 0) * 255) } },
    ...(bbox ? { left: bbox[0], top: bbox[1], right: bbox[2], bottom: bbox[3] } : {}),
  }
}

function collectBlobArray(first: SqlValue | undefined, array: SqlValue | undefined): Uint8Array[] {
  const output: Uint8Array[] = []
  if (first instanceof Uint8Array) output.push(first)
  if (!(array instanceof Uint8Array)) return output
  const view = new DataView(array.buffer, array.byteOffset, array.byteLength)
  let offset = 0
  while (offset < array.byteLength) {
    if (offset + 4 > array.byteLength) throw new Error("Truncated CLIP text attribute array.")
    const length = view.getUint32(offset, true); offset += 4
    if (offset + length > array.byteLength) throw new Error("Invalid CLIP text attribute array item length.")
    output.push(array.subarray(offset, offset + length)); offset += length
  }
  return output
}

export function parseTextAttributes(data: Uint8Array): { font?: string; fontSize?: number; color?: number[]; bbox?: number[] } {
  const output: { font?: string; fontSize?: number; color?: number[]; bbox?: number[] } = {}
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0
  while (offset + 8 <= data.byteLength) {
    const id = view.getUint32(offset, true), size = view.getUint32(offset + 4, true); offset += 8
    if (offset + size > data.byteLength) throw new Error(`Invalid CLIP text parameter ${id} length.`)
    const parameter = new DataView(data.buffer, data.byteOffset + offset, size)
    if (id === 31) output.font = Buffer.from(data.buffer, data.byteOffset + offset, size).toString("utf8")
    else if (id === 32 && size >= 4) output.fontSize = parameter.getUint32(0, true)
    else if (id === 34 && size >= 12) output.color = [parameter.getUint32(0, true), parameter.getUint32(4, true), parameter.getUint32(8, true)].map((value) => value / 0xffffffff)
    else if (id === 42 && size >= 16) output.bbox = [parameter.getInt32(0, true), parameter.getInt32(4, true), parameter.getInt32(8, true), parameter.getInt32(12, true)]
    offset += size
  }
  return output
}

function resolveBitmap(mipmapIdValue: SqlValue | undefined, chunks: Map<string, ClipExternalChunk>, offscreens: Map<number, SqlRow>, mipmaps: Map<number, SqlRow>, mipmapInfo: Map<number, SqlRow>): DecodedBitmap | undefined {
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

interface DecodedBitmap { imageData: PixelData; left: number; top: number }
export function decodeBitmap(attribute: Uint8Array, blocks: Array<Buffer | undefined>): DecodedBitmap {
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
  const existing = blocks.flatMap((block, index) => block ? [{ x: index % gridWidth, y: Math.floor(index / gridWidth) }] : [])
  if (!existing.length) return { imageData: { width: 1, height: 1, data: new Uint8ClampedArray(defaultWhite ? [255, 255, 255, 255] : [0, 0, 0, 0]) }, left: 0, top: 0 }
  const startX = Math.min(...existing.map((item) => item.x)), endX = Math.max(...existing.map((item) => item.x)) + 1
  const startY = Math.min(...existing.map((item) => item.y)), endY = Math.max(...existing.map((item) => item.y)) + 1
  const cropLeft = startX * 256, cropTop = startY * 256
  const cropWidth = Math.min(endX * 256, width) - cropLeft, cropHeight = Math.min(endY * 256, height) - cropTop
  const rgba = new Uint8ClampedArray(cropWidth * cropHeight * 4)
  if (defaultWhite) rgba.fill(255)
  const pixelsPerBlock = 256 * 256
  for (let gridY = startY; gridY < endY; gridY += 1) for (let gridX = startX; gridX < endX; gridX += 1) {
    const compressed = blocks[gridY * gridWidth + gridX]
    if (!compressed) continue
    const pixels = inflateSync(compressed)
    if (channelCount === 5 && pixels.length !== pixelsPerBlock * 5) throw new Error("Invalid CLIP RGBA bitmap block length.")
    if (channelCount === 1 && pixels.length !== pixelsPerBlock) throw new Error("Invalid CLIP mask bitmap block length.")
    const blockWidth = Math.min(256, width - gridX * 256), blockHeight = Math.min(256, height - gridY * 256)
    for (let y = 0; y < blockHeight; y += 1) for (let x = 0; x < blockWidth; x += 1) {
      const source = y * 256 + x
      const target = (((gridY - startY) * 256 + y) * cropWidth + (gridX - startX) * 256 + x) * 4
      if (channelCount === 5) {
        rgba[target] = pixels[pixelsPerBlock + source * 4 + 2]!
        rgba[target + 1] = pixels[pixelsPerBlock + source * 4 + 1]!
        rgba[target + 2] = pixels[pixelsPerBlock + source * 4]!
        rgba[target + 3] = pixels[source]!
      } else rgba[target] = rgba[target + 1] = rgba[target + 2] = rgba[target + 3] = pixels[source]!
    }
  }
  return { imageData: { width: cropWidth, height: cropHeight, data: rgba }, left: cropLeft, top: cropTop }
}

class BinaryReader {
  private offset = 0
  constructor(private readonly data: Uint8Array) {}
  u32() { if (this.offset + 4 > this.data.length) throw new Error("Truncated CLIP binary attribute."); const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4).getUint32(0); this.offset += 4; return value }
  utf16() { const length = this.u32(); const size = length * 2; if (this.offset + size > this.data.length) throw new Error("Truncated CLIP UTF-16 string."); const buffer = Buffer.from(this.data.buffer, this.data.byteOffset + this.offset, size); this.offset += size; return buffer.swap16().toString("utf16le") }
  expectUtf16(value: string) { const actual = this.utf16(); if (actual !== value) throw new Error(`Expected CLIP attribute ${value}, got ${actual}.`) }
}

class GradientReader {
  private offset = 0
  constructor(private readonly data: Uint8Array) {}
  get remaining() { return this.data.byteLength - this.offset }
  u32() { if (this.remaining < 4) throw new Error("Truncated CLIP gradient data."); const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4).getUint32(0); this.offset += 4; return value }
  f64() { if (this.remaining < 8) throw new Error("Truncated CLIP gradient number."); const value = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 8).getFloat64(0, false); this.offset += 8; return value }
  bytes(length: number) { if (length < 0 || this.remaining < length) throw new Error("Truncated CLIP gradient section."); const value = this.data.subarray(this.offset, this.offset + length); this.offset += length; return value }
  utf16() { const length = this.u32(); const value = Buffer.from(this.bytes(length * 2)); value.swap16(); return value.toString("utf16le") }
}

function queryAll(database: Database, query: string): SqlRow[] { return database.query(query).all() as SqlRow[] }
function queryOne(database: Database, query: string): SqlRow { const row = database.query(query).get() as SqlRow | null; if (!row) throw new Error(`CLIP database query returned no row: ${query}`); return row }
function numberValue(value: SqlValue | undefined, fallback = 0) { return typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : fallback }
function stringValue(value: SqlValue | undefined) { return typeof value === "string" ? value : "" }
function bytesValue(value: SqlValue | undefined): Uint8Array { if (value instanceof Uint8Array) return value; throw new Error("Expected CLIP database blob.") }
function binaryKey(value: SqlValue | undefined): string { return value instanceof Uint8Array ? Buffer.from(value).toString("ascii") : typeof value === "string" ? value : "" }
