import { convertWithSlimgCffi } from "./slimg-cffi.js"

interface SlimgWorkerRequest { id: number; source: string; target: string; quality: number }
interface SlimgWorkerResponse { id: number; error?: string }

self.onmessage = async (event: MessageEvent<SlimgWorkerRequest>) => {
  const { id, source, target, quality } = event.data
  try {
    await convertWithSlimgCffi(source, target, quality)
    self.postMessage({ id } satisfies SlimgWorkerResponse)
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies SlimgWorkerResponse)
  }
}
