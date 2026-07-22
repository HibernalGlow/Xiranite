import type { ReaderInputAction } from "@xiranite/node-neoview/ui-core"

const COMMANDS: ReadonlyArray<readonly [string, ReaderInputAction]> = [
  ["下一页", "reader.next-page"], ["翻页", "reader.next-page"], ["上一页", "reader.previous-page"],
  ["首页", "reader.first-page"], ["末页", "reader.last-page"], ["下一本", "reader.next-book"], ["上一本", "reader.previous-book"],
  ["放大", "reader.zoom-in"], ["缩小", "reader.zoom-out"], ["适应窗口", "reader.fit-window"],
  ["全屏", "reader.fullscreen"], ["打开设置", "reader.open-settings"], ["打开文件", "file.open"], ["关闭文件", "file.close"],
]

export function readerVoiceCommandAction(
  transcript: string,
  commands?: Partial<Record<ReaderInputAction, readonly string[]>>,
): ReaderInputAction | undefined {
  const normalized = transcript.toLowerCase().replace(/[\s,.!?，。！？、]/g, "")
  if (!normalized) return undefined
  if (commands) {
    for (const [action, phrases] of Object.entries(commands) as [ReaderInputAction, readonly string[]][]) {
      if (phrases.some((phrase) => normalized.includes(phrase.toLowerCase().replace(/[\s,.!?，。！？、]/g, "")))) return action
    }
  }
  return COMMANDS.find(([phrase]) => normalized.includes(phrase))?.[1]
}
