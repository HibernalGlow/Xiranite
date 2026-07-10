# Xiranite 节点规格说明 — UI 设计参考

> 本文档供 UI 设计参考。每个节点是一个独立的功能模块，有各自的输入参数和输出结构。
> 所有节点共享统一返回格式：`{ success: boolean, message: string, data: T }`
> 所有节点支持 `--json` 输出和 `--dryRun` 预览模式。

---

## 目录

| 分类 | 节点 |
|------|------|
| **文件操作 (file)** | cleanf, dissolvef, encodeb, crashu, migratef, movea, bandia, kavvka, mvz, rawfilter, repacku, seriex, smartzip, snf, synct, timeu, trename, nameu, classf, classq, linku, findz |
| **图片 (image)** | coveru, gifu, lorat, simiu |
| **视频 (video)** | audiov, bitv, enginev, formatv |
| **系统 (system)** | envuconfig, jellypot, owithu, recycleu, scoolp, sleept |
| **文本 (text)** | linedup, marku, transq |
| **开发 (dev)** | lata |

---

## 1. Cleanf — 文件清理

**功能**: 按预设规则预览和删除空文件夹、备份文件、临时文件夹和垃圾文件

**子命令**:
- `preview` — 预览将要清理的内容（不删除）
- `run` — 执行清理

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--paths` | string | 否 | — | 路径列表，分号或换行分隔 |
| `--presets` | string | 否 | 全部预设 | 预设组合，逗号分隔 |
| `--exclude` | string | 否 | — | 排除关键词 |
| `--preview` | boolean | 否 | 子命令决定 | 预览模式 |
| `--json` | boolean | 否 | false | JSON 输出 |

**预设列表**: empty_folders, backup_files, temp_folders, trash_patterns

**输出结构**:
```
{
  totalRemoved: number,
  removedDetails: Record<string, number>,
  previewFiles: string[],
  skipped: number
}
```

**UI 建议**: 预设多选 → 路径输入 → 预览结果列表（带文件类型分类）→ 确认删除

---

## 2. Dissolvef — 文件夹解散

**功能**: 将文件夹内容合并到上级目录，删除空文件夹

**子命令**: `plan`, `dissolve`, `undo`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` | string | 是 | — | 根文件夹路径 |
| `--exclude` | string | 否 | — | 排除关键词 |

**输出结构**:
```
{
  plan: { source: string, target: string, files: string[], conflicts: string[] }[],
  dissolvedCount: number,
  conflictCount: number,
  skippedCount: number
}
```

**UI 建议**: 文件夹树可视化 → 冲突高亮 → 合并预览

---

## 3. Encodeb — 乱码文件名恢复

**功能**: 检测并修复乱码文件名编码（GBK↔UTF-8 等）

**子命令**: `find`, `preview`, `recover`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--paths` | string | 是 | — | 路径列表 |
| `--dryRun` | boolean | 否 | true | 预演模式 |

**输出结构**:
```
{
  items: { path: string, currentName: string, fixedName: string, encoding: string }[],
  scannedCount: number,
  fixedCount: number,
  skippedCount: number
}
```

**UI 建议**: 原文件名 → 修复后文件名 对比表 → 批量勾选修复

---

## 4. Crashu — 相似文件夹匹配移动

**功能**: 检测源目录和目标目录之间的相似文件夹，自动匹配并移动

**子命令**: `scan`, `plan`, `move`, `execute`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--source` | string | 是 | — | 源目录 |
| `--sourcePaths` | string | 否 | — | 多源路径 |
| `--targetPath` | string | 是 | — | 目标目录 |
| `--dryRun` | boolean | 否 | true | 预演模式 |

**输出结构**:
```
{
  matches: { source: string, target: string, similarity: number, action: string }[],
  totalScanned: number,
  matchedCount: number,
  movedCount: number
}
```

**UI 建议**: 双栏对比（源 vs 目标）→ 相似度进度条 → 拖拽确认匹配

---

## 5. Migratef — 文件迁移

**功能**: 在不同位置间批量迁移文件，支持路径映射

