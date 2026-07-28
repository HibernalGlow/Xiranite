# Svelte frontend migration report

This report is generated from Svelte compiler and OXC AST evidence. A `converted` disposition means structurally suitable for codemod scaffolding; it is not a claim of behavioral parity.

- Generator: @xiranite/svelte-migrate 0.1.0
- Source commit: f4f8f02d88acdf4f639749f185c83abb91a1aa86
- Source dirty: yes
- Dirty diff hash: sha256:2ddd0edc04e9bc1407e7e7879723020b0cd45804e4483d0122768a1119f26aab
- Frontend source files: 16
- Svelte components: 13
- TypeScript/JavaScript modules: 3
- Store/rune modules: 0
- Component edges: 10
- Unresolved component imports: 0
- Tauri-using files/calls: 1/1
- Unmapped components/modules: 3/2
- Generated React TSX scaffolds: 4
- Component dispositions: converted=0, adapter-needed=0, manual=13, replaced=0, blocked=0
- Module dispositions: converted=3, adapter-needed=0, manual=0, replaced=0, blocked=0

## Component review queue

| Source | Disposition | Classification | Tauri calls | Runes | Reasons |
| --- | --- | --- | ---: | --- | --- |
| src/lib/components/panels/folderPanel/components/FolderToolbar/ActionButtons.svelte | manual | heuristic | 0 | $props | structurally convertible; requires review; React scaffold unsupported: template node ConstTag |
| src/lib/components/panels/folderPanel/components/FolderToolbar/CleanupOptionsDialog.svelte | manual | heuristic | 1 | $bindable, $props, $state | uses Tauri API and requires a host adapter; complex template behavior: BindDirective; state/reactivity requires React review: $bindable, $state |
| src/lib/components/panels/folderPanel/components/FolderToolbar/FolderToolbar.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | state/reactivity requires React review: $derived, $effect, $state; store coordination: tabBannerWidthPercent, tabCanGoBack, tabCanGoBackTab, tabCanGoForward, tabCanGoForwardTab, tabCanGoUp, tabDeleteMode, tabDeleteStrategy, tabFolderTreeConfig, tabInlineTreeMode, tabItemCount, tabMultiSelectMode, tabOpenInNewTabMode, tabPenetrateMode, tabShowMigrationBar, tabShowSearchBar, tabSortConfig, tabThumbnailWidthPercent, tabViewStyle |
| src/lib/components/panels/folderPanel/components/FolderToolbar/MoreSettingsTabs.svelte | manual | heuristic | 0 | $props, $state | state/reactivity requires React review: $state |
| src/lib/components/panels/folderPanel/components/FolderToolbar/NavigationButtons.svelte | manual | heuristic | 0 | $props, $state | complex template behavior: BindDirective; state/reactivity requires React review: $state |
| src/lib/components/panels/folderPanel/components/FolderToolbar/SortPanel.svelte | manual | heuristic | 0 | $derived, $props, $state | complex template behavior: BindDirective; state/reactivity requires React review: $derived, $state |
| src/lib/components/panels/folderPanel/components/FolderToolbar/tabs/ActionTab.svelte | manual | heuristic | 0 | $props, $state | state/reactivity requires React review: $state; store coordination: currentPathStore |
| src/lib/components/panels/folderPanel/components/FolderToolbar/tabs/DisplayTab.svelte | manual | heuristic | 0 | $props | store coordination: fileBrowserStore, hoverPreviewDelayMs, hoverPreviewEnabled |
| src/lib/components/panels/folderPanel/components/FolderToolbar/tabs/OtherTab.svelte | manual | heuristic | 0 | $props | store coordination: fileBrowserStore |
| src/lib/components/panels/folderPanel/components/FolderToolbar/TreePanel.svelte | manual | heuristic | 0 | $props | structurally convertible; requires review; React scaffold unsupported: template node ConstTag |
| src/lib/components/panels/folderPanel/components/FolderToolbar/TypeFilterBar.svelte | manual | heuristic | 0 | $props | structurally convertible; requires review; React scaffold unsupported: template node ConstTag |
| src/lib/components/panels/folderPanel/components/FolderToolbar/ViewModeButtons.svelte | manual | heuristic | 0 | $props | structurally convertible; requires review; React scaffold unsupported: instance export, template node ConstTag |
| src/lib/components/panels/folderPanel/components/FolderToolbar/ViewPanel.svelte | manual | heuristic | 0 | $props | store coordination: fileBrowserStore |

## Parse failures

None.
