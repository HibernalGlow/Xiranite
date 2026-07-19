import { useState, type ComponentType } from "react"
import { createRoot } from "react-dom/client"
import { Activity, Bell, BookOpen, Clock3, Crop, HardDrive, Image, ListTree, Palette } from "lucide-react"

import "../../../src/styles/tailwind.css"
import "../../../src/styles/themes/index.css"
import { CollapsibleReaderCard } from "../../../src/nodes/neoview/features/panels/CollapsibleReaderCard"
import { SettingsCardShell } from "../../../src/nodes/neoview/features/settings/SettingsCardShell"

const cards: Array<{
  title: string
  icon: ComponentType<{ className?: string }>
  titleStyle: "legend" | "inline" | "bar" | "minimal"
  panelStyle: "soft" | "solid" | "outline" | "flat"
  effect: "magic" | "plain"
}> = [
  { title: "书籍信息", icon: BookOpen, titleStyle: "legend", panelStyle: "soft", effect: "magic" },
  { title: "图像信息", icon: Image, titleStyle: "inline", panelStyle: "solid", effect: "magic" },
  { title: "存储信息", icon: HardDrive, titleStyle: "bar", panelStyle: "outline", effect: "magic" },
  { title: "时间信息", icon: Clock3, titleStyle: "minimal", panelStyle: "flat", effect: "magic" },
  { title: "页面导航", icon: ListTree, titleStyle: "legend", panelStyle: "solid", effect: "plain" },
  { title: "处理状态", icon: Activity, titleStyle: "inline", panelStyle: "outline", effect: "plain" },
  { title: "切换提示", icon: Bell, titleStyle: "bar", panelStyle: "soft", effect: "plain" },
  { title: "图像裁剪", icon: Crop, titleStyle: "minimal", panelStyle: "solid", effect: "plain" },
  { title: "界面材质", icon: Palette, titleStyle: "legend", panelStyle: "soft", effect: "magic" },
]

function Harness() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto grid max-w-[1260px] grid-cols-3 gap-4" data-neoview-card-appearance-grid>
        {cards.map(({ title, icon: Icon, titleStyle, panelStyle, effect }, index) => (
          <div key={title} data-module-title-style={titleStyle} data-module-panel-style={panelStyle} data-module-card-effect={effect}>
            <CollapsibleReaderCard title={title} icon={<Icon className="size-3.5" />} collapsed={collapsed[title] ?? false} onCollapsedChange={(next) => setCollapsed((current) => ({ ...current, [title]: next }))}>
              {index === cards.length - 1 ? (
                <SettingsCardShell id="material-preview" title={title} description="说明与操作保留，重复主标题由共享标题栏承载。" actions={<button type="button" className="rounded border px-2 py-1 text-[10px]">重置</button>}>
                  <PreviewRows />
                </SettingsCardShell>
              ) : <PreviewRows />}
            </CollapsibleReaderCard>
          </div>
        ))}
      </div>
    </main>
  )
}

function PreviewRows() {
  return <div className="grid gap-2 text-xs"><div className="flex justify-between"><span className="text-muted-foreground">状态</span><span>已就绪</span></div><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full w-2/3 bg-primary" /></div></div>
}

createRoot(document.getElementById("root")!).render(<Harness />)
