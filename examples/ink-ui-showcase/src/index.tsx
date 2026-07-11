import {
  Alert,
  Badge,
  ConfirmInput,
  MultiSelect,
  ProgressBar,
  Select,
  Spinner,
  StatusMessage,
  TextInput,
  ThemeProvider,
  defaultTheme,
  extendTheme,
} from "@inkjs/ui"
import { MouseProvider, useMousePosition, useOnMouseClick } from "@zenobius/ink-mouse"
import { Box, Text, render, type DOMElement, type TextProps, useApp, useInput } from "ink"
import { useRef, useState, type ReactNode } from "react"

const pages = ["概览", "单选", "多选", "输入", "确认", "主题", "鼠标"] as const

const options = [
  { label: "倒计时", value: "countdown" },
  { label: "指定时间", value: "specific_time" },
  { label: "网络监控", value: "netspeed" },
  { label: "CPU 监控", value: "cpu" },
  { label: "当前状态", value: "get_stats" },
]

const xiraniteTheme = extendTheme(defaultTheme, {
  components: {
    Spinner: {
      styles: {
        frame: (): TextProps => ({ color: "magenta" }),
      },
    },
    ProgressBar: {
      styles: {
        completed: (): TextProps => ({ color: "cyan" }),
      },
    },
  },
})

function App() {
  const { exit } = useApp()
  const [page, setPage] = useState(0)
  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) exit()
    if (key.leftArrow) setPage((current) => (current - 1 + pages.length) % pages.length)
    if (key.rightArrow) setPage((current) => (current + 1) % pages.length)
  })

  return (
    <ThemeProvider theme={xiraniteTheme}>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box justifyContent="space-between">
          <Box gap={1}>
            <Text bold color="cyan">INK UI</Text>
            <Badge color="magenta">@inkjs/ui 2.0.0</Badge>
          </Box>
          <Text dimColor>←/→ 切页 · q 退出</Text>
        </Box>
        <Box marginTop={1} gap={2}>
          {pages.map((label, index) => (
            <Text key={label} bold={index === page} color={index === page ? "cyan" : "gray"}>
              {`${index === page ? "●" : "○"} ${label}`}
            </Text>
          ))}
        </Box>
        <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={2} paddingY={1} flexDirection="column" minHeight={17}>
          {page === 0 ? <Overview /> : null}
          {page === 1 ? <SelectDemo /> : null}
          {page === 2 ? <MultiSelectDemo /> : null}
          {page === 3 ? <TextInputDemo /> : null}
          {page === 4 ? <ConfirmDemo /> : null}
          {page === 5 ? <ThemeDemo /> : null}
          {page === 6 ? <MouseDemo /> : null}
        </Box>
        <Text dimColor>注意：Ink UI 自身是键盘组件库，不包含鼠标 API。</Text>
      </Box>
    </ThemeProvider>
  )
}

function Overview() {
  return (
    <Box flexDirection="column">
      <Text bold>状态与反馈组件</Text>
      <Box marginTop={1} gap={1}>
        <Badge color="green">安全</Badge>
        <Badge color="yellow">等待</Badge>
        <Badge color="red">危险</Badge>
        <Badge color="blue">信息</Badge>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <StatusMessage variant="success">配置校验通过</StatusMessage>
        <StatusMessage variant="warning">Dry run 已关闭</StatusMessage>
        <StatusMessage variant="error">真实电源操作需要确认</StatusMessage>
        <StatusMessage variant="info">当前使用 Ink renderer</StatusMessage>
      </Box>
      <Box marginTop={1}><Alert variant="warning" title="Hazard">关闭 dry run 后会真实影响系统电源状态。</Alert></Box>
      <Box marginTop={1} gap={2}><Spinner label="正在监控" /><ProgressBar value={68} /></Box>
    </Box>
  )
}

function SelectDemo() {
  const [value, setValue] = useState("countdown")
  return (
    <Box flexDirection="column">
      <Text bold>单选 Select</Text>
      <Text dimColor>↑/↓ 移动；变化即时写入状态。</Text>
      <Box marginTop={1}><Select options={options} defaultValue={value} onChange={setValue} /></Box>
      <Box marginTop={1}><StatusMessage variant="info">当前值：{value}</StatusMessage></Box>
    </Box>
  )
}

