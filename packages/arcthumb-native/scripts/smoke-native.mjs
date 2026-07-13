import { getArcThumbInfo } from "../dist/index.js"

const info = getArcThumbInfo()
if (info.apiVersion !== 1 || info.sourceVersion !== "0.10.1") {
  throw new Error(`Unexpected ArcThumb info: ${JSON.stringify(info)}`)
}
console.log(JSON.stringify(info))
