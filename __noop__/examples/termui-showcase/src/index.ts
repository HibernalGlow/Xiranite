import { App, type KeyEvent, type MouseEvent, type Screen } from "@termuijs/core"
import { Select } from "@termuijs/ui"
import {
  Box,
  Button,
  Card,
  Checkbox,
  Gauge,
  ProgressBar,
  StatusMessage,
  Text,
  Widget,
} from "@termuijs/widgets"

const cyan = { type: "named", name: "cyan" } as const
const gray = { type: "named", name: "brightBlack" } as const

class TermUiShowcase extends Widget {
  private readonly mode: Select
  private readonly dryRun: Checkbox
  private readonly runButton: Button
  private readonly resetButton: Button
  private readonly status: StatusMessage
  private readonly progress: ProgressBar
  private readonly cpu: Gauge
  private readonly network: Gauge

  constructor() {
    super({ flexDirection: "column", padding: 1, gap: 1 })

    const title = new Box({ flexDirection: "row", height: 1, gap: 1 })
    title.addChild(new Text(" TERMUI × XIRANITE ", { bold: true, fg: cyan, height: 1 }))
    title.addChild(new Text("published packages 0.1.7 · native buffer · mouse parser", { fg: gray, height: 1 }))

    const body = new Box({ flexDirection: "row", flexGrow: 1, gap: 1 })
    const controls = new Card({ width: 38, flexDirection: "column", gap: 1, padding: 1 }, { title: "任务配置", borderColor: cyan })
    this.mode = new Select([
      { label: "倒计时", value: "countdown" },
      { label: "指定时间", value: "specific_time" },
      { label: "网络监控", value: "netspeed" },
      { label: "CPU 监控", value: "cpu" },
    ], { placeholder: "选择触发模式", onSelect: (option) => this.status.setMessage(`已选择：${option.label}`) })
    this.dryRun = new Checkbox("Dry run / 预演", undefined, {
      checked: true,
      onChange: (checked) => this.status.setMessage(checked ? "安全预演已开启" : "HAZARD：真实执行"),
    })
    controls.addChild(new Text("触发模式", { bold: true }))
    controls.addChild(this.mode)
    controls.addChild(this.dryRun)

    const actions = new Box({ flexDirection: "row", gap: 2, height: 3 })
    this.runButton = new Button("开始演练", undefined, { variant: "primary", onPress: () => this.runDemo() })
    this.resetButton = new Button("重置", undefined, { variant: "ghost", onPress: () => this.resetDemo() })
    actions.addChild(this.runButton)
    actions.addChild(this.resetButton)
    controls.addChild(actions)

    const dashboard = new Card({ flexGrow: 1, flexDirection: "column", gap: 1, padding: 1 }, { title: "系统仪表盘", borderColor: cyan })
    this.status = new StatusMessage("等待操作", undefined, { variant: "info" })
    this.progress = new ProgressBar({ width: "100%" }, { value: 42, fillColor: cyan, showLabel: true })
    this.cpu = new Gauge("CPU", undefined, { color: cyan, showLabel: true })
    this.cpu.setValue(0.34)
    this.network = new Gauge("Network", undefined, { color: { type: "named", name: "magenta" }, showLabel: true })
    this.network.setValue(0.68)
    dashboard.addChild(new Text("00 : 05 : 00", { bold: true, fg: cyan, height: 2 }))
    dashboard.addChild(this.cpu)
    dashboard.addChild(this.network)
    dashboard.addChild(this.progress)
    dashboard.addChild(this.status)

    body.addChild(controls)
    body.addChild(dashboard)
    this.addChild(title)
    this.addChild(body)
    this.addChild(new Text("Mouse: 点击两个按钮 · Keyboard: ↑/↓/Enter · Space dry-run · q 退出", { fg: gray, height: 1 }))
  }

  handleKey(event: KeyEvent): boolean {
    if (event.key === "q" || (event.ctrl && event.key === "c")) return false
    if (event.key === "up") this.mode.selectPrev()
    if (event.key === "down") this.mode.selectNext()
    if (event.key === "enter") this.mode.confirm()
    if (event.key === "space") this.dryRun.toggle()
    if (event.key === "r") this.runDemo()
    return true
  }

  handleMouse(event: MouseEvent): void {
    if (event.type !== "mousedown" || event.button !== "left") return
    // TermUI supplies parsed coordinates and widget geometry. We deliberately
    // dispatch once on mousedown, so a layout change cannot re-target mouseup.
    if (this.runButton.hitTest(event.x, event.y)) this.runDemo()
    else if (this.resetButton.hitTest(event.x, event.y)) this.resetDemo()
    else if (this.dryRun.hitTest(event.x, event.y)) this.dryRun.toggle()
  }

  private runDemo(): void {
    const safe = this.dryRun.isChecked()
    this.status.setVariant(safe ? "success" : "warning")
    this.status.setMessage(safe ? "演练任务已启动" : "危险操作仅在展示中模拟")
    this.progress.setValue(68)
    this.runButton.setLabel("运行中")
    this.markDirty()
  }

  private resetDemo(): void {
    this.dryRun.setChecked(true)
    this.status.setVariant("info")
    this.status.setMessage("已重置")
    this.progress.setValue(0)
    this.runButton.setLabel("开始演练")
    this.markDirty()
  }

  protected _renderSelf(_screen: Screen): void {}
}

const showcase = new TermUiShowcase()
const app = new App(showcase, {
  fullscreen: true,
  title: "Xiranite TermUI Showcase",
  fps: 30,
  mouse: true,
})

app.events.on("key", (event) => {
  if (!showcase.handleKey(event)) app.exit(0)
  app.requestRender()
})
app.events.on("mouse", (event) => {
  showcase.handleMouse(event)
  app.requestRender()
})

const exitCode = await app.mount()
process.exit(exitCode)