**子命令**: `plan`, `migrate`, `execute`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--source` | string | 是 | — | 源路径 |
| `--target` | string | 是 | — | 目标路径 |
| `--path` | string | 否 | — | 单路径 |
| `--dryRun` | boolean | 否 | true | 预演模式 |

**输出结构**:
```
{
  plan: { source: string, target: string, size: number }[],
  totalFiles: number,
  movedCount: number,
  skippedCount: number,
  errorCount: number
}
```

**UI 建议**: 源→目标路径映射表 → 迁移进度条 → 冲突处理选项

---

## 6. Movea — 文件夹编号移动

**功能**: 按编号顺序扫描、匹配和移动文件夹

**子命令**: `scan`, `match`, `move`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` | string | 是 | — | 根路径 |
| `--root` | string | 否 | — | 根目录 |
| `--archive` | string | 否 | — | 归档路径 |

**输出结构**:
```
{
  items: { path: string, number: number, target: string }[],
  scannedCount: number,
  movedCount: number,
  errorCount: number
}
```

**UI 建议**: 编号列表可视化 → 拖拽排序 → 移动预览

---

## 7. Bandia — 文件打包

**功能**: 文件打包/解包/重打包操作

**子命令**: `extract`, `compress`, `repack`, `export-efu`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` | string | 否 | — | 单路径 |
| `--paths` | string | 否 | — | 多路径 |
| `--outputDir` | string | 否 | — | 输出目录 |
| `--dryRun` | boolean | 否 | true | 预演模式 |

**输出结构**:
```
{
  operations: { archive: string, action: string, entries: number, status: string }[],
  processedCount: number,
  successCount: number,
  failedCount: number
}
```

**UI 建议**: 归档列表 → 操作选择（解压/压缩/重打包）→ 进度跟踪

---

## 8. Kavvka — Czkawka 路径准备

**功能**: 为 Czkawka 重复文件检测工具准备路径并处理结果

**子命令**: `prepare`, `scan`, `process`, `plan`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` / `--paths` | string | 是 | — | 路径 |
| `--root` | string | 否 | — | 根目录 |

**输出结构**:
```
{
  duplicates: { group: string[], size: number }[],
  totalScanned: number,
  duplicateCount: number,
  removedCount: number
}
```

**UI 建议**: 重复文件分组卡片 → 每组保留/删除选择 → 空间节省统计

---

## 9. Mvz — 归档内文件操作

**功能**: 通过 7-Zip 操作归档内文件（提取、移动、删除、重命名）

**子命令**: `extract`, `move`, `delete`, `rename`, `guided`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--entry` | string | 否 | — | 单条目 `archive//internalPath` |
| `--entries` | string | 否 | — | 多条目 |
| `--file` | string | 否 | — | 归档文件 |
| `--output` | string | 否 | — | 输出目录 |
| `--pattern` | string | 否 | — | 替换模式 |
| `--replacement` | string | 否 | — | 替换文本 |
| `--dryRun` | boolean | 否 | true | 预演模式 |

**输出结构**:
```
{
  operations: { archive: string, entry: string, action: string, status: string }[],
  archivePath: string,
  totalEntries: number,
  processedCount: number,
  successCount: number,
  failedCount: number
}
```

**UI 建议**: 归档内容树视图 → 操作按钮（提取/移动/删除/重命名）→ 预览变更

---

## 10. Rawfilter — 相似归档过滤

**功能**: 使用模糊匹配分组相似压缩包，保留翻译版，移除重复/原始版

