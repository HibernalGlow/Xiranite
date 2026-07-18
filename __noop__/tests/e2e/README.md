# Xiranite Playwright E2E

这里放真实浏览器测试，只验证跨模块用户路径、窗口尺寸、截图/视觉回归和桌面壳接近的交互。

- 单个节点包的 core、CLI、Component 功能仍然放在各自 `packages/nodes/<id>/src/*.test.*`，使用 Vitest。
- HTTP/RPC mock 使用 `tests/utils/msw.ts`。
- Playwright 输出统一写入 `artifacts/playwright` 和 `artifacts/playwright-report`，不会进入 git。
- 如果已有外部 dev server，可以设置 `XIRANITE_E2E_BASE_URL=http://127.0.0.1:<port>`，避免 Playwright 自动启动 Vite。
