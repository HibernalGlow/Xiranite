import * as wasiShim from "@bjorn3/browser_wasi_shim"
import { makeZip } from "client-zip"

interface PandocRequest { wasm: ArrayBuffer; input: ArrayBuffer; inputName: string; target: string }
self.onmessage = async (event: MessageEvent<PandocRequest>) => {
  try {
    const result = await runPandoc(event.data)
    self.postMessage(result, { transfer: [result.output] })
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}

async function runPandoc({ wasm, input, inputName, target }: PandocRequest): Promise<{ output: ArrayBuffer; isZip: boolean }> {
  let stderr = ""
  const inputFile = new wasiShim.File(new Uint8Array(input), { readonly: true })
  const outputFile = new wasiShim.File(new Uint8Array(), { readonly: false })
  const root = new wasiShim.PreopenDirectory("/", new Map([["in", inputFile], ["out", outputFile]]))
  const fds = [new wasiShim.OpenFile(new wasiShim.File(new Uint8Array(), { readonly: true })), wasiShim.ConsoleStdout.lineBuffered(() => {}), wasiShim.ConsoleStdout.lineBuffered((message) => { stderr += `${message}\n` }), root, new wasiShim.PreopenDirectory("/tmp", new Map())]
  const args = ["pandoc.wasm", "+RTS", "-H64m", "-RTS"]
  const wasi = new wasiShim.WASI(args, [], fds, { debug: false })
  const { instance } = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: wasi.wasiImport }) as { instance: WebAssembly.Instance & { exports: Record<string, WebAssembly.ExportValue> } }
  const exports = instance.exports as unknown as { memory: WebAssembly.Memory; malloc: (size: number) => number; __wasm_call_ctors: () => void; hs_init_with_rtsopts: (argc: number, argv: number) => void; wasm_main: (args: number, length: number) => void }
  wasi.initialize(instance)
  exports.__wasm_call_ctors()
  const view = () => new DataView(exports.memory.buffer)
  const argcPointer = exports.malloc(4); view().setUint32(argcPointer, args.length, true)
  const argv = exports.malloc(4 * (args.length + 1))
  for (let index = 0; index < args.length; index += 1) { const bytes = new TextEncoder().encode(args[index]); const pointer = exports.malloc(bytes.length + 1); new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes); view().setUint8(pointer + bytes.length, 0); view().setUint32(argv + 4 * index, pointer, true) }
  view().setUint32(argv + 4 * args.length, 0, true); const argvPointer = exports.malloc(4); view().setUint32(argvPointer, argv, true); exports.hs_init_with_rtsopts(argcPointer, argvPointer)
  const command = `-f ${reader(extension(inputName))} -t ${reader(target)} --extract-media=.`
  const commandBytes = new TextEncoder().encode(command); const commandPointer = exports.malloc(commandBytes.length); new Uint8Array(exports.memory.buffer, commandPointer, commandBytes.length).set(commandBytes); exports.wasm_main(commandPointer, commandBytes.length)
  if (!outputFile.data.length) throw new Error(stderr.trim() || "Pandoc Wasm produced no output")
  const output = new Uint8Array(outputFile.data).slice()
  const extracted = readExtractedEntries(root)
  if (extracted.length) {
    const dot = inputName.lastIndexOf(".")
    const outputName = `${dot > 0 ? inputName.slice(0, dot) : inputName}.${target.replace(/^\./, "")}`
    const files = [...extracted, new File([output], outputName)]
    const chunks: Uint8Array[] = []
    const reader = makeZip(files).getReader()
    while (true) { const part = await reader.read(); if (part.done) break; if (part.value) chunks.push(part.value) }
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const zipped = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { zipped.set(chunk, offset); offset += chunk.length }
    return { output: zipped.buffer, isZip: true }
  }
  return { output: output.buffer, isZip: false }
}

function readExtractedEntries(root: wasiShim.PreopenDirectory): File[] {
  const rootDirectory = root.dir.path_open(0, BigInt(0), 0).fd_obj?.path_lookup(".", 0).inode_obj
  if (!(rootDirectory instanceof wasiShim.Directory)) return []
  return flattenEntries(rootDirectory.contents, "").filter((file) => file.name !== "in" && file.name !== "out")
}

function flattenEntries(contents: Map<string, wasiShim.File | wasiShim.Directory>, parent: string): File[] {
  const files: File[] = []
  for (const [name, entry] of contents) {
    const path = parent ? `${parent}/${name}` : name
    if (entry instanceof wasiShim.Directory) files.push(...flattenEntries(entry.contents as Map<string, wasiShim.File | wasiShim.Directory>, path))
    else files.push(new File([new Uint8Array(Array.from(entry.data))], path))
  }
  return files
}

function extension(name: string): string { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1).toLowerCase() : "" }
function reader(value: string): string { const format = value.replace(/^\./, "").toLowerCase(); if (format === "md" || format === "markdown") return "markdown"; if (format === "doc") return "docx"; return format }
