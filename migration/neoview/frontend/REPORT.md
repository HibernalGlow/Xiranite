# Svelte frontend migration report

This report is generated from Svelte compiler and OXC AST evidence. A `converted` disposition means structurally suitable for codemod scaffolding; it is not a claim of behavioral parity.

- Generator: @xiranite/svelte-migrate 0.1.0
- Source commit: a4c4e07401e0e0c3e4d77edba096f6fd5b3e0c45
- Source dirty: no
- Dirty diff hash: -
- Frontend source files: 998
- Svelte components: 551
- TypeScript/JavaScript modules: 447
- Store/rune modules: 142
- Component edges: 766
- Unresolved component imports: 0
- Tauri-using files/calls: 107/389
- Unmapped components/modules: 0/0
- Component dispositions: converted=124, adapter-needed=22, manual=114, replaced=282, blocked=9
- Module dispositions: converted=246, adapter-needed=45, manual=75, replaced=77, blocked=4

## Component review queue

| Source | Disposition | Classification | Tauri calls | Runes | Reasons |
| --- | --- | --- | ---: | --- | --- |
| src/App.svelte | adapter-needed | heuristic | 6 | $state | uses Tauri API and requires a host adapter |
| src/lib/cards/ai/AiPanelCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/ai/AiServiceConfigCard.svelte | manual | heuristic | 2 | $effect, $state | uses Tauri API and requires a host adapter; complex rune graph: $effect, $state; store coordination: aiTranslationStore |
| src/lib/cards/ai/AiTitleTranslationCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: aiTranslationStore |
| src/lib/cards/ai/AiTranslationCacheCard.svelte | manual | heuristic | 1 | $effect, $state | uses Tauri API and requires a host adapter; complex rune graph: $effect, $state; store coordination: aiTranslationStore |
| src/lib/cards/ai/AiTranslationTestCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/cards/ai/TranslationOverlayCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/ai/VoiceControlCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/cards/benchmark/ArchivesCard.svelte | adapter-needed | heuristic | 3 | $state | uses Tauri API and requires a host adapter |
| src/lib/cards/benchmark/DetailedCard.svelte | adapter-needed | heuristic | 2 | $state | uses Tauri API and requires a host adapter |
| src/lib/cards/benchmark/FilesCard.svelte | adapter-needed | heuristic | 2 | $state | uses Tauri API and requires a host adapter |
| src/lib/cards/benchmark/ImageSourceCard.svelte | manual | heuristic | 5 | $state | uses Tauri API and requires a host adapter; store coordination: assetCache, blobCache |
| src/lib/cards/benchmark/LatencyCard.svelte | adapter-needed | heuristic | 6 | $derived, $state | uses Tauri API and requires a host adapter |
| src/lib/cards/benchmark/LoadModeCard.svelte | adapter-needed | heuristic | 3 | $state | uses Tauri API and requires a host adapter |
| src/lib/cards/benchmark/PageFlipMonitorCard.svelte | converted | heuristic | 0 | $derived, $state | structurally convertible; requires review |
| src/lib/cards/benchmark/PipelineLatencyCard.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/cards/benchmark/ProtocolTestCard.svelte | adapter-needed | heuristic | 2 | $derived, $state | uses Tauri API and requires a host adapter |
| src/lib/cards/benchmark/RealWorldCard.svelte | adapter-needed | heuristic | 2 | $state | uses Tauri API and requires a host adapter |
| src/lib/cards/benchmark/RendererCard.svelte | adapter-needed | heuristic | 3 | $derived, $state | uses Tauri API and requires a host adapter |
| src/lib/cards/benchmark/ResultsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/benchmark/SummaryCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/benchmark/ThumbnailLatencyCard.svelte | adapter-needed | heuristic | 4 | $derived, $state | uses Tauri API and requires a host adapter |
| src/lib/cards/benchmark/TranscodeBenchmarkCard.svelte | adapter-needed | heuristic | 2 | $state | uses Tauri API and requires a host adapter |
| src/lib/cards/benchmark/VisibilityCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/bookmark/BookmarkListCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/CardRenderer.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: componentCache |
| src/lib/cards/folder/cards/BreadcrumbTabCard.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/cards/folder/cards/FileListCard.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: folderTreeConfig, tabCurrentPath, tabSearchResults |
| src/lib/cards/folder/cards/FolderTreeCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/folder/cards/ToolbarCard.svelte | manual | heuristic | 0 | $derived, $props | store coordination: localSearchStore.isSearching, localSearchStore.keyword, localSearchStore.results |
| src/lib/cards/folder/FolderMainCard.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/cards/history/HistoryListCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/info/AmbientBackgroundCard.svelte | converted | heuristic | 0 | $derived, $state | structurally convertible; requires review |
| src/lib/cards/info/AnimatedVideoModeCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state |
| src/lib/cards/info/BookInfoCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: infoPanelStore |
| src/lib/cards/info/ColorFilterCard.svelte | manual | heuristic | 0 | $state | store coordination: filterStore |
| src/lib/cards/info/ImageInfoCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: infoPanelStore |
| src/lib/cards/info/ImageTrimCard.svelte | manual | heuristic | 0 | $derived, $state | store coordination: imageTrimStore |
| src/lib/cards/info/InfoOverlayCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/cards/info/PageTransitionCard.svelte | manual | heuristic | 0 | $state | store coordination: pageTransitionStore |
| src/lib/cards/info/PreloadStatusCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state |
| src/lib/cards/info/SidebarControlCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: bottomThumbnailBarPinned, leftSidebarOpen, leftSidebarPinned, rightSidebarOpen, rightSidebarPinned, topToolbarPinned, bottomThumbnailBarPinned, leftSidebarOpen, leftSidebarPinned, rightSidebarOpen, rightSidebarPinned, topToolbarPinned |
| src/lib/cards/info/SidebarHeightCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state |
| src/lib/cards/info/StorageCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: infoPanelStore |
| src/lib/cards/info/SwitchToastCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/cards/info/TimeCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: infoPanelStore |
| src/lib/cards/insights/BookmarkOverviewCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state; store coordination: bookmarkStore |
| src/lib/cards/insights/DailyTrendCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state; store coordination: unifiedHistoryStore, bucketMap |
| src/lib/cards/insights/EmmTagsHotCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state; store coordination: emmMetadataStore |
| src/lib/cards/insights/ReadingHeatmapCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state; store coordination: unifiedHistoryStore |
| src/lib/cards/insights/ReadingStreakCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state; store coordination: unifiedHistoryStore |
| src/lib/cards/insights/SourceBreakdownCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state; store coordination: unifiedHistoryStore |
| src/lib/cards/monitor/components/CpuMonitor.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/cards/monitor/components/GpuMonitor.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/monitor/components/IoMonitor.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/cards/monitor/components/MemoryMonitor.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/cards/monitor/components/ProgressBar.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/cards/monitor/SystemMonitorCard.svelte | adapter-needed | heuristic | 1 | $state | uses Tauri API and requires a host adapter |
| src/lib/cards/pageList/PageContextMenu.svelte | manual | heuristic | 2 | $effect, $props, $state | uses Tauri API and requires a host adapter; complex template behavior: UseDirective; complex rune graph: $effect, $props, $state |
| src/lib/cards/pageList/PageIndexBadge.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/cards/pageList/PageListCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state |
| src/lib/cards/PanelContainer.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/cards/properties/AiApiConfigCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: aiApiConfigStore |
| src/lib/cards/properties/AiTagsCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: aiApiConfigStore |
| src/lib/cards/properties/BookSettingsCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: infoPanelStore |
| src/lib/cards/properties/EmmConfigCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/properties/EmmRawDataCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: infoPanelStore |
| src/lib/cards/properties/EmmSyncCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/properties/EmmTagsCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: infoPanelStore |
| src/lib/cards/properties/FavoriteTagsCard.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/cards/properties/FileListTagDisplayCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/properties/FolderRatingsCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: folderRatingStore |
| src/lib/cards/properties/ManualTagsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/properties/ThumbnailArchitectureMetricsCard.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/cards/properties/ThumbnailMaintenanceCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/BindingsSettingsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/BookSettingsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/CardManagementCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/DataSettingsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/GeneralSettingsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/ImageSettingsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/NotificationSettingsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/PanelManagementCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/PerformanceSettingsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/SystemSettingsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/settings/ThemeSettingsCard.svelte | replaced | config-override | 0 | - | Legacy theme editors and previews are replaced by the Xiranite host theme and TOML settings. |
| src/lib/cards/settings/ViewSettingsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/shared/FileListPanel.svelte | manual | heuristic | 1 | $effect, $props, $state | uses Tauri API and requires a host adapter; complex rune graph: $effect, $props, $state; store coordination: externalNavigationRequest, ctx.navigationCommand, externalNavigationRequest |
| src/lib/cards/upscale/ConditionActionEditor.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/cards/upscale/ConditionHeader.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/upscale/ConditionMatchEditor.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/cards/upscale/ProgressiveUpscaleCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state |
| src/lib/cards/upscale/UpscaleCacheCard.svelte | adapter-needed | heuristic | 2 | $state | uses Tauri API and requires a host adapter |
| src/lib/cards/upscale/UpscaleConditionsCard.svelte | converted | heuristic | 0 | $derived, $state | structurally convertible; requires review |
| src/lib/cards/upscale/UpscaleControlCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/cards/upscale/UpscaleModelCard.svelte | adapter-needed | heuristic | 1 | $state | uses Tauri API and requires a host adapter |
| src/lib/cards/upscale/UpscalePanelConditionTabs.svelte | manual | heuristic | 0 | $bindable, $effect, $props, $state | complex rune graph: $bindable, $effect, $props, $state |
| src/lib/cards/upscale/UpscaleStatusCard.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state |
| src/lib/CardWindow.svelte | adapter-needed | heuristic | 1 | $derived, $state | uses Tauri API and requires a host adapter |
| src/lib/components/benchmark/LatencyCard.svelte | adapter-needed | heuristic | 5 | $derived, $props, $state | uses Tauri API and requires a host adapter |
| src/lib/components/browser/FileSystemBrowser.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/components/cards/CardHeaderContextMenu.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/cards/CollapsibleCard.svelte | manual | heuristic | 0 | $bindable, $derived, $effect, $props, $state | complex template behavior: TransitionDirective; complex rune graph: $bindable, $derived, $effect, $props, $state |
| src/lib/components/cardwindow/CardWindowContent.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: componentCache |
| src/lib/components/cardwindow/TabBar.svelte | converted | heuristic | 0 | $bindable, $props, $state | structurally convertible; requires review |
| src/lib/components/cardwindow/TabContextMenu.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/common/ButtonGroup.svelte | replaced | config-override | 0 | $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/common/DropdownPanel.svelte | replaced | config-override | 0 | $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/common/PanelBase.svelte | replaced | config-override | 0 | $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/common/ToolbarBase.svelte | replaced | config-override | 0 | $derived, $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/debug/PageFlipMonitorPanel.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/dialogs/AreaClickRecorder.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/dialogs/GestureSettingsPanel.svelte | manual | heuristic | 0 | $derived, $state | store coordination: gestureBindings |
| src/lib/components/dialogs/GestureVisualizer.svelte | manual | heuristic | 0 | $props, $state | complex template behavior: element:canvas |
| src/lib/components/dialogs/KeyBindingPanel.svelte | converted | heuristic | 0 | $derived, $state | structurally convertible; requires review |
| src/lib/components/dialogs/MouseGestureRecorder.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/dialogs/MouseKeyRecorder.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/components/dialogs/MouseRecordingArea.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/components/dialogs/MouseSettingsPanel.svelte | manual | heuristic | 0 | $derived, $state | store coordination: mouseGestureBindings, mouseWheelBindings |
| src/lib/components/dialogs/QuickLibraryDialog.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/components/dialogs/RadialMenuSettingsPanel.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state; store coordination: groups, itemsBySlot |
| src/lib/components/dialogs/SettingsDialog.svelte | manual | heuristic | 0 | $bindable, $effect, $props, $state | complex rune graph: $bindable, $effect, $props, $state |
| src/lib/components/dialogs/UnifiedBindingPanel.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state; store coordination: bindingMap |
| src/lib/components/dialogs/ViewerSettingsPanel.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/layout/AutoHideThumbnailBar.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/components/layout/AutoHideTopbar.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/layout/BaseSidebar.svelte | manual | heuristic | 0 | $bindable, $derived, $effect, $props, $state | complex rune graph: $bindable, $derived, $effect, $props, $state; store coordination: pinnedStore, widthStore |
| src/lib/components/layout/BottomThumbnailBar.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state; store coordination: appState, bottomThumbnailBarHeight, bottomThumbnailBarPinned |
| src/lib/components/layout/HoverWrapper.svelte | manual | heuristic | 0 | $bindable, $effect, $props, $state | complex rune graph: $bindable, $effect, $props, $state |
| src/lib/components/layout/LeftSidebar.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: appState, leftSidebarOpen, leftSidebarPinned, leftSidebarWidth |
| src/lib/components/layout/MainLayout.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: leftSidebarWidth, rightSidebarWidth |
| src/lib/components/layout/PanelTabBar.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/layout/RightSidebar.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: rightSidebarOpen, rightSidebarPinned, rightSidebarWidth |
| src/lib/components/layout/StatusBar.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/layout/TabBar.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/layout/TitleBar.svelte | adapter-needed | heuristic | 1 | - | uses Tauri API and requires a host adapter |
| src/lib/components/layout/TitleBarSection.svelte | manual | heuristic | 1 | $effect, $props, $state | uses Tauri API and requires a host adapter; complex rune graph: $effect, $props, $state; store coordination: bottomThumbnailBarPinned, leftSidebarOpen, leftSidebarPinned, merged, rightSidebarOpen, rightSidebarPinned, topToolbarPinned |
| src/lib/components/layout/TopToolbar/HoverScrollPanel.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/components/layout/TopToolbar/MagnifierPanel.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/components/layout/TopToolbar/RotatePanel.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/components/layout/TopToolbar/SlideshowPanel.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/layout/TopToolbar/SortPanel.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/components/layout/TopToolbar/TopToolbar.svelte | manual | heuristic | 1 | $derived, $effect, $state | uses Tauri API and requires a host adapter; complex rune graph: $derived, $effect, $state; store coordination: appState, appState, topToolbarHeight, topToolbarPinned |
| src/lib/components/layout/TopToolbar/ZoomPanel.svelte | manual | heuristic | 0 | $derived, $props, $state | store coordination: appState |
| src/lib/components/panels/AboutPanel.svelte | adapter-needed | heuristic | 1 | - | uses Tauri API and requires a host adapter |
| src/lib/components/panels/AiPanel.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/panels/BenchmarkCard.svelte | manual | heuristic | 2 | $state | uses Tauri API and requires a host adapter; store coordination: decodeStats, thumbStats |
| src/lib/components/panels/BenchmarkPanel.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/panels/BookmarkPanel.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/panels/BookPageListPanel.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/panels/BookSettingsPanel.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/panels/ControlPanel.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/panels/DataInsightsPanel.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/panels/DataSettingsPanel.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/panels/emm/EmmConfigCard.svelte | manual | heuristic | 4 | $state | uses Tauri API and requires a host adapter; store coordination: emmMetadataStore, infoPanelStore |
| src/lib/components/panels/emm/EmmPanelSection/EmmPanelSection.svelte | manual | heuristic | 4 | $derived, $effect, $state | uses Tauri API and requires a host adapter; complex rune graph: $derived, $effect, $state; store coordination: emmMetadataStore, infoPanelStore, map |
| src/lib/components/panels/emm/EmmPanelSection/FavoriteTagsPanel.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/panels/emm/EmmPanelSection/RatingsPanel.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: folderRatingStore |
| src/lib/components/panels/emm/EmmPanelSection/TagsPanel.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: groupMap |
| src/lib/components/panels/emm/EmmSyncCard.svelte | manual | heuristic | 1 | $derived, $effect, $state | uses Tauri API and requires a host adapter; complex rune graph: $derived, $effect, $state; store coordination: emmSyncStore |
| src/lib/components/panels/emm/FileListTagDisplayCard.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state; store coordination: fileListTagSettings |
| src/lib/components/panels/emm/ThumbnailDbMaintenanceCard.svelte | manual | heuristic | 8 | $effect, $state | uses Tauri API and requires a host adapter; complex rune graph: $effect, $state |
| src/lib/components/panels/file/components/FileBrowserList.svelte | manual | heuristic | 0 | $bindable, $effect, $props, $state | complex rune graph: $bindable, $effect, $props, $state |
| src/lib/components/panels/file/components/FileItemCard.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: aiTranslationStore, emmMetadataStore, fileBrowserStore, fileListTagSettings, tabPenetrateMode, namespaceDisplayCache, objectIdMap, tagTranslationCache |
| src/lib/components/panels/file/components/FileItemGridView.svelte | manual | heuristic | 0 | $derived, $props | store coordination: globalImageAspectRatios |
| src/lib/components/panels/file/components/FileItemListView.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/panels/file/components/FileTreeView.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: currentNode.children |
| src/lib/components/panels/file/components/FolderPreviewGrid.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/panels/file/components/FolderRatingBadge.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/panels/file/components/HorizontalListSlider.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/components/panels/file/components/ListSlider.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/components/panels/file/components/VirtualizedFileListV2.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex template behavior: UseDirective; complex rune graph: $derived, $effect, $props, $state; store coordination: scrollPositions |
| src/lib/components/panels/folderPanel/components/AdvancedSearchPanel.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/BreadcrumbBar.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: tabCurrentPath |
| src/lib/components/panels/folderPanel/components/FavoriteTagPanel.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderContextMenu.svelte | manual | heuristic | 0 | $effect, $props, $state | complex template behavior: UseDirective; complex rune graph: $effect, $props, $state; store coordination: folderTreePinStore |
| src/lib/components/panels/folderPanel/components/FolderList.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: randomSeedCache |
| src/lib/components/panels/folderPanel/components/FolderListItem.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderStack.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: collectTagCountStore, fileBrowserStore, displayItemsCache, navigationCommand |
| src/lib/components/panels/folderPanel/components/FolderTabBar.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/ActionButtons.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/CleanupOptionsDialog.svelte | adapter-needed | heuristic | 1 | $bindable, $props, $state | uses Tauri API and requires a host adapter |
| src/lib/components/panels/folderPanel/components/FolderToolbar/FolderToolbar.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: tabBannerWidthPercent, tabCanGoBack, tabCanGoBackTab, tabCanGoForward, tabCanGoForwardTab, tabCanGoUp, tabDeleteMode, tabDeleteStrategy, tabFolderTreeConfig, tabInlineTreeMode, tabItemCount, tabMultiSelectMode, tabOpenInNewTabMode, tabPenetrateMode, tabShowMigrationBar, tabShowSearchBar, tabSortConfig, tabThumbnailWidthPercent, tabViewStyle |
| src/lib/components/panels/folderPanel/components/FolderToolbar/MoreSettingsTabs.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/NavigationButtons.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/SortPanel.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/tabs/ActionTab.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/tabs/DisplayTab.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/tabs/OtherTab.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/TreePanel.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/TypeFilterBar.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/ViewModeButtons.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderToolbar/ViewPanel.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/FolderTree.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: folderTreePinStore, loadChildrenInFlight |
| src/lib/components/panels/folderPanel/components/InlineTreeList.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: childrenCache |
| src/lib/components/panels/folderPanel/components/MigrationBar.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/PenetrateSettingsBar.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/panels/folderPanel/components/SearchResultList.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state |
| src/lib/components/panels/folderPanel/components/SelectionBar.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: fileBrowserStore |
| src/lib/components/panels/folderPanel/FolderPanel.svelte | manual | heuristic | 0 | $derived, $effect | complex rune graph: $derived, $effect |
| src/lib/components/panels/GeneralSettingsPanel.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/components/panels/GistSyncPanel.svelte | converted | heuristic | 0 | $derived, $state | structurally convertible; requires review |
| src/lib/components/panels/HistoryPanel.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/panels/IconSettingsPanel.svelte | manual | heuristic | 4 | $effect, $state | uses Tauri API and requires a host adapter; complex rune graph: $effect, $state |
| src/lib/components/panels/ImagePropertiesPanel.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/panels/ImageSettingsPanel.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/panels/InfoPanel.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state; store coordination: infoPanelStore |
| src/lib/components/panels/insights/ReadingHeatmapChart.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/panels/insights/ReadingStreakChart.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/panels/insights/ThumbnailDbCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/components/panels/NotificationSettingsPanel.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/components/panels/PageListPanel.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/components/panels/PerformanceSettingsPanel.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/panels/PlaylistPanel.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state |
| src/lib/components/panels/SettingsCardPanel.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/panels/SettingsPanel.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/components/panels/shared/PanelCard.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/shared/PanelToolbar.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/panels/SidebarManagementPanel.svelte | adapter-needed | heuristic | 1 | $derived, $state | uses Tauri API and requires a host adapter |
| src/lib/components/panels/StartupConfigPanel.svelte | adapter-needed | heuristic | 1 | $state | uses Tauri API and requires a host adapter |
| src/lib/components/panels/SystemSettingsPanel.svelte | converted | heuristic | 0 | $derived, $state | structurally convertible; requires review |
| src/lib/components/panels/theme/ColorSchemeTab.svelte | replaced | config-override | 0 | $props, $state | Legacy theme editors and previews are replaced by the Xiranite host theme and TOML settings. |
| src/lib/components/panels/theme/FontTab.svelte | replaced | config-override | 0 | $effect, $state | Legacy theme editors and previews are replaced by the Xiranite host theme and TOML settings. |
| src/lib/components/panels/theme/ThemeModeTab.svelte | replaced | config-override | 0 | $props | Legacy theme editors and previews are replaced by the Xiranite host theme and TOML settings. |
| src/lib/components/panels/theme/TransparencyTab.svelte | replaced | config-override | 0 | $state | Legacy theme editors and previews are replaced by the Xiranite host theme and TOML settings. |
| src/lib/components/panels/ThemePanel.svelte | replaced | config-override | 0 | $state | Legacy theme editors and previews are replaced by the Xiranite host theme and TOML settings. |
| src/lib/components/panels/ThemePreview.svelte | replaced | config-override | 0 | - | Legacy theme editors and previews are replaced by the Xiranite host theme and TOML settings. |
| src/lib/components/panels/UpscalePanel.svelte | converted | heuristic | 0 | $derived | structurally convertible; requires review |
| src/lib/components/panels/UpscalePanelCacheSection.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/UpscalePanelCurrentInfo.svelte | manual | heuristic | 0 | $effect, $props | complex rune graph: $effect, $props |
| src/lib/components/panels/UpscalePanelGlobalControls.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/panels/UpscalePanelModelSettings.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/panels/UpscalePanelPreview.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/ViewSettingsPanel.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/components/radial/RadialInputLayer.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/radial/RadialMenuOverlay.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state |
| src/lib/components/settings/BackupSettingsPanel.svelte | converted | heuristic | 0 | $derived, $state | structurally convertible; requires review |
| src/lib/components/settings/CardPanelManager.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/settings/PanelItemManager.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/components/SettingsContent.svelte | manual | heuristic | 0 | $derived, $state | store coordination: panelPromises |
| src/lib/components/SettingsOverlay.svelte | converted | heuristic | 0 | $derived, $state | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog-action.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/alert-dialog/alert-dialog-cancel.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/alert-dialog/alert-dialog-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/alert-dialog/alert-dialog-description.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/alert-dialog/alert-dialog-footer.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/alert-dialog/alert-dialog-header.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/alert-dialog/alert-dialog-overlay.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/alert-dialog/alert-dialog-portal.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/alert-dialog/alert-dialog-title.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/alert-dialog/alert-dialog-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/alert-dialog/alert-dialog.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/AreaOverlay.svelte | replaced | config-override | 0 | $bindable, $effect, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/avatar/avatar-fallback.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/avatar/avatar-image.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/avatar/avatar.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/badge/badge.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/BoxReveal.svelte | replaced | config-override | 0 | $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/breadcrumb/breadcrumb-ellipsis.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/breadcrumb/breadcrumb-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/breadcrumb/breadcrumb-link.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/breadcrumb/breadcrumb-list.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/breadcrumb/breadcrumb-page.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/breadcrumb/breadcrumb-separator.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/breadcrumb/breadcrumb.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/button/button.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/card/card-action.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/card/card-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/card/card-description.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/card/card-footer.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/card/card-header.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/card/card-title.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/card/card.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/chart/chart-container.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/chart/chart-style.svelte | replaced | config-override | 0 | $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/chart/chart-tooltip.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/checkbox/checkbox.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/collapsible-card/CollapsibleCard.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/collapsible/collapsible-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/collapsible/collapsible-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/collapsible/collapsible.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/command/command-dialog.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/command/command-empty.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/command/command-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/command/command-input.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/command/command-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/command/command-link-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/command/command-list.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/command/command-separator.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/command/command-shortcut.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/command/command.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/ConfirmDialog.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-checkbox-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-group-heading.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-item-icon.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-item-row.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-label.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-radio-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-radio-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-separator.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-shortcut.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-sub-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-sub-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/context-menu-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/context-menu/FileContextMenu.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/copy-button/copy-button.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/data-table/flex-render.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dialog/dialog-close.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dialog/dialog-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dialog/dialog-description.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dialog/dialog-footer.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dialog/dialog-header.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dialog/dialog-overlay.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dialog/dialog-portal.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dialog/dialog-title.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dialog/dialog-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dialog/dialog.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/Dock.svelte | replaced | config-override | 0 | $derived, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/DockIcon.svelte | replaced | config-override | 0 | $derived, $effect, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/draggable-list/DraggableListManager.svelte | replaced | config-override | 0 | $derived, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-checkbox-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-checkbox-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-group-heading.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-label.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-radio-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-radio-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-separator.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-shortcut.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-sub-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-sub-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/dropdown-menu/dropdown-menu-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/emoji-picker/emoji-picker-footer.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/emoji-picker/emoji-picker-list.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/emoji-picker/emoji-picker-search.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/emoji-picker/emoji-picker-skin-tone-selector.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/emoji-picker/emoji-picker-viewport.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/emoji-picker/emoji-picker.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/empty/empty-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/empty/empty-description.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/empty/empty-header.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/empty/empty-media.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/empty/empty-title.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/empty/empty.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/field/field-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/field/field-description.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/field/field-error.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/field/field-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/field/field-label.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/field/field-legend.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/field/field-separator.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/field/field-set.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/field/field-title.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/field/field.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/FileTypeIcon.svelte | replaced | config-override | 0 | $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/form/form-button.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/form/form-description.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/form/form-element-field.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/form/form-field-errors.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/form/form-field.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/form/form-fieldset.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/form/form-label.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/form/form-legend.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/GlobalConfirmDialog.svelte | replaced | config-override | 0 | - | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/hover-card/hover-card-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/hover-card/hover-card-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/HoverAreasOverlay.svelte | replaced | config-override | 0 | $bindable, $derived, $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/Icon.svelte | replaced | config-override | 0 | $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/input/input.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/item/item-actions.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/item/item-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/item/item-description.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/item/item-footer.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/item/item-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/item/item-header.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/item/item-media.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/item/item-separator.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/item/item-title.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/item/item.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/label/label.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/MagicCard.svelte | replaced | config-override | 0 | $derived, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-checkbox-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-group-heading.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-label.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-radio-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-separator.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-shortcut.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-sub-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-sub-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/menubar/menubar.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/MetadataBadge.svelte | replaced | config-override | 0 | $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/meter/meter.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/native-select/native-select-opt-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/native-select/native-select-option.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/native-select/native-select.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/navigation-menu/navigation-menu-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/navigation-menu/navigation-menu-indicator.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/navigation-menu/navigation-menu-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/navigation-menu/navigation-menu-link.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/navigation-menu/navigation-menu-list.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/navigation-menu/navigation-menu-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/navigation-menu/navigation-menu-viewport.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/navigation-menu/navigation-menu.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/PanelContextMenu.svelte | replaced | config-override | 0 | $derived, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/PathBar.svelte | replaced | config-override | 0 | $bindable, $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/popover/popover-close.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/popover/popover-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/popover/popover-portal.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/popover/popover-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/popover/popover.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/progress/progress.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/ProjectCard.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/rename/rename-cancel.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/rename/rename-edit.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/rename/rename-provider.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/rename/rename-save.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/rename/rename.svelte | replaced | config-override | 0 | $bindable, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/rename/RenameDialog.svelte | replaced | config-override | 0 | $bindable, $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/resizable/resizable-handle.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/resizable/resizable-pane-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/ResizablePanel.svelte | replaced | config-override | 0 | $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/scroll-area/scroll-area-scrollbar.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/scroll-area/scroll-area.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/SearchBar.svelte | replaced | config-override | 0 | $bindable, $derived, $effect, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/select/select-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/select/select-group-heading.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/select/select-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/select/select-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/select/select-label.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/select/select-scroll-down-button.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/select/select-scroll-up-button.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/select/select-separator.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/select/select-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/select/select-value.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/separator/separator.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sheet/sheet-close.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sheet/sheet-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sheet/sheet-description.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sheet/sheet-footer.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sheet/sheet-header.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sheet/sheet-overlay.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sheet/sheet-title.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sheet/sheet-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-footer.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-group-action.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-group-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-group-label.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-group.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-header.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-input.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-inset.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-menu-action.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-menu-badge.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-menu-button.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-menu-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-menu-skeleton.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-menu-sub-button.svelte | replaced | config-override | 0 | $bindable, $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-menu-sub-item.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-menu-sub.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-menu.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-provider.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-rail.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-separator.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sidebar/sidebar.svelte | replaced | config-override | 0 | $bindable, $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/skeleton/skeleton.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/slider/slider.svelte | replaced | config-override | 0 | $bindable, $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/snippet/snippet.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sonner/sonner.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sort/BookmarkSortPanel.svelte | replaced | config-override | 0 | $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/sort/SortPanel.svelte | replaced | config-override | 0 | $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/switch/switch.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/table/table-body.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/table/table-caption.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/table/table-cell.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/table/table-footer.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/table/table-head.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/table/table-header.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/table/table-row.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/table/table.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tabs/tabs-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tabs/tabs-list.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tabs/tabs-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tabs/tabs.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tag/ManualTagEditor.svelte | replaced | config-override | 0 | $bindable, $derived, $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/TagChip.svelte | replaced | config-override | 0 | $derived, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tags-input/tags-input-tag.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tags-input/tags-input.svelte | replaced | config-override | 0 | $bindable, $effect, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/terminal/terminal-animated-span.svelte | replaced | config-override | 0 | $derived, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/terminal/terminal-loading.svelte | replaced | config-override | 0 | $derived, $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/terminal/terminal-loop.svelte | replaced | config-override | 0 | $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/terminal/terminal-typing-animation.svelte | replaced | config-override | 0 | $props, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/terminal/terminal.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/toast.svelte | replaced | config-override | 0 | $derived, $effect, $state | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tooltip/tooltip-content.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tooltip/tooltip-trigger.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tree-view/tree-view-file.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tree-view/tree-view-folder.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/tree-view/tree-view.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/VirtualSearchBar.svelte | replaced | config-override | 0 | $bindable, $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/ui/window/window.svelte | replaced | config-override | 0 | $props | Replace Svelte UI primitives and old shell pieces with the Xiranite React design system. |
| src/lib/components/viewer/AnimatedImagePlayer.svelte | manual | config-override | 0 | $effect, $props, $state | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/BackgroundVideo.svelte | manual | config-override | 0 | $effect, $props, $state | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/Magnifier.svelte | manual | config-override | 0 | $effect, $props, $state | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/SlideshowControl.svelte | manual | config-override | 0 | $derived, $props, $state | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/VideoContainer.svelte | manual | config-override | 16 | $effect, $props, $state | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/VideoPlayer.svelte | manual | config-override | 0 | $derived, $effect, $props, $state | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/VideoPlayer/MoreMenu.svelte | manual | config-override | 0 | $props | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/VideoPlayer/PlaybackRatePanel.svelte | manual | config-override | 0 | $props | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/VideoPlayer/SubtitlePanel.svelte | manual | config-override | 0 | $props | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/VideoPlayer/VideoControls.svelte | manual | config-override | 0 | $props | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/VideoPlayer/VideoProgressBar.svelte | manual | config-override | 0 | $props, $state | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/components/viewer/VideoPlayer/VolumePanel.svelte | manual | config-override | 0 | $props | Media controls, magnifier, slideshow, and animated playback require React capability-specific review. |
| src/lib/Settings.svelte | adapter-needed | heuristic | 1 | - | uses Tauri API and requires a host adapter |
| src/lib/stackview/components/CanvasImage.svelte | replaced | config-override | 0 | $derived, $effect, $props, $state | Normal reading uses DOM img; Canvas remains an optional capability instead of the primary renderer. |
| src/lib/stackview/components/FrameImage.svelte | blocked | config-override | 0 | $derived, $effect, $props, $state | Generate only a typed React shell until the archive provider and loopback asset route are implemented. |
| src/lib/stackview/components/FrameImageWithOverlay.svelte | blocked | config-override | 0 | $derived, $props, $state | Generate only a typed React shell until the archive provider and loopback asset route are implemented. |
| src/lib/stackview/frames/DoubleFrame.svelte | blocked | config-override | 0 | $props | Generate only a typed React shell until the archive provider and loopback asset route are implemented. |
| src/lib/stackview/frames/PanoramaFrame.svelte | blocked | config-override | 0 | $props | Generate only a typed React shell until the archive provider and loopback asset route are implemented. |
| src/lib/stackview/frames/SingleFrame.svelte | blocked | config-override | 0 | $props | Generate only a typed React shell until the archive provider and loopback asset route are implemented. |
| src/lib/stackview/frames/VideoFrame.svelte | blocked | config-override | 0 | $props, $state | Generate only a typed React shell until the archive provider and loopback asset route are implemented. |
| src/lib/stackview/layers/BackgroundLayer.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state |
| src/lib/stackview/layers/CurrentFrameLayer.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state; store coordination: pageTransitionStore |
| src/lib/stackview/layers/GestureLayer.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/stackview/layers/HoverLayer.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/stackview/layers/HoverScrollLayer.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/stackview/layers/ImageInfoLayer.svelte | manual | heuristic | 0 | $derived, $state | store coordination: infoPanelStore |
| src/lib/stackview/layers/InfoLayer.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/stackview/layers/LayerTreeView.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/stackview/layers/NextFrameLayer.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/stackview/layers/PanoramaFrameLayer.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/stackview/layers/PrevFrameLayer.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/stackview/layers/ProgressBarLayer.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state |
| src/lib/stackview/layers/SidebarControlLayer.svelte | manual | heuristic | 0 | $state | store coordination: bottomBarLockState, bottomBarOpen, bottomThumbnailBarPinned, leftSidebarLockState, leftSidebarOpen, leftSidebarPinned, rightSidebarLockState, rightSidebarOpen, rightSidebarPinned, topToolbarLockState, topToolbarOpen, topToolbarPinned, bottomBarLockState, bottomBarOpen, bottomThumbnailBarPinned, leftSidebarLockState, leftSidebarOpen, leftSidebarPinned, rightSidebarLockState, rightSidebarOpen, rightSidebarPinned, topToolbarLockState, topToolbarOpen, topToolbarPinned |
| src/lib/stackview/layers/TranslationOverlay.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/stackview/layers/UpscaleLayer.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/stackview/renderers/ImageRenderer.svelte | blocked | config-override | 0 | $props | Generate only a typed React shell until the archive provider and loopback asset route are implemented. |
| src/lib/stackview/renderers/SplitRenderer.svelte | blocked | config-override | 0 | $derived, $props | Generate only a typed React shell until the archive provider and loopback asset route are implemented. |
| src/lib/stackview/StackView.svelte | blocked | config-override | 3 | $derived, $effect, $props, $state | Generate only a typed React shell until the archive provider and loopback asset route are implemented. |
| src/lib/vendor/liquid-glass/LiquidGlass.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/routes/standalone/[id]/+page.svelte | manual | heuristic | 1 | $effect, $state | uses Tauri API and requires a host adapter; complex rune graph: $effect, $state |

## Parse failures

None.
