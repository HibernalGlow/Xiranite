# Svelte frontend migration report

This report is generated from Svelte compiler and OXC AST evidence. A `converted` disposition means structurally suitable for codemod scaffolding; it is not a claim of behavioral parity.

- Generator: @xiranite/svelte-migrate 0.1.0
- Source commit: a4c4e07401e0e0c3e4d77edba096f6fd5b3e0c45
- Source dirty: no
- Dirty diff hash: -
- Frontend source files: 998
- Svelte components: 551
- Store/rune modules: 142
- Component edges: 766
- Unresolved component imports: 0
- Tauri-using files/calls: 107/389
- Dispositions: converted=392, adapter-needed=22, manual=137, replaced=0, blocked=0

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
| src/lib/cards/settings/ThemeSettingsCard.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
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
| src/lib/components/common/ButtonGroup.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/common/DropdownPanel.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/components/common/PanelBase.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/components/common/ToolbarBase.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state |
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
| src/lib/components/panels/theme/ColorSchemeTab.svelte | manual | heuristic | 0 | $props, $state | complex template behavior: TransitionDirective |
| src/lib/components/panels/theme/FontTab.svelte | manual | heuristic | 0 | $effect, $state | complex rune graph: $effect, $state |
| src/lib/components/panels/theme/ThemeModeTab.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/panels/theme/TransparencyTab.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/panels/ThemePanel.svelte | converted | heuristic | 0 | $state | structurally convertible; requires review |
| src/lib/components/panels/ThemePreview.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
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
| src/lib/components/ui/alert-dialog/alert-dialog-action.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog-cancel.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog-description.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog-footer.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog-header.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog-overlay.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog-portal.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog-title.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/alert-dialog/alert-dialog.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/AreaOverlay.svelte | manual | heuristic | 0 | $bindable, $effect, $props | complex rune graph: $bindable, $effect, $props |
| src/lib/components/ui/avatar/avatar-fallback.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/avatar/avatar-image.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/avatar/avatar.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/badge/badge.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/BoxReveal.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/components/ui/breadcrumb/breadcrumb-ellipsis.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/breadcrumb/breadcrumb-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/breadcrumb/breadcrumb-link.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/breadcrumb/breadcrumb-list.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/breadcrumb/breadcrumb-page.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/breadcrumb/breadcrumb-separator.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/breadcrumb/breadcrumb.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/button/button.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/card/card-action.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/card/card-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/card/card-description.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/card/card-footer.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/card/card-header.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/card/card-title.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/card/card.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/chart/chart-container.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/chart/chart-style.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/chart/chart-tooltip.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/checkbox/checkbox.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/collapsible-card/CollapsibleCard.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/collapsible/collapsible-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/collapsible/collapsible-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/collapsible/collapsible.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/command/command-dialog.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/command/command-empty.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/command/command-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/command/command-input.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/command/command-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/command/command-link-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/command/command-list.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/command/command-separator.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/command/command-shortcut.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/command/command.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/ConfirmDialog.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-checkbox-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-group-heading.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-item-icon.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-item-row.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-label.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-radio-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-radio-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-separator.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-shortcut.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-sub-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-sub-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/context-menu-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/context-menu/FileContextMenu.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/copy-button/copy-button.svelte | manual | heuristic | 0 | $bindable, $derived, $props | complex template behavior: TransitionDirective |
| src/lib/components/ui/data-table/flex-render.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/dialog/dialog-close.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dialog/dialog-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dialog/dialog-description.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dialog/dialog-footer.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dialog/dialog-header.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dialog/dialog-overlay.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dialog/dialog-portal.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/dialog/dialog-title.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dialog/dialog-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dialog/dialog.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/Dock.svelte | manual | heuristic | 0 | $derived, $props, $state | complex template behavior: UseDirective |
| src/lib/components/ui/DockIcon.svelte | manual | heuristic | 0 | $derived, $effect, $props | complex template behavior: UseDirective; complex rune graph: $derived, $effect, $props; store coordination: mint |
| src/lib/components/ui/draggable-list/DraggableListManager.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-checkbox-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-checkbox-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-group-heading.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-label.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-radio-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-radio-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-separator.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-shortcut.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-sub-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-sub-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/dropdown-menu/dropdown-menu-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/emoji-picker/emoji-picker-footer.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/emoji-picker/emoji-picker-list.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/emoji-picker/emoji-picker-search.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/emoji-picker/emoji-picker-skin-tone-selector.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/emoji-picker/emoji-picker-viewport.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/emoji-picker/emoji-picker.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/empty/empty-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/empty/empty-description.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/empty/empty-header.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/empty/empty-media.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/empty/empty-title.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/empty/empty.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/field/field-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/field/field-description.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/field/field-error.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/field/field-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/field/field-label.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/field/field-legend.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/field/field-separator.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/field/field-set.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/field/field-title.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/field/field.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/FileTypeIcon.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/form/form-button.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/form/form-description.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/form/form-element-field.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/form/form-field-errors.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/form/form-field.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/form/form-fieldset.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/form/form-label.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/form/form-legend.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/GlobalConfirmDialog.svelte | converted | heuristic | 0 | - | structurally convertible; requires review |
| src/lib/components/ui/hover-card/hover-card-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/hover-card/hover-card-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/HoverAreasOverlay.svelte | manual | heuristic | 0 | $bindable, $derived, $effect, $props, $state | complex rune graph: $bindable, $derived, $effect, $props, $state |
| src/lib/components/ui/Icon.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/input/input.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/item/item-actions.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/item/item-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/item/item-description.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/item/item-footer.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/item/item-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/item/item-header.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/item/item-media.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/item/item-separator.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/item/item-title.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/item/item.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/label/label.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/MagicCard.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-checkbox-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-group-heading.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-label.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-radio-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-separator.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-shortcut.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-sub-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-sub-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/menubar/menubar.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/MetadataBadge.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/meter/meter.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/native-select/native-select-opt-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/native-select/native-select-option.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/native-select/native-select.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/navigation-menu/navigation-menu-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/navigation-menu/navigation-menu-indicator.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/navigation-menu/navigation-menu-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/navigation-menu/navigation-menu-link.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/navigation-menu/navigation-menu-list.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/navigation-menu/navigation-menu-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/navigation-menu/navigation-menu-viewport.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/navigation-menu/navigation-menu.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/PanelContextMenu.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/components/ui/PathBar.svelte | manual | heuristic | 0 | $bindable, $effect, $props, $state | complex rune graph: $bindable, $effect, $props, $state |
| src/lib/components/ui/popover/popover-close.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/popover/popover-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/popover/popover-portal.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/popover/popover-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/popover/popover.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/progress/progress.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/ProjectCard.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/rename/rename-cancel.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/rename/rename-edit.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/rename/rename-provider.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/rename/rename-save.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/rename/rename.svelte | converted | heuristic | 0 | $bindable, $props, $state | structurally convertible; requires review |
| src/lib/components/ui/rename/RenameDialog.svelte | manual | heuristic | 0 | $bindable, $effect, $props, $state | complex rune graph: $bindable, $effect, $props, $state |
| src/lib/components/ui/resizable/resizable-handle.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/resizable/resizable-pane-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/ResizablePanel.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/components/ui/scroll-area/scroll-area-scrollbar.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/scroll-area/scroll-area.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/SearchBar.svelte | manual | heuristic | 0 | $bindable, $derived, $effect, $props | complex rune graph: $bindable, $derived, $effect, $props |
| src/lib/components/ui/select/select-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/select/select-group-heading.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/select/select-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/select/select-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/select/select-label.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/select/select-scroll-down-button.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/select/select-scroll-up-button.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/select/select-separator.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/select/select-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/select/select-value.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/separator/separator.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sheet/sheet-close.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sheet/sheet-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sheet/sheet-description.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sheet/sheet-footer.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sheet/sheet-header.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sheet/sheet-overlay.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sheet/sheet-title.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sheet/sheet-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-footer.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-group-action.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-group-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-group-label.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-group.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-header.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-input.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-inset.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-menu-action.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-menu-badge.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-menu-button.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-menu-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-menu-skeleton.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-menu-sub-button.svelte | converted | heuristic | 0 | $bindable, $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-menu-sub-item.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-menu-sub.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-menu.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-provider.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-rail.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-separator.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/sidebar/sidebar.svelte | manual | heuristic | 0 | $bindable, $effect, $props, $state | complex rune graph: $bindable, $effect, $props, $state |
| src/lib/components/ui/skeleton/skeleton.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/slider/slider.svelte | manual | heuristic | 0 | $bindable, $effect, $props, $state | complex rune graph: $bindable, $effect, $props, $state |
| src/lib/components/ui/snippet/snippet.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/sonner/sonner.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/sort/BookmarkSortPanel.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/components/ui/sort/SortPanel.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/components/ui/switch/switch.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/table/table-body.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/table/table-caption.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/table/table-cell.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/table/table-footer.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/table/table-head.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/table/table-header.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/table/table-row.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/table/table.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/tabs/tabs-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/tabs/tabs-list.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/tabs/tabs-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/tabs/tabs.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/tag/ManualTagEditor.svelte | manual | heuristic | 0 | $bindable, $derived, $effect, $props, $state | complex rune graph: $bindable, $derived, $effect, $props, $state |
| src/lib/components/ui/TagChip.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/components/ui/tags-input/tags-input-tag.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/tags-input/tags-input.svelte | manual | heuristic | 0 | $bindable, $effect, $props, $state | complex rune graph: $bindable, $effect, $props, $state |
| src/lib/components/ui/terminal/terminal-animated-span.svelte | manual | heuristic | 0 | $derived, $props, $state | complex template behavior: TransitionDirective |
| src/lib/components/ui/terminal/terminal-loading.svelte | manual | heuristic | 0 | $derived, $props, $state | complex template behavior: TransitionDirective |
| src/lib/components/ui/terminal/terminal-loop.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
| src/lib/components/ui/terminal/terminal-typing-animation.svelte | manual | heuristic | 0 | $props, $state | complex template behavior: TransitionDirective |
| src/lib/components/ui/terminal/terminal.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/toast.svelte | manual | heuristic | 0 | $derived, $effect, $state | complex rune graph: $derived, $effect, $state |
| src/lib/components/ui/tooltip/tooltip-content.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/tooltip/tooltip-trigger.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/tree-view/tree-view-file.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/tree-view/tree-view-folder.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/tree-view/tree-view.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/ui/VirtualSearchBar.svelte | converted | heuristic | 0 | $bindable, $props | structurally convertible; requires review |
| src/lib/components/ui/window/window.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/viewer/AnimatedImagePlayer.svelte | manual | heuristic | 0 | $effect, $props, $state | complex template behavior: element:canvas; complex rune graph: $effect, $props, $state |
| src/lib/components/viewer/BackgroundVideo.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state |
| src/lib/components/viewer/Magnifier.svelte | manual | heuristic | 0 | $effect, $props, $state | complex rune graph: $effect, $props, $state; store coordination: pos |
| src/lib/components/viewer/SlideshowControl.svelte | manual | heuristic | 0 | $derived, $props, $state | complex template behavior: TransitionDirective |
| src/lib/components/viewer/VideoContainer.svelte | manual | heuristic | 16 | $effect, $props, $state | uses Tauri API and requires a host adapter; complex rune graph: $effect, $props, $state; store coordination: animatedWebpProbeCache |
| src/lib/components/viewer/VideoPlayer.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state |
| src/lib/components/viewer/VideoPlayer/MoreMenu.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/viewer/VideoPlayer/PlaybackRatePanel.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/viewer/VideoPlayer/SubtitlePanel.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/viewer/VideoPlayer/VideoControls.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/components/viewer/VideoPlayer/VideoProgressBar.svelte | manual | heuristic | 0 | $props, $state | complex template behavior: element:canvas |
| src/lib/components/viewer/VideoPlayer/VolumePanel.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/Settings.svelte | adapter-needed | heuristic | 1 | - | uses Tauri API and requires a host adapter |
| src/lib/stackview/components/CanvasImage.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex template behavior: element:canvas; complex rune graph: $derived, $effect, $props, $state |
| src/lib/stackview/components/FrameImage.svelte | manual | heuristic | 0 | $derived, $effect, $props, $state | complex rune graph: $derived, $effect, $props, $state; store coordination: filterStore, imageTrimStore |
| src/lib/stackview/components/FrameImageWithOverlay.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/lib/stackview/frames/DoubleFrame.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/stackview/frames/PanoramaFrame.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/stackview/frames/SingleFrame.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/stackview/frames/VideoFrame.svelte | converted | heuristic | 0 | $props, $state | structurally convertible; requires review |
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
| src/lib/stackview/renderers/ImageRenderer.svelte | converted | heuristic | 0 | $props | structurally convertible; requires review |
| src/lib/stackview/renderers/SplitRenderer.svelte | converted | heuristic | 0 | $derived, $props | structurally convertible; requires review |
| src/lib/stackview/StackView.svelte | manual | heuristic | 3 | $derived, $effect, $props, $state | uses Tauri API and requires a host adapter; complex rune graph: $derived, $effect, $props, $state; store coordination: appState, animatedWebpProbeCache, currentPageShouldSplit, subPageIndex |
| src/lib/vendor/liquid-glass/LiquidGlass.svelte | converted | heuristic | 0 | $derived, $props, $state | structurally convertible; requires review |
| src/routes/standalone/[id]/+page.svelte | manual | heuristic | 1 | $effect, $state | uses Tauri API and requires a host adapter; complex rune graph: $effect, $state |

## Parse failures

None.
