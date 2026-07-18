---
name: verify-neoview-reader
description: Launch and drive the real NeoView Reader GUI with its local backend.
---

# Verify NeoView Reader

1. Start the real frontend and authenticated backend from the repository root:
   `bun run dev`
2. Wait for the log to print both `[xiranite-backend]` and `[xiranite-frontend]` URLs.
3. Use Node, not Bun, to run Playwright scripts (`node <script>.mjs`); Bun can hang while launching Chromium on Windows.
4. Navigate to:
   `http://127.0.0.1:5173/tests/e2e/neoview/neoview-book-information-harness.html?path=<encoded-path>`
5. If the top toolbar is hidden, open a previously visited fixture through its `继续阅读：<name>` history action. Move the mouse to x=viewportWidth-2 to reveal the right sidebar.
6. Use role names `属性` and `本书设置` to reach the Book Settings Card. Observe `/reader/s/*/book-settings` GET/PATCH requests and capture screenshots under `artifacts/`.
7. Prefer `waitUntil: "domcontentloaded"`; Vite may keep or retrigger the load event when worktree tsconfig files change.
8. Stop the background `bun run dev` task after capture.
