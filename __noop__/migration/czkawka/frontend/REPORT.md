# Tauri frontend AST port report

- Source: `D:\1VSCODE\Projects\ImageAll\czkawka-tauri\ui\src`
- Source files: 224
- Assets: 0
- Import rewrites: 711
- Files with source Tauri boundaries: 16
- Files with unmapped Tauri imports: 0
- Files with unresolved source aliases: 0

## Tauri adapter boundary

- `atom/theme.ts`: `@tauri-apps/api/core`, `@tauri-apps/api/webviewWindow`
- `components/data-table.tsx`: `@tauri-apps/plugin-opener`
- `hooks/use-listen-effect.ts`: `@tauri-apps/api/event`
- `hooks/use-video-server.ts`: `@tauri-apps/api/core`
- `ipc.ts`: `@tauri-apps/api/core`, `@tauri-apps/api/mocks`
- `views/app-header.tsx`: `@tauri-apps/api/window`, `@tauri-apps/plugin-opener`
- `views/bottom-bar.tsx`: `@tauri-apps/plugin-dialog`
- `views/cards/included-dirs-card.tsx`: `@tauri-apps/plugin-dialog`
- `views/clickable-video-preview.tsx`: `@tauri-apps/api/core`
- `views/move-files.tsx`: `@tauri-apps/plugin-dialog`
- `views/preset-select.tsx`: `@tauri-apps/plugin-clipboard-manager`
- `views/save-result.tsx`: `@tauri-apps/plugin-dialog`
- `views/selection-assistant/directory-selection-section.tsx`: `@tauri-apps/plugin-dialog`
- `views/settings.tsx`: `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-opener`
- `views/similar-videos.tsx`: `@tauri-apps/api/core`
- `views/theme-panel.tsx`: `@tauri-apps/plugin-opener`

## Unmapped Tauri imports

- None

## Unresolved aliases

- None