**子命令**: `scan`, `plan`, `execute`, `guided`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` | string | 是 | — | 扫描目录 |
| `--nameOnlyMode` | boolean | 否 | false | 仅按名称匹配 |
| `--createShortcuts` | boolean | 否 | false | 创建快捷方式 |
| `--trashOnly` | boolean | 否 | false | 仅移到回收站 |
| `--minSimilarity` | number | 否 | 0.82 | 最小相似度 |
| `--dryRun` | boolean | 否 | true | 预演模式 |

**输出结构**:
```
{
  archiveCount: number,
  totalGroups: number,
  duplicateGroups: number,
  movedToTrash: number,
  movedToMulti: number,
  createdShortcuts: number,
  keptCount: number,
  plan: { group: string[], action: string, similarity: number }[],
  groups: { archives: string[], variant: string, score: number }[]
}
```

**翻译标记**: chinese, cn, zh, 汉化, 中文, 翻译
**原始标记**: raw, original, japanese, jp, 日文, 原版, 生肉

**UI 建议**: 分组卡片（每组高亮翻译版/原始版）→ 相似度可视化 → 批量处理

---

## 11. Repacku — 文件夹重打包

**功能**: 分析文件夹结构并按类型压缩为 zip 归档

**子命令**: `analyze`, `compress`, `full`, `single-pack`, `gallery-pack`, `guided`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` / `--paths` | string | 是 | — | 路径 |
| `--config` | string | 否 | — | 配置文件 |
| `--types` | string | 否 | 全部类型 | 文件类型 |
| `--output` | string | 否 | — | 输出路径 |
| `--deleteAfter` | boolean | 否 | false | 压缩后删除原文件 |
| `--minCount` | number | 否 | 2 | 最小文件数 |
| `--galleryMarker` | string | 否 | ". 画集" | 画集标记 |
| `--dryRun` | boolean | 否 | true | 预演模式 |

**文件类型**: text, image, video, audio, document, archive, code, font, executable, model

**输出结构**:
```
{
  folderTree: { name: string, children: [], fileCount: number } | null,
  operations: { source: string, target: string, type: string, status: string }[],
  totalFolders: number,
  plannedCount: number,
  compressedCount: number,
  galleryCount: number
}
```

**UI 建议**: 文件夹树视图 → 类型筛选 → 压缩计划表 → 画集/单包模式切换

---

## 12. Seriex — 系列文件夹整理

**功能**: 检测同一系列的归档文件，规划系列文件夹并安全移动

