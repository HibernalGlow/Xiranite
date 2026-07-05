import type { NodeEntry } from "@xiranite/contract"
import { Component } from "./Component.js"
import * as core from "./core.js"

const entry: NodeEntry<typeof core> = {
  def: {
    id: "weibospider",
    name: "WeiboSpider",
    version: "0.1.0",
    category: "crawler",
    description: "Crawl weibo.cn user posts, validate cookies, and write JSON/CSV/TXT outputs.",
    icon: "Users",
    keywords: ["weibo", "crawler", "cookie", "media"],
  },
  Component,
  core,
}

export { Component }
export * from "./core.js"
export default entry
