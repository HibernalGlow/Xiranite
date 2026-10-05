/**
 * 测试夹具：带种子的伪随机噪声 PNG（xorshift32，可复现）。
 *
 * 每像素独立取字节才压得动不动：先前按行号算出的「噪声」行间高度重复，
 * 1600×1200 只有 42 KB，测不出「超大原图」这条路径。随机字节近乎不可压缩，
 * 体积随像素数线性增长，才是稳定的超大夹具。
 */
export async function createNoisePngFile(width: number, height: number): Promise<File> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("canvas 2d context unavailable")
  const image = context.createImageData(width, height)
  let state = 0x9e3779b9
  const nextByte = () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state & 0xff
  }
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = nextByte()
    image.data[index + 1] = nextByte()
    image.data[index + 2] = nextByte()
    image.data[index + 3] = 255
  }
  context.putImageData(image, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("canvas.toBlob returned null"))), "image/png")
  })
  return new File([blob], "noise.png", { type: "image/png" })
}

export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}