**子命令**: `plan`, `execute`, `guided`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` | string | 是 | — | 目录路径 |
| `--config` | string | 否 | — | 配置文件 |
| `--prefix` | string | 否 | "[#s]" | 系列前缀 |
| `--threshold` | number | 否 | 75 | 匹配阈值 |
| `--ratio` | number | 否 | 75 | 比率阈值 |
| `--partial` | number | 否 | 85 | 部分匹配阈值 |
| `--token` | number | 否 | 80 | Token 阈值 |
| `--dryRun` | boolean | 否 | true | 预演模式 |

**输出结构**:
```
{
  planItems: { series: string, files: string[], confidence: number }[],
  moveItems: { source: string, target: string }[],
  totalSeries: number,
  totalFiles: number,
  movedCount: number
}
```

**UI 建议**: 系列分组卡片 → 置信度进度条 → 文件列表展开 → 移动预览

---

## 13. Smartzip — SmartZip 归档工具

**功能**: 通过 AutoHotkey 脚本驱动 SmartZip 归档工具的打开、解压和压缩

**子命令**: `status`, `extract`, `extract_codepage`, `open`, `archive`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 归档文件路径 |
| `--ini-path` | string | 否 | — | INI 配置路径 |
| `--database-path` | string | 否 | — | 数据库路径 |
| `--smartzip-exe` | string | 否 | — | SmartZip 路径 |
| `--autohotkey-exe` | string | 否 | "AutoHotkey.exe" | AHK 路径 |
| `--record-run` | boolean | 否 | false | 记录运行 |
| `--dry-run` | boolean | 否 | true | 预演模式 |

**支持格式**: zip, 7z, rar, tar, gz, bz2, xz, cbz, cbr, iso

**输出结构**:
```
{
  config: { smartZipExe: string, autohotkeyExe: string, iniPath: string },
  database: { history: [] } | undefined,
  command: { action: string, args: string[], status: string } | undefined,
  selectedPaths: string[],
  archiveCount: number
}
```

**UI 建议**: 归档列表 → 操作选择 → AHK 脚本预览 → 运行日志

---

## 14. Snf — 编号文件夹序列修复

**功能**: 扫描带编号的子文件夹，检测序列缺口，按优先级关键词重新排序并重命名

**子命令**: `scan`, `plan`, `rename`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 路径列表 |
| `--mode` | string | 否 | "library" | 模式: library / artist |
| `--no-keep-time` | boolean | 否 | false | 不保留时间戳 |
| `--dry-run` | boolean | 否 | true | 预演模式 |

**优先级关键词**: 同人志, 商业, 单行, CG, 画集

**输出结构**:
```
{
  items: { path: string, currentNumber: number, newNumber: number, priority: string }[],
  artistCount: number,
  scannedCount: number,
  renamedCount: number,
  conflictCount: number
}
```

**UI 建议**: 编号列表（旧→新对比）→ 缺口高亮 → 优先级标签 → 冲突标记

---

## 15. Synct — 日期归档

**功能**: 从文件名提取时间戳，构建按日期组织的目标路径并移动文件

**子命令**: `scan`, `plan`, `archive`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 路径列表 |
| `--source-mode` | string | 否 | "files" | 模式: files / folders |
| `--format` | string | 否 | "year_month" | 日期格式 |
| `--recursive` | boolean | 否 | false | 递归扫描 |
| `--archive-folder` | boolean | 否 | false | 归档文件夹本身 |
| `--no-fallback` | boolean | 否 | false | 禁用创建时间回退 |
| `--no-sync-file-times` | boolean | 否 | false | 不同步文件时间 |
| `--dry-run` | boolean | 否 | true | 预演模式 |

**日期格式**: year, year_month, year_month_day, month_day, day, nested_y_m, nested_y_m_d, nested_ym_d, nested_y_md

**输出结构**:
```
{
  items: { source: string, target: string, timestamp: string, datePath: string }[],
  scannedCount: number,
  movedCount: number,
  skippedCount: number
}
```

**UI 建议**: 日历视图 → 文件按日期归类 → 目标路径预览 → 移动确认

---

## 16. Timeu — 时间戳备份/恢复

**功能**: 扫描文件时间戳，备份到 JSON，支持从 JSON 恢复 atime/mtime

**子命令**: `scan`, `backup`, `restore`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 路径列表 |
| `--record` | string | 否 | "timeu-timestamps.json" | 记录文件 |
| `--no-recursive` | boolean | 否 | false | 不递归 |
| `--include-directories` | boolean | 否 | false | 包含目录 |
| `--dry-run` | boolean | 否 | true | 预演模式 |

**输出结构**:
```
{
  plan: { path: string, atimeMs: number, mtimeMs: number }[],
  records: { path: string, atimeMs: number, mtimeMs: number, backedUpAt: string }[],
  scannedCount: number,
  backupCount: number,
  restoredCount: number
}
```

**UI 建议**: 时间戳对比表（当前 vs 备份）→ 备份/恢复切换 → 文件列表

---

## 17. Trename — 批量重命名

**功能**: 扫描文件夹生成重命名 JSON，校验翻译目标，执行批量重命名并支持撤销

**子命令**: `scan`, `import`, `validate`, `rename`, `undo`, `history`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` | string | 是 | — | 路径 |
| `--input` / `--inputFile` | string | 否 | — | 重命名 JSON 文件 |
| `--output` | string | 否 | — | 输出路径 |
| `--includeHidden` | boolean | 否 | false | 包含隐藏文件 |
| `--includeRoot` | boolean | 否 | true | 包含根目录 |
| `--excludeExts` | string | 否 | — | 排除扩展名 |
| `--maxLines` | number | 否 | 1000 | 最大行数 |
| `--compact` | boolean | 否 | true | 紧凑模式 |
| `--mode` | string | 否 | "normal" | 模式: normal / leak |
| `--dryRun` | boolean | 否 | true | 预演模式 |
| `--batchId` | string | 否 | — | 批次 ID |

**输出结构**:
```
{
  jsonContent: string,
  segments: string[],
  totalItems: number,
  pendingCount: number,
  readyCount: number,
  successCount: number,
  conflicts: { path: string, reason: string }[],
  operations: { old: string, new: string, status: string }[],
  history: { batchId: string, timestamp: string, count: number }[]
}
```

