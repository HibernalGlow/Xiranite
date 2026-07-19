/**
 * Static about / capability summary for NeoView settings.
 */
import { Info } from "lucide-react"

import type { ReaderPanelContext, ReaderSettingsCardContext } from "../../panels/registry"
import { SettingsCardSection, SettingsCardShell } from "../SettingsCardShell"

const CAPABILITIES = [
  { name: "阅读与会话", detail: "目录/归档阅读、进度恢复、历史与书签" },
  { name: "边栏与卡片", detail: "左右边栏、面板布局、卡片显隐与高度" },
  { name: "操作绑定", detail: "键盘/鼠标/触控/手柄与径向菜单" },
  { name: "影像与媒体", detail: "图片/视频格式、动图与字幕默认值" },
  { name: "超分", detail: "后端契约可用；侧栏超分卡按能力逐步接入" },
  { name: "数据迁移", detail: "旧 NeoView 设置 inspect/import" },
] as const

export function AboutSettingsCard() {
  return (
    <SettingsCardShell
      id="about-settings"
      title="关于 NeoView"
      description="Xiranite 节点版阅读器。配置写入 [nodes.neoview]，运行数据沿用原 NeoView 兼容库。"
      icon={Info}
    >
      <SettingsCardSection title="节点">
        <dl className="grid gap-2 text-sm">
          <div className="flex justify-between gap-3 rounded-md border bg-background/60 px-3 py-2">
            <dt className="text-muted-foreground">节点</dt>
            <dd className="font-medium">neoview</dd>
          </div>
          <div className="flex justify-between gap-3 rounded-md border bg-background/60 px-3 py-2">
            <dt className="text-muted-foreground">配置命名空间</dt>
            <dd className="font-mono text-xs">[nodes.neoview]</dd>
          </div>
          <div className="flex justify-between gap-3 rounded-md border bg-background/60 px-3 py-2">
            <dt className="text-muted-foreground">运行库</dt>
            <dd className="text-right text-xs">%APPDATA%/NeoView/thumbnails.db</dd>
          </div>
        </dl>
      </SettingsCardSection>
      <SettingsCardSection title="能力摘要">
        <ul className="grid gap-2">
          {CAPABILITIES.map((item) => (
            <li key={item.name} className="rounded-md border bg-background/60 px-3 py-2">
              <div className="text-sm font-medium">{item.name}</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>
            </li>
          ))}
        </ul>
      </SettingsCardSection>
    </SettingsCardShell>
  )
}

export function SettingsAboutCard(_context: ReaderSettingsCardContext) {
  return <AboutSettingsCard />
}

export default function DockedAboutSettingsCard(_context: ReaderPanelContext) {
  return <AboutSettingsCard />
}
