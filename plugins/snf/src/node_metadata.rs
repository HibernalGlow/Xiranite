//! The static registry documents the node contributes: `def` and `help`.
//!
//! `packages/nodes/snf/src/index.ts:4-12` and `packages/nodes/snf/src/help.ts` are
//! plain data, and ADR-0063 principle 2 keeps the HTTP surface the Rust side
//! answers, so the plugin serves both documents byte-for-byte instead of leaving
//! the host to re-transcribe them. `cli.ts`, `help` rendering, `interaction.ts` and
//! `Tui.tsx` are *not* here: those are the Bun CLI/TUI adapters that ADR-0063
//! deletes together with the `@xiranite/cli-runtime` they are built on, and the
//! React card keeps its own copy of the labels it renders.

use serde_json::{json, Value};

/// `def` at `index.ts:4-12`.
#[must_use]
pub fn node_definition() -> Value {
    json!({
        "id": "snf",
        "name": "SNF",
        "version": "0.1.0",
        "category": "file",
        "description": "Repair numbered folder sequence order with native renames.",
        "icon": "ListOrdered",
        "keywords": ["sequence", "folder", "rename", "numbered"],
    })
}

/// `help` at `help.ts:3-74`, including the `zh-CN` translation block.
#[must_use]
pub fn node_help() -> Value {
    json!({
        "title": "SNF",
        "short": "Repair numbered folder sequences inside artist folders.",
        "description": "Scan numbered subfolders, detect sequence gaps, reorder by priority keywords, and apply safe native renames.",
        "whenToUse": [
            "Use SNF when artist folders contain numbered categories such as 1. CG, 3. Commercial and the sequence needs to be continuous."
        ],
        "workflows": [
            {
                "title": "Preview sequence repair",
                "summary": "Build a renumbering plan without changing folders.",
                "ui": [
                    "Paste a library root or artist folder.",
                    "Choose whether paths are library roots or direct artist folders.",
                    "Review conflicts before running live rename."
                ]
            }
        ],
        "commands": [
            {
                "title": "Preview library",
                "command": "xiranite snf plan D:/archives --mode library",
                "description": "Preview sequence repairs for every artist folder under a library root.",
                "examples": [
                    {
                        "label": "Single artist",
                        "command": "xiranite snf plan D:/archives/Artist --mode artist",
                        "description": "Preview one artist folder."
                    },
                    {
                        "label": "Apply rename",
                        "command": "xiranite snf rename D:/archives --mode library",
                        "description": "Apply live sequence repairs."
                    }
                ]
            }
        ],
        "safety": {
            "defaultMode": "dry-run",
            "destructive": ["rename"],
            "notes": [
                "Conflicting target folder names are reported and skipped.",
                "Live rename keeps folder timestamps by default."
            ]
        },
        "translations": {
            "zh-CN": {
                "title": "SNF",
                "short": "修复画师文件夹内的编号文件夹序列。",
                "description": "扫描带编号的子文件夹，检测序列缺口，按优先级关键词重新排序，并应用安全的原生重命名。",
                "whenToUse": [
                    "当画师文件夹包含如 1. CG、3. Commercial 这类带编号分类，且需要让序列连续时使用 SNF。"
                ],
                "workflows": [
                    {
                        "title": "预览序列修复",
                        "summary": "生成重新编号计划而不改动文件夹。",
                        "ui": [
                            "粘贴库根目录或画师文件夹。",
                            "选择路径是库根目录还是直接的画师文件夹。",
                            "在执行真实重命名前检查冲突。"
                        ]
                    }
                ],
                "commands": [
                    {
                        "title": "预览库",
                        "command": "xiranite snf plan D:/archives --mode library",
                        "description": "预览库根目录下每个画师文件夹的序列修复。",
                        "examples": [
                            {
                                "label": "单个画师",
                                "command": "xiranite snf plan D:/archives/Artist --mode artist",
                                "description": "预览单个画师文件夹。"
                            },
                            {
                                "label": "执行重命名",
                                "command": "xiranite snf rename D:/archives --mode library",
                                "description": "执行真实的序列修复。"
                            }
                        ]
                    }
                ],
                "safety": {
                    "defaultMode": "dry-run",
                    "destructive": ["rename"],
                    "notes": [
                        "冲突的目标文件夹名会被报告并跳过。",
                        "真实重命名默认保留文件夹时间戳。"
                    ]
                }
            }
        }
    })
}

/// The plugin's own identity document, so the host can verify the isolate it loaded.
#[must_use]
pub fn plugin_descriptor() -> Value {
    json!({
        "id": "snf",
        "pluginName": env!("CARGO_PKG_NAME"),
        "pluginVersion": env!("CARGO_PKG_VERSION"),
        "memoryMaxPages": crate::manifest_limits::MEMORY_MAX_PAGES,
        "portedFrom": "@xiranite/node-snf",
        "entryPoints": crate::host_surface::PLUGIN_ENTRY_POINTS,
        "hostFunctions": crate::host_surface::PLUGIN_HOST_FUNCTIONS,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn definition_keeps_the_node_registry_fields() {
        let definition = node_definition();
        assert_eq!(definition["id"], "snf");
        assert_eq!(definition["icon"], "ListOrdered");
        assert_eq!(definition["category"], "file");
        assert_eq!(definition["keywords"][0], "sequence");
    }

    #[test]
    fn help_keeps_both_locales_and_the_safety_block() {
        let help = node_help();
        assert_eq!(help["safety"]["defaultMode"], "dry-run");
        assert_eq!(help["safety"]["destructive"][0], "rename");
        assert_eq!(help["translations"]["zh-CN"]["short"], "修复画师文件夹内的编号文件夹序列。");
        assert_eq!(help["commands"][0]["examples"].as_array().map(Vec::len), Some(2));
    }
}