**UI 建议**: 三步向导（扫描→编辑JSON→执行）→ 旧名/新名对比表 → 冲突高亮 → 撤销历史

---

## 18. Nameu — 归档文件名清理

**功能**: 清理画师文件夹内的归档文件名（统一括号、移除冗余标记、追加画师名）

**子命令**: `scan`, `plan`, `rename`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 路径列表 |
| `--mode` | string | 否 | "multi" | 模式: multi / single |
| `--no-recursive` | boolean | 否 | false | 不递归 |
| `--no-artist` | boolean | 否 | false | 不追加画师名 |
| `--no-folder-normalize` | boolean | 否 | false | 不规范化文件夹 |
| `--no-keep-time` | boolean | 否 | false | 不保留时间戳 |
| `--dry-run` | boolean | 否 | true | 预演模式 |

**输出结构**:
```
{
  items: { path: string, currentName: string, newName: string, artist: string }[],
  scannedCount: number,
  renamedCount: number,
  unchangedCount: number,
  conflictCount: number
}
```

**UI 建议**: 文件名对比表（原→新）→ 画师名标注 → 冲突处理

---

## 19. Classf — 文件状态分类

**功能**: 根据已有状态和等待状态进行文件分类

**子命令**: `scan`, `plan`, `execute`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 路径列表 |
| `--target` | string | 否 | — | 目标目录 |

**输出结构**:
```
{
  items: { path: string, status: string, target: string }[],
  scannedCount: number,
  movedCount: number
}
```

---

## 20. Classq — 关键词文件夹分类

**功能**: 基于关键词将文件分类到不同文件夹

**子命令**: `scan`, `plan`, `execute`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 路径列表 |
| `--keyword` | string | 否 | — | 分类关键词 |
| `--wait` | boolean | 否 | false | 等待模式 |

**输出结构**:
```
{
  items: { path: string, keyword: string, target: string }[],
  scannedCount: number,
  classifiedCount: number
}
```

---

## 21. Linku — 符号链接管理

**功能**: 创建、删除、检查符号链接

**子命令**: `scan`, `create`, `remove`, `verify`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` | string | 是 | — | 源路径 |
| `--target` | string | 否 | — | 目标路径 |

**输出结构**:
```
{
  links: { source: string, target: string, status: string }[],
  createdCount: number,
  removedCount: number,
  brokenCount: number
}
```

---

## 22. Findz — SQL-like 文件搜索

**功能**: 使用类 SQL 语法搜索文件和归档内文件

**子命令**: `search`, `count`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--where` | string | 是 | — | SQL 条件，如 `ext = "jpg" and size < 10M` |
| `--path` | string | 否 | — | 单搜索路径 |
| `--paths` | string | 否 | — | 多搜索路径 |

**输出结构**:
```
{
  results: { path: string, name: string, size: number, ext: string }[],
  totalCount: number,
  query: string
}
```

**UI 建议**: 查询输入框 → 结果表格 → 排序/过滤

---

## 23. Coveru — 归档封面提取

**功能**: 从归档文件（zip/rar/cbr 等）中提取封面图片

**子命令**: `scan`, `plan`, `extract`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 归档文件路径 |
| `--output-dir` | string | 否 | — | 输出目录 |
| `--output-mode` | string | 否 | — | 输出模式 |
| `--overwrite` | boolean | 否 | false | 覆盖已存在 |
| `--no-recursive` | boolean | 否 | false | 不递归 |
| `--dry-run` | boolean | 否 | false | 预演模式 |
| `--preferred` | string | 否 | — | 首选封面名 |

**输出结构**:
```
{
  candidates: { sourcePath: string, outputPath: string, score: number, status: string }[],
  archiveCount: number,
  readyCount: number,
  extractedCount: number,
  skippedCount: number,
  errorCount: number
}
```

**UI 建议**: 归档列表 → 封面缩略图预览 → 批量提取进度

---

## 24. Gifu — GIF 动画转换

**功能**: 将图片序列转换为 GIF 动画

