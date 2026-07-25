# 前端测试规范

## 默认工具

Xiranite 的前端组件、交互、布局和视觉回归统一使用 Vitest Browser Mode：

- 测试运行器：`vitest`
- 浏览器 provider：`@vitest/browser-playwright`
- React 挂载器：`vitest-browser-react`
- 配置：`vitest.browser.config.ts`
- 文件名：`src/**/*.browser.test.{ts,tsx}`

Playwright 在这套架构中只负责启动浏览器，不负责发现、组织或报告测试。不得为普通前端验证新增 Playwright spec、独立 harness 页面或临时 Playwright 脚本。

## 运行方式

单文件验证：

```bash
bun run test:browser -- src/components/workspace/FloatingWindowFrame.browser.test.tsx
```

全部 Browser Mode 测试：

```bash
bun run test:browser
```

配置优先使用 `XIRANITE_E2E_CHROME_PATH`，随后查找 Scoop Chrome 和 Windows 常规 Chrome 安装位置。Windows 上必须保持 `--maxWorkers=1`，并与 build、typecheck、其他 Vitest 和原生构建严格串行。

## 测试分层

普通 Vitest 适用于纯函数、状态归一化、持久化协议和不依赖真实布局的组件逻辑。Browser Mode 适用于以下任一情况：

- hover、focus、pointer、键盘或真实点击行为；
- CSS 尺寸、定位、overflow、层级或响应式布局；
- 动画前后状态、浏览器可见性和可访问性；
- 过去需要打开完整应用深层入口才能验证的组件。

Browser Mode 测试应直接挂载最小生产组件，注入所需 props、store 和 provider，并验证用户动作后的可见结果。不要先导航完整工作区，也不要为了测试创建第二套生产 UI。

真正依赖 Wails 生命周期、原生窗口、进程、文件系统或跨进程 RPC 的行为不属于浏览器组件测试，应使用 Go 或宿主集成测试。遗留 Playwright E2E 仅维持兼容；修改其覆盖的普通前端行为时，优先把相关断言迁移为 Browser Mode 测试。

## 最小示例

```tsx
import { page } from "vitest/browser"
import { expect, test } from "vitest"
import { render } from "vitest-browser-react"

test("expands a control on hover", async () => {
  const screen = await render(<Control />)
  const control = screen.getByRole("button", { name: "展开" })

  await control.hover()
  await expect.element(page.getByText("完整操作")).toBeVisible()
})
```

断言优先使用 Vitest Browser locator 和 `expect.element`，异步几何或动画状态使用 `expect.poll`。测试必须覆盖实际交互结果，不得以编译通过、静态 class 或空页面截图代替。