function MultiSelectDemo() {
  const [values, setValues] = useState<string[]>(["logs", "notify"])
  return (
    <Box flexDirection="column">
      <Text bold>多选 MultiSelect</Text>
      <Text dimColor>↑/↓ 移动；Space 切换；Enter 提交。</Text>
      <Box marginTop={1}>
        <MultiSelect
          options={[
            { label: "保存日志", value: "logs" },
            { label: "桌面通知", value: "notify" },
            { label: "声音提示", value: "sound" },
            { label: "执行后退出", value: "exit" },
          ]}
          defaultValue={values}
          onChange={setValues}
        />
      </Box>
      <Text color="cyan">{`已选：${values.join(", ") || "无"}`}</Text>
    </Box>
  )
}

function TextInputDemo() {
  const [value, setValue] = useState("")
  return (
    <Box flexDirection="column">
      <Text bold>文本输入 TextInput</Text>
      <Text dimColor>包含光标、占位符、提交和 suggestions 自动补全。</Text>
      <Box marginTop={1}>
        <TextInput
          placeholder="输入目标时间或预设名称…"
          suggestions={["30 分钟后", "今晚 23:30", "下载完成后"]}
          onChange={setValue}
        />
      </Box>
      <Box marginTop={1}><StatusMessage variant="info">当前输入：{value || "（空）"}</StatusMessage></Box>
    </Box>
  )
}

function ConfirmDemo() {
  const [message, setMessage] = useState("等待选择")
  return (
    <Box flexDirection="column">
      <Alert variant="error" title="真实执行确认">这个控件适合最后一道安全确认，但仍需要业务层双重保护。</Alert>
      <Box marginTop={1} gap={1}>
        <Text>执行真实睡眠操作？</Text>
        <ConfirmInput submitOnEnter={false} onConfirm={() => setMessage("已确认")} onCancel={() => setMessage("已取消")} />
      </Box>
      <Box marginTop={1}><StatusMessage variant={message === "已确认" ? "warning" : "info"}>{message}</StatusMessage></Box>
    </Box>
  )
}

function ThemeDemo() {
  return (
    <Box flexDirection="column">
      <Text bold>ThemeProvider / extendTheme</Text>
      <Text dimColor>当前页已把 Spinner 改成 magenta、ProgressBar 完成段改成 cyan。</Text>
      <Box marginTop={1} flexDirection="column">
        <Spinner label="自定义 Spinner" />
        <ProgressBar value={42} />
      </Box>
      <Box marginTop={1}><Alert variant="info" title="主题边界">Ink UI 的主题是组件级函数，不应写进节点 schema；renderer 在外层映射 Xiranite 主题 token。</Alert></Box>
    </Box>
  )
}

function MouseDemo() {
  const position = useMousePosition()
  const [leftClicks, setLeftClicks] = useState(0)
  const [rightClicks, setRightClicks] = useState(0)
  return (
    <Box flexDirection="column">
      <Text bold>@zenobius/ink-mouse 1.0.4 实验</Text>
      <Text dimColor>这是 next 版：peer 已支持 Ink 6 / React 19。点击下面两个相邻按钮检查命中是否串联。</Text>
      <Box marginTop={1} gap={2}>
        <MouseButton onClick={() => setLeftClicks((count) => count + 1)}>左按钮 {leftClicks}</MouseButton>
        <MouseButton onClick={() => setRightClicks((count) => count + 1)}>右按钮 {rightClicks}</MouseButton>
      </Box>
      <Box marginTop={1}><StatusMessage variant="info">鼠标坐标：{position.x}, {position.y}</StatusMessage></Box>
      <Box marginTop={1}><Alert variant="warning" title="评估项">检查单击是否计数一次、两个按钮是否互不触发、切页后坐标是否仍正确。</Alert></Box>
    </Box>
  )
}

function MouseButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  const ref = useRef<DOMElement>(null)
  useOnMouseClick(ref, (pressed) => {
    if (pressed) onClick()
  })
  return (
    <Box ref={ref} borderStyle="round" borderColor="cyan" paddingX={2}>
      <Text bold>{children}</Text>
    </Box>
  )
}

render(<MouseProvider><App /></MouseProvider>)