**子命令**: `scan`, `plan`, `convert`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 图片路径 |
| `--config-path` | string | 否 | — | 配置文件 |

**输出结构**:
```
{
  items: { source: string, output: string, frameCount: number }[],
  scannedCount: number,
  convertedCount: number,
  failedCount: number
}
```

---

## 25. Lorat — LoRA Trigger 推断

**功能**: 从 LoRA 模型文件推断 trigger 词

**子命令**: `scan`, `infer`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--folder` | string | 是 | — | LoRA 文件夹 |

**输出结构**:
```
{
  items: { file: string, triggers: string[], confidence: number }[],
  scannedCount: number,
  inferredCount: number
}
```

---

## 26. Simiu — 相似图片检测

**功能**: 按文件大小和签名聚类相似图片并分组

**子命令**: `scan`, `plan`, `apply`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `roots` | string[] | 是 | — | 扫描根路径 |
| `--config-path` | string | 否 | — | 配置文件 |
| `--database-path` | string | 否 | — | 数据库路径 |
| `--scan-order` | string | 否 | "path" | 扫描顺序 |
| `--min-group-size` | number | 否 | 2 | 最小分组大小 |
| `--mode` | string | 否 | "move" | 模式: move / copy / link |
| `--dry-run` | boolean | 否 | true | 预演模式 |

**支持格式**: jpg, jpeg, png, webp, bmp, gif, tif, tiff, avif, jxl

**输出结构**:
```
{
  groups: { signature: string, files: string[], size: number }[],
  operations: { source: string, target: string, action: string }[],
  imageCount: number,
  groupCount: number,
  movedCount: number
}
```

**UI 建议**: 相似图片分组网格 → 缩略图对比 → 保留/删除选择

---

## 27. Audiov — 视频音轨提取

**功能**: 从视频文件中提取音轨

**子命令**: `extract`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 视频文件路径 |
| `--output` | string | 否 | — | 输出目录 |
| `--format` | string | 否 | "aac" | 音频格式 |
| `--bitrate` | string | 否 | — | 比特率 |
| `--dryRun` | boolean | 否 | false | 预演模式 |

**输出结构**:
```
{
  items: { path: string, output: string, status: string }[],
  scannedCount: number,
  extractedCount: number,
  failedCount: number
}
```

---

## 28. Bitv — 视频码率分析

**功能**: 调用外部工具分析视频码率

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 视频文件路径 |
| `--source-root` | string | 否 | — | 源根目录 |

**输出结构**:
```
{
  items: { path: string, bitrate: number, duration: number }[],
  scannedCount: number,
  analyzedCount: number
}
```

---

## 29. Enginev — Wallpaper Engine 工坊管理

**功能**: 管理 Wallpaper Engine 工坊项目（扫描、过滤、重命名、删除、导出）

**子命令**: `scan`, `filter`, `rename`, `delete`, `export`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` | string | 是 | — | 工坊文件夹 |
| `--wallpapersFile` | string | 否 | — | 壁纸列表文件 |
| `--targetPath` | string | 否 | — | 目标路径 |

**输出结构**:
```
{
  items: { id: string, title: string, path: string, type: string }[],
  scannedCount: number,
  processedCount: number,
  deletedCount: number,
  exportedCount: number
}
```

---

## 30. Formatv — .nov 后缀管理

**功能**: 管理视频文件的 .nov 后缀（标记不需要的视频）

