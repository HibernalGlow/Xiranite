//! The node's self-authored documents: the registry `def` (`index.ts:4-8`) and the help prose
//! (`help.ts:3-11`), quoted rather than rewritten.
//!
//! AGENTS.md treats `packages/nodes/<id>/src/help.ts` as a node-owned dictionary that feeds both the
//! terminal `--help` and the in-app help card, and it must not drift. So these strings are copied
//! verbatim, and `tests/definition_contract.rs` proves they still equal the `help` block the node
//! publishes in `definition.json`. Nothing in this module is derived or summarised.

use serde_json::{Value, json};

use crate::contract::{
    SAMEA_NODE_DESCRIPTION, SAMEA_NODE_ICON, SAMEA_NODE_ID, SAMEA_NODE_KEYWORDS, SAMEA_NODE_NAME,
    SAMEA_NODE_VERSION,
};

/// `help.ts:5` `short` — the one-liner `cli.ts:18` hands to the CLI parser.
pub const HELP_SHORT: &str =
    "Extract artist metadata from archive names and organize matching archives.";

/// `help.ts:6` `description`.
pub const HELP_DESCRIPTION: &str = "Scans archive roots for bracketed artist metadata, groups recurring artists, and safely moves matched archives into artist folders.";

/// `help.ts:7` `whenToUse[0]`.
pub const HELP_WHEN_TO_USE: [&str; 1] = [
    "Use SameA before CrashU when archive names contain artist or circle metadata that should become target folders.",
];

/// `help.ts:8`'s workflow, kept as the three surfaces it has.
pub const HELP_WORKFLOW_TITLE: &str = "Extract and organize";
/// `help.ts:8` `workflows[0].summary`.
pub const HELP_WORKFLOW_SUMMARY: &str =
    "Preview detected artists, then classify matching archives.";
/// `help.ts:8` `workflows[0].ui`.
pub const HELP_WORKFLOW_UI_STEPS: [&str; 3] = [
    "Paste archive roots.",
    "Set the occurrence threshold and centralization mode.",
    "Review the plan before turning off dry run.",
];

/// `help.ts:9` `commands[0]`.
pub const HELP_COMMAND_TITLE: &str = "Preview";
/// `help.ts:9` `commands[0].command`, the node's own example spelling.
pub const HELP_COMMAND_LINE: &str = "xiranite samea plan D:/archives/unsorted";
/// `help.ts:9` `commands[0].description`.
pub const HELP_COMMAND_DESCRIPTION: &str = "Preview artist archive organization.";

/// `help.ts:10` `safety.defaultMode`.
pub const HELP_SAFETY_DEFAULT_MODE: &str = "dry-run";
/// `help.ts:10` `safety.destructive`.
pub const HELP_SAFETY_DESTRUCTIVE: [&str; 1] = ["classify"];
/// `help.ts:10` `safety.notes`.
pub const HELP_SAFETY_NOTES: [&str; 1] = [
    "Live classification moves archives and reports existing targets as conflicts.",
];

/// The `NodeDef` document `index.ts:4-8` declares, in the same field order.
#[must_use]
pub fn samea_node_description() -> Value {
    json!({
        "id": SAMEA_NODE_ID,
        "name": SAMEA_NODE_NAME,
        "version": SAMEA_NODE_VERSION,
        "category": "file",
        "description": SAMEA_NODE_DESCRIPTION,
        "icon": SAMEA_NODE_ICON,
        "keywords": SAMEA_NODE_KEYWORDS.to_vec(),
    })
}

/// The `NodeHelp` document `help.ts:3-11` declares.
#[must_use]
pub fn samea_node_help() -> Value {
    json!({
        "title": "SameA",
        "short": HELP_SHORT,
        "description": HELP_DESCRIPTION,
        "whenToUse": HELP_WHEN_TO_USE.to_vec(),
        "workflows": [{
            "title": HELP_WORKFLOW_TITLE,
            "summary": HELP_WORKFLOW_SUMMARY,
            "ui": HELP_WORKFLOW_UI_STEPS.to_vec(),
        }],
        "commands": [{
            "title": HELP_COMMAND_TITLE,
            "command": HELP_COMMAND_LINE,
            "description": HELP_COMMAND_DESCRIPTION,
            "examples": [],
        }],
        "safety": {
            "defaultMode": HELP_SAFETY_DEFAULT_MODE,
            "destructive": HELP_SAFETY_DESTRUCTIVE.to_vec(),
            "notes": HELP_SAFETY_NOTES.to_vec(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_def_document_names_the_node_and_its_icon() {
        let described = samea_node_description();
        assert_eq!(described["id"], json!("samea"));
        assert_eq!(described["name"], json!("SameA"));
        assert_eq!(described["version"], json!("0.1.0"));
        assert_eq!(described["icon"], json!("ScanSearch"));
        assert_eq!(described["category"], json!("file"));
        // Negative control: the version here is the node's own release, not the Plugin API version.
        assert_ne!(described["version"], json!("1.0"));
    }

    #[test]
    fn the_help_document_keeps_the_safety_block_verbatim() {
        let help = samea_node_help();
        assert_eq!(help["safety"]["defaultMode"], json!("dry-run"));
        assert_eq!(help["safety"]["destructive"], json!(["classify"]));
        assert_eq!(help["commands"][0]["command"], json!(HELP_COMMAND_LINE));
        assert_eq!(help["whenToUse"].as_array().expect("array").len(), 1);
    }
}