**子命令**: `scan`, `add-nov`, `remove-nov`, `duplicates`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` / `--paths` | string | 是 | — | 路径 |

**输出结构**:
```
{
  items: { path: string, hasNov: boolean, duplicate: boolean }[],
  scannedCount: number,
  novCount: number,
  duplicateCount: number
}
```

---

## 31. Envuconfig — EnvU 配置备份

**功能**: 备份和恢复 EnvU 环境配置

**子命令**: `backup`, `restore`, `status`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `root` | string | 是 | — | 根路径 |
| `--backup-dir` | string | 否 | — | 备份目录 |

**输出结构**:
```
{
  configFiles: { path: string, status: string }[],
  backupCount: number,
  restoredCount: number
}
```

---

## 32. Jellypot — Jellyfin/PotPlayer 启动

**功能**: 启动 Jellyfin 或 PotPlayer 媒体应用

**子命令**: `status`, `launch_media`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `mediaPath` | string | 否 | — | 媒体路径 |
| `--config-path` | string | 否 | — | 配置文件 |

**输出结构**:
```
{
  appStatus: string,
  mediaPath: string | null,
  launched: boolean
}
```

---

## 33. Owithu — Windows 右键菜单管理

**功能**: 从 TOML 配置预览、注册和注销 Windows Open-with 右键菜单项

**子命令**: `preview`, `register`, `unregister`, `guided`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--config` / `-c` | string | 否 | — | TOML 配置文件 |
| `--hive` | string | 否 | "HKCU" | 注册表根: HKCU / HKCR / HKLM |
| `--key` | string | 否 | — | 仅操作指定 key |

**TOML 配置结构**:
```toml
[vars]
app_dir = "D:/Apps"

[defaults]
hive = "HKCU"

[[entries]]
key = "MyApp"
command = "{{app_dir}}/myapp.exe"
title = "Open with MyApp"
icon = "{{app_dir}}/myapp.ico"
```

**输出结构**:
```
{
  vars: Record<string, string>,
  entries: { key: string, command: string, title: string }[],
  plan: { hive: string, path: string, action: string }[],
  registeredCount: number,
  unregisteredCount: number,
  failedCount: number
}
```

**UI 建议**: TOML 编辑器 → 注册表变更预览 → 注册/注销切换

---

## 34. Recycleu — 回收站清理

**功能**: 立即或定时清空 Windows 回收站

**子命令**: `status`, `clean`, `start`, `guided`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--drive` | string | 否 | — | 盘符 |
| `--interval` | number | 否 | 10 | 清理间隔（秒） |
| `--cycles` | number | 否 | 360 | 最大循环次数 |

**输出结构**:
```
{
  timerStatus: "idle" | "running" | "completed" | "error",
  cleanCount: number,
  lastCleanTime: string | null,
  remainingSeconds: number
}
```

**UI 建议**: 状态卡片 → 定时器倒计时 → 立即清理按钮

---

## 35. Scoolp — Scoop 包管理

**功能**: 管理 Scoop 包管理器的状态、包列表、bucket 同步和缓存清理

**子命令**: `status`, `init`, `list`, `info`, `install`, `show-config`, `sync`, `cache-list`, `cache-backup`, `cache-delete`, `guided`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` | string | 否 | — | 路径 |
| `--config` / `-c` | string | 否 | — | 配置文件 |
| `--bucketPath` | string | 否 | — | Bucket 路径 |
| `--package` / `--packages` | string | 否 | — | 包名 |
| `--dir` | string | 否 | — | Scoop 目录 |
| `--root` | string | 否 | "D:/scoop" | Scoop 根目录 |
| `--dryRun` | boolean | 否 | false | 预演模式 |

**输出结构**:
```
{
  scoopInstalled: boolean,
  installedPackages: string[],
  buckets: string[],
  availablePackages: { name: string, version: string }[],
  syncPlan: { command: string, args: string[] }[],
  cache: { files: { name: string, size: number }[], totalSize: number } | undefined,
  installedCount: number,
  cleanedCount: number,
  cleanedSizeBytes: number
}
```

**UI 建议**: 仪表盘式布局 → 包列表表格 → 缓存空间可视化 → 同步计划

---

## 36. Sleept — 系统定时器

**功能**: 支持倒计时、定时、网速和 CPU 触发的系统定时器（关机/休眠/重启）

**子命令**: `status`, `countdown`, `at`, `netspeed`, `cpu`, `guided`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--target` | string | `at` 命令必填 | — | 目标时间 |
| `--hours` | number | 否 | 0 | 小时 |
| `--minutes` | number | 否 | 0 | 分钟 |
| `--seconds` | number | 否 | 5 | 秒 |
| `--power` | string | 否 | "sleep" | 操作: sleep / shutdown / restart |
| `--upload` | number | 否 | 242 | 上传阈值 |
| `--download` | number | 否 | 242 | 下载阈值 |
| `--duration` | number | 否 | 2 | 持续时间 |
| `--threshold` | number | 否 | 10 | CPU 阈值 |
| `--dryrun` | boolean | 否 | true | 预演模式 |

**输出结构**:
```
{
  timerStatus: "idle" | "running" | "completed" | "cancelled",
  remainingSeconds: number,
  currentUpload: number,
  currentDownload: number,
  currentCpu: number,
  targetTime: string | undefined
}
```

**UI 建议**: 模式切换标签页（倒计时/定时/网速/CPU）→ 实时仪表 → 电源操作选择

---

## 37. Linedup — 行过滤

**功能**: 按行内容过滤文本（保留/排除/去重）

**子命令**: `filter`, `unique`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--source` / `--sourceFile` | string | 是 | — | 源文本 |
| `--filter` / `--filterFile` | string | 否 | — | 过滤文本 |

**输出结构**:
```
{
  lines: string[],
  totalCount: number,
  filteredCount: number,
  remainingCount: number
}
```

---

## 38. Marku — Markdown 模块系统

**功能**: 解析和处理 Markdown 模块

**子命令**: `parse`, `build`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--input` / `--inputFile` | string | 是 | — | Markdown 文本 |
| `--config` | string | 否 | — | 模块配置 JSON |

**输出结构**:
```
{
  modules: { id: string, content: string, type: string }[],
  totalModules: number,
  builtCount: number
}
```

---

## 39. Transq — 翻译队列整理

**功能**: 查找已完成的 manga-translator 工作区，补齐缺失映射原图，移动结果到最终位置

**子命令**: `status`, `plan`, `run`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 位置参数 `paths` | string[] | 是 | — | 工作区路径 |
| `--live` | boolean | 否 | false | 执行真实操作（否则预览） |
| `--preview` | boolean | 否 | false | 预览模式 |

**输出结构**:
```
{
  items: {
    id: string,
    originalImagesPath: string,
    resultPath: string,
    outputPath: string,
    status: "pending" | "ready" | "output" | "conflict" | "missing",
    originalCount: number,
    resultCount: number,
    missingFiles: string[],
    copies: { source: string, target: string }[]
  }[],
  pendingCount: number,
  readyCount: number,
  outputCount: number,
  copiedFiles: number,
  deletedOriginals: number
}
```

**UI 建议**: 队列列表 → 状态标签（pending/ready/output/conflict/missing）→ 进度跟踪

---

## 40. Lata — Taskfile 任务执行

**功能**: 执行 Taskfile 中定义的任务

**子命令**: `list`, `run`

**输入参数**:
| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `--path` | string | 是 | "Taskfile.yml" | Taskfile 路径 |
| `--taskfile` | string | 否 | — | Taskfile 别名 |

**输出结构**:
```
{
  tasks: { name: string, description: string, deps: string[] }[],
  totalTasks: number,
  executedTask: string | null
}
```

---

## 通用设计约束

### 所有节点共享的特性
1. **统一返回格式**: `{ success: boolean, message: string, data: T }`
2. **JSON 输出**: 所有节点支持 `--json` 参数输出 JSON
3. **预览优先**: 所有危险操作默认 `--dryRun`，需显式参数才执行
4. **管道输入**: 路径型节点支持 `cat paths.txt | xnode scan --json`
5. **配置加载**: 从 `xiranite.config.toml` 的 `[nodes.<id>]` 段读取默认值
6. **i18n**: 所有节点 help 支持 `zh-CN` 翻译
7. **事件流**: 长任务通过 `{ type: "progress", progress: number, message: string }` 报告进度

### UI 通用模式建议
- **scan → plan → execute** 三步流程（多数文件操作节点）
- **预览/确认** 模式（所有危险操作）
- **进度条** + 实时日志（长时间运行任务）
- **表格/列表** 展示扫描结果
- **对比视图** 展示变更前后
- **冲突高亮** 标记无法处理的项
