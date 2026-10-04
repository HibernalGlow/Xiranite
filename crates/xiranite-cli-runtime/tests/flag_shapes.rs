//! Every flag the legacy TypeScript CLI accepted is still typable, or this file says in one line why not.
//!
//! ADR-0069 lets a ported node *rename* what a user types but not silently shrink it. Nobody compared the two
//! halves: `audit:node-cli-surface` froze the legacy surface into `docs/node-cli-surface-baseline.json`,
//! `audit:node-definitions` proved a definition is well-formed, and `audit:node-interaction-parity` proved a
//! definition says the same thing as the node's guided schema. A definition authored from that schema can still
//! drop a flag that only ever existed on the command line — and until now that loss became visible only after
//! `cli.ts` was gone.
//!
//! So this test takes the flag names out of the baseline and the long flags out of `term::command_for`, and every
//! difference between the two has to be a row in `ACCEPTED` below, matched by name. A row is not a waiver: the
//! `Drift::Dropped` and `Drift::FaceLevelSwitch` rows *are* the open debt list, and the gate is that nothing joins
//! the list without a human writing a line here first. Anything unnamed — a new node, a renamed flag, a flag the
//! definition forgot — fails with its name, never with a count.
//!
//! Nodes whose legacy CLI declared no flags of its own (`interaction-driven`, `none`) are disclosed, not compared:
//! there is no command-line spelling there to lose, and their fields are already proven against `interaction.ts`
//! by the parity gate. The moment such a node grows a citty `args` block it is pulled into the comparison by the
//! code below, with no list to update.
//!
//! Without the `tty` feature there is no `command_for` to compare against, so only the baseline-shape and
//! table-consistency tests remain; they still read the real files. `Cargo.toml` belongs to another lane, so this
//! target has no `[[test]] required-features` entry of its own and is compiled by auto-discovery in both builds.

#![cfg_attr(not(feature = "tty"), allow(dead_code))]

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde_json::Value;
use xiranite_cli_runtime::parse_definition;
use xiranite_plugin_api::node_definition::NodeDefinition;

/// The flags do not depend on the session language, but the command is built the way the face builds it.
const LANGUAGE: &str = "en";

/// The generated inventory; never hand-edited, so the numbers in this file come from reading it.
const BASELINE_RELPATH: &str = "docs/node-cli-surface-baseline.json";

/// Floors measured on the current baseline (23 nodes with flags, 274 legacy flag names, 237 flags built by
/// `command_for` for those nodes). They exist so a scan that silently finds nothing cannot read as a pass, the
/// mistake `scripts/audit-node-cli-surface.ts` refuses to make either.
const MIN_COMPARED_NODES: usize = 20;
const MIN_LEGACY_FLAGS: usize = 240;
const MIN_BUILT_FLAGS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    /// A name the legacy CLI accepted that `command_for` no longer builds.
    LegacyFlagGone,
    /// A name `command_for` builds that the legacy CLI never offered.
    DefinitionFlagNew,
}

/// Why a difference is accepted. The sentences are the rule; each row still carries its own note and evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Drift {
    /// Legacy accepted two spellings of one input; the definition declares one of them.
    Alias,
    /// The same input under a new spelling — ADR-0069 makes the old spelling free to move.
    Renamed,
    /// The same switch with reversed polarity, with the default now carried by the definition.
    Inverted,
    /// A legacy variant switch the definition expresses as one value of its `action` field.
    ActionVariant,
    /// One legacy flag split across several per-action fields.
    Split,
    /// A flag the terminal face owns rather than the node; open debt when no Rust face honours it yet.
    FaceLevelSwitch,
    /// A definition field that comes from the node's guided schema and never had a CLI spelling.
    GuidedField,
    /// The definition's `action` field, which is what the legacy subcommand tree became.
    SubcommandSelector,
    /// No field and no face-level equivalent: the user cannot type this any more. Open debt.
    Dropped,
}

impl Drift {
    const fn sentence(self) -> &'static str {
        match self {
            Self::Alias => "legacy accepted two spellings of the same input, the definition keeps one",
            Self::Renamed => "the same input under a new spelling",
            Self::Inverted => "the same switch with reversed polarity, default recorded in the definition",
            Self::ActionVariant => "a legacy variant switch the definition expresses as an action value",
            Self::Split => "one legacy flag split across per-action fields",
            Self::FaceLevelSwitch => "a flag the terminal face owns, not a node field",
            Self::GuidedField => "a guided-schema field that never had a legacy CLI spelling",
            Self::SubcommandSelector => "the action field that replaced the legacy subcommand groups",
            Self::Dropped => "nothing in the definition or the face replaces it",
        }
    }

    /// The two kinds that are outstanding work rather than a deliberate spelling move.
    const fn is_open_debt(self) -> bool {
        matches!(self, Self::Dropped | Self::FaceLevelSwitch)
    }
}

/// One accepted difference, named. `counterpart` lists the definition flag(s) the legacy name became, comma
/// separated for `Split`; it is checked to be a flag `command_for` really builds, so a row cannot rot into
/// claiming a rename that nobody implemented. `baseline_line` is the line in `docs/node-cli-surface-baseline.json`
/// where the legacy flag is listed, and it is checked too.
#[derive(Debug, Clone, Copy)]
struct AcceptedDifference {
    node: &'static str,
    flag: &'static str,
    side: Side,
    drift: Drift,
    counterpart: &'static str,
    baseline_line: u32,
    reason: &'static str,
}

const fn gone(node: &'static str, flag: &'static str, drift: Drift, counterpart: &'static str, baseline_line: u32, reason: &'static str) -> AcceptedDifference {
    AcceptedDifference { node, flag, side: Side::LegacyFlagGone, drift, counterpart, baseline_line, reason }
}

const fn added(node: &'static str, flag: &'static str, drift: Drift, reason: &'static str) -> AcceptedDifference {
    AcceptedDifference { node, flag, side: Side::DefinitionFlagNew, drift, counterpart: "", baseline_line: 0, reason }
}

impl AcceptedDifference {
    /// What the row claims, in the words a reviewer has to act on: the rule plus the node-specific note.
    fn rationale(&self) -> String {
        if self.reason.is_empty() { self.drift.sentence().to_owned() } else { format!("{} — {}", self.drift.sentence(), self.reason) }
    }
}

/// The legacy surface of one node, reduced to what this comparison needs.
struct LegacySurface {
    node_id: String,
    style: String,
    program: Option<String>,
    /// Union of the flags of every command the node declared, plus the baseline line each one was read at.
    flags: BTreeSet<String>,
    flag_lines: BTreeMap<String, u32>,
    command_count: usize,
}

// ------------------------------------------------------------------ the accepted differences

/// Accepted differences, one row each, grouped by node then by flag. `bun run migrate:node-cli-surface` regenerates
/// the evidence lines, and the tests below re-read them, so a row whose line moved fails with the new number.
const ACCEPTED: &[AcceptedDifference] = &[
    gone("bandia", "clipboard", Drift::Dropped, "", 45, "cli.ts:195 reads paths from the clipboard; neither a field nor a face switch replaces it"),
    gone("bandia", "format", Drift::Renamed, "compressFormat", 39, "format only ever named the archive format"),
    gone("bandia", "json", Drift::FaceLevelSwitch, "", 44, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("bandia", "mappingFile", Drift::Alias, "mappingText", 26, "cli.ts reads either spelling into mappingText"),
    gone("bandia", "mappings", Drift::Renamed, "mappingText", 25, "inline mapping JSON is now the multiline field"),
    gone("bandia", "mode", Drift::Renamed, "extractMode", 34, "the extract select spells the archive variant"),
    gone("bandia", "open", Drift::Renamed, "openInEverything", 42, ""),
    gone("bandia", "outputPath", Drift::Renamed, "efuOutputPath", 28, "export-efu's output path, now spelled for its action"),
    gone("bandia", "overwrite", Drift::Renamed, "overwriteMode", 38, "the boolean became the overwrite select"),
    gone("bandia", "path", Drift::Alias, "paths", 23, "one input accepted singular and plural"),
    gone("bandia", "prefix", Drift::Renamed, "outputPrefix", 36, ""),
    gone("bandia", "useTrash", Drift::Dropped, "", 30, "cli.ts:180 chooses recycle bin over permanent delete; the definition has no trash field"),
    added("bandia", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("cleanf", "json", Drift::FaceLevelSwitch, "", 232, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("cleanf", "paths", Drift::Renamed, "pathsText", 228, ""),
    gone("cleanf", "presets", Drift::Renamed, "presetsText", 229, ""),
    added("cleanf", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("crashu", "autoMove", Drift::ActionVariant, "", 292, "cli.ts:235 gates the move actions; the def spells them as actions move/execute"),
    gone("crashu", "json", Drift::FaceLevelSwitch, "", 297, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("crashu", "source", Drift::Renamed, "sourcePaths", 285, "cli.ts falls back from sourcePaths to source"),
    gone("crashu", "threshold", Drift::Renamed, "similarityThreshold", 290, ""),
    added("crashu", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("dissolvef", "archive", Drift::ActionVariant, "", 385, "the def declares archive as an action"),
    gone("dissolvef", "direct", Drift::ActionVariant, "", 386, "the def declares direct as an action"),
    gone("dissolvef", "dryRun", Drift::Renamed, "preview", 388, "legacy accepted both spellings; def keeps preview defaulting to true"),
    gone("dissolvef", "json", Drift::FaceLevelSwitch, "", 399, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("dissolvef", "media", Drift::ActionVariant, "", 384, "the def declares media as an action"),
    gone("dissolvef", "mediaTypes", Drift::Dropped, "", 397, "cli.ts:237 comma-separated media types for the media action; no field"),
    gone("dissolvef", "nested", Drift::ActionVariant, "", 383, "the def declares nested as an action"),
    gone("dissolvef", "skipBlacklist", Drift::Dropped, "", 398, "cli.ts:238 turns off the built-in blacklist filter; no field"),
    added("dissolvef", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("encodeb", "json", Drift::FaceLevelSwitch, "", 638, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("encodeb", "transform", Drift::Dropped, "", 635, "cli.ts:209 transform is recode/decode-hash-u/normalize-middle-dot, not the def's replace/copy strategy (cli.ts:210)"),
    added("encodeb", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("enginev", "contentRating", Drift::Renamed, "ratingFilter", 695, ""),
    gone("enginev", "descMaxLength", Drift::Dropped, "", 701, "cli.ts:168 description placeholder max length; no field"),
    gone("enginev", "execute", Drift::Inverted, "dryRun", 704, "cli.ts:234 dryRun = execute ? false : (dryRun ?? true), and the def defaults dryRun true"),
    gone("enginev", "format", Drift::Renamed, "exportFormat", 710, ""),
    gone("enginev", "ids", Drift::Renamed, "idsText", 699, ""),
    gone("enginev", "json", Drift::FaceLevelSwitch, "", 714, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("enginev", "nameMaxLength", Drift::Dropped, "", 702, "cli.ts:169 final folder name max length; no field"),
    gone("enginev", "output", Drift::Alias, "exportPath", 708, "cli.ts:238 exportPath || output"),
    gone("enginev", "path", Drift::Renamed, "workshopPath", 692, ""),
    gone("enginev", "rating", Drift::Alias, "ratingFilter", 696, "cli.ts:163 is documented as 'Alias for --contentRating'"),
    gone("enginev", "tags", Drift::Renamed, "tagsText", 698, ""),
    gone("enginev", "title", Drift::Renamed, "titleFilter", 694, ""),
    gone("enginev", "type", Drift::Renamed, "typeFilter", 697, ""),
    gone("enginev", "wallpapersFile", Drift::Dropped, "", 693, "cli.ts:160 reloads a previous scan's wallpapers; no field"),
    added("enginev", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    added("enginev", "galleryColumns", Drift::GuidedField, "comes from packages/nodes/enginev/src/interaction.ts and never had a legacy CLI spelling"),
    added("enginev", "imageBackend", Drift::GuidedField, "comes from packages/nodes/enginev/src/interaction.ts and never had a legacy CLI spelling"),
    added("enginev", "maxWorkers", Drift::GuidedField, "comes from packages/nodes/enginev/src/interaction.ts and never had a legacy CLI spelling"),
    gone("formatv", "json", Drift::FaceLevelSwitch, "", 889, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("formatv", "path", Drift::Alias, "pathsText", 882, ""),
    gone("formatv", "paths", Drift::Renamed, "pathsText", 883, ""),
    gone("formatv", "prefix", Drift::Renamed, "prefixName", 886, ""),
    added("formatv", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("gifu", "lang", Drift::FaceLevelSwitch, "", 959, "cli.ts:364 the ui/gd launcher's language; a face concern the Rust face does not have yet"),
    gone("gifu", "renderer", Drift::FaceLevelSwitch, "", 958, "cli.ts:363 selects the opentui renderer; the ratatui TUI binary is the replacement"),
    gone("gifu", "theme", Drift::FaceLevelSwitch, "", 960, "cli.ts:365 terminal theme name; owned by xiranite-tui-runtime's theme, not the definition"),
    added("gifu", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    added("gifu", "configPath", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "databasePath", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "dryRun", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "durationMs", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "extractSingle", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "ffmpegThreads", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "format", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "loop", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "maxWorkers", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "mp4Cq", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "mp4Preset", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "namePrefix", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "nameTemplate", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "outDir", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "outMode", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "overwrite", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "pathsText", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "quality", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "recordRun", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "recursive", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "webmCpuUsed", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "webmCrf", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    added("gifu", "webpMethod", Drift::GuidedField, "comes from packages/nodes/gifu/src/interaction.ts and never had a legacy CLI spelling"),
    gone("kavvka", "depth", Drift::Renamed, "scanDepth", 1036, ""),
    gone("kavvka", "json", Drift::FaceLevelSwitch, "", 1040, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("kavvka", "keyword", Drift::Alias, "keywordText", 1034, ""),
    gone("kavvka", "keywords", Drift::Renamed, "keywordText", 1035, ""),
    gone("kavvka", "path", Drift::Alias, "paths", 1030, ""),
    gone("kavvka", "root", Drift::Alias, "scanRoots", 1032, "cli.ts:239 parseList(roots || root)"),
    gone("kavvka", "roots", Drift::Renamed, "scanRoots", 1033, ""),
    added("kavvka", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("linedup", "caseInsensitive", Drift::Inverted, "caseSensitive", 1106, "cli.ts:113 derives caseSensitive = case_insensitive !== true"),
    gone("linedup", "filter", Drift::Renamed, "filterText", 1102, ""),
    gone("linedup", "filterFile", Drift::Alias, "filterText", 1103, ""),
    gone("linedup", "json", Drift::FaceLevelSwitch, "", 1105, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("linedup", "outputFile", Drift::Dropped, "", 1104, "cli.ts:143 writes kept lines to a file; the definition has no output field"),
    gone("linedup", "preserveOrder", Drift::Inverted, "sort", 1107, "cli.ts:113 derives sort = preserve_order !== true"),
    gone("linedup", "source", Drift::Renamed, "sourceText", 1100, ""),
    gone("linedup", "sourceFile", Drift::Alias, "sourceText", 1101, ""),
    gone("linku", "includeInvalid", Drift::Dropped, "", 1134, "cli.ts:208 imports invalid legacy records; no field replaces it"),
    gone("linku", "json", Drift::FaceLevelSwitch, "", 1135, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    added("linku", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("logx", "dir", Drift::Renamed, "directory", 1231, ""),
    gone("logx", "event", Drift::Renamed, "eventName", 1232, ""),
    gone("logx", "json", Drift::FaceLevelSwitch, "", 1233, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("logx", "level", Drift::Renamed, "minimumSeverity", 1234, ""),
    gone("logx", "session", Drift::Renamed, "sessionId", 1239, ""),
    added("logx", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("lorat", "db", Drift::Renamed, "triggerDbJson", 1260, "cli.ts:238 args.db ?? readTextFile(args.dbFile)"),
    gone("lorat", "dbFile", Drift::Alias, "triggerDbJson", 1261, ""),
    gone("lorat", "folder", Drift::Renamed, "folderPath", 1259, ""),
    gone("lorat", "json", Drift::FaceLevelSwitch, "", 1268, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("lorat", "keys", Drift::Renamed, "selectedKeys", 1264, "cli.ts:245 splitKeys(args.keys)"),
    gone("lorat", "output", Drift::Dropped, "", 1267, "cli.ts:226 the export-db output file; the definition has no export path field"),
    gone("lorat", "rows", Drift::Renamed, "rowsJson", 1262, "cli.ts:239 args.rows ?? readTextFile(args.rowsFile)"),
    gone("lorat", "rowsFile", Drift::Alias, "rowsJson", 1263, ""),
    gone("lorat", "status", Drift::Renamed, "statusFilter", 1265, "cli.ts:77 normalizeStatus"),
    added("lorat", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    added("lorat", "collectionCreateModelFolder", Drift::GuidedField, "comes from packages/nodes/lorat/src/interaction.ts and never had a legacy CLI spelling"),
    added("lorat", "collectionItemsJson", Drift::GuidedField, "comes from packages/nodes/lorat/src/interaction.ts and never had a legacy CLI spelling"),
    added("lorat", "collectionOverwrite", Drift::GuidedField, "comes from packages/nodes/lorat/src/interaction.ts and never had a legacy CLI spelling"),
    added("lorat", "collectionRoot", Drift::GuidedField, "comes from packages/nodes/lorat/src/interaction.ts and never had a legacy CLI spelling"),
    gone("marku", "config", Drift::Renamed, "stepConfig", 1366, ""),
    gone("marku", "input", Drift::Renamed, "inputText", 1363, "cli.ts:342 inputFile = args.inputFile || args.input"),
    gone("marku", "inputFile", Drift::Alias, "inputText", 1364, ""),
    gone("marku", "json", Drift::FaceLevelSwitch, "", 1373, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("marku", "name", Drift::Dropped, "", 1460, "cli.ts:176 a named workflow from [nodes.marku].workflowLibrary; no field"),
    gone("marku", "outputFile", Drift::Dropped, "", 1365, "cli.ts:46 writes the processed text to a file; no field"),
    gone("marku", "path", Drift::Renamed, "paths", 1361, ""),
    gone("marku", "workflow", Drift::Dropped, "", 1458, "cli.ts:174 inline workflow JSON; no field"),
    gone("marku", "workflowFile", Drift::Dropped, "", 1459, "cli.ts:175 a workflow JSON file; no field"),
    gone("marku", "write", Drift::Inverted, "dryRun", 1369, "the opt-in write switch against the def's dryRun default true"),
    added("marku", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("migratef", "json", Drift::FaceLevelSwitch, "", 1491, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("migratef", "path", Drift::Alias, "sourcePaths", 1484, "cli.ts:244 splitArg(args.source || args.path)"),
    gone("migratef", "source", Drift::Renamed, "sourcePaths", 1485, ""),
    gone("migratef", "target", Drift::Renamed, "targetPath", 1486, ""),
    added("migratef", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    added("migratef", "historyLimit", Drift::GuidedField, "comes from packages/nodes/migratef/src/interaction.ts and never had a legacy CLI spelling"),
    added("migratef", "maxWorkers", Drift::GuidedField, "comes from packages/nodes/migratef/src/interaction.ts and never had a legacy CLI spelling"),
    gone("movea", "archive", Drift::Renamed, "archiveName", 1578, ""),
    gone("movea", "folders", Drift::Renamed, "subfolders", 1579, ""),
    gone("movea", "json", Drift::FaceLevelSwitch, "", 1583, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("movea", "level1", Drift::Renamed, "level1Name", 1577, ""),
    gone("movea", "path", Drift::Alias, "rootPath", 1575, "cli.ts:219 root || path"),
    gone("movea", "plan", Drift::Renamed, "movePlan", 1581, ""),
    gone("movea", "regex", Drift::Renamed, "regexPatterns", 1580, ""),
    gone("movea", "root", Drift::Renamed, "rootPath", 1576, ""),
    added("movea", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    added("movea", "allowMoveToUnnumbered", Drift::GuidedField, "comes from packages/nodes/movea/src/interaction.ts and never had a legacy CLI spelling"),
    added("movea", "blacklist", Drift::GuidedField, "comes from packages/nodes/movea/src/interaction.ts and never had a legacy CLI spelling"),
    added("movea", "enableFolderMoving", Drift::GuidedField, "comes from packages/nodes/movea/src/interaction.ts and never had a legacy CLI spelling"),
    added("movea", "priorityKeywords", Drift::GuidedField, "comes from packages/nodes/movea/src/interaction.ts and never had a legacy CLI spelling"),
    gone("mvz", "entries", Drift::Renamed, "fileText", 1640, ""),
    gone("mvz", "entry", Drift::Alias, "fileText", 1639, "cli.ts:211 one entry joins the entry list"),
    gone("mvz", "file", Drift::Alias, "fileText", 1641, "cli.ts:192 a text file holding the same entries"),
    gone("mvz", "json", Drift::FaceLevelSwitch, "", 1650, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    added("mvz", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("owithu", "config", Drift::Renamed, "path", 1748, "cli.ts:143 --config is the owithu.toml path, aliased -c"),
    gone("owithu", "json", Drift::FaceLevelSwitch, "", 1751, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("owithu", "key", Drift::Renamed, "onlyKey", 1750, ""),
    added("owithu", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    added("owithu", "configText", Drift::GuidedField, "comes from packages/nodes/owithu/src/interaction.ts and never had a legacy CLI spelling"),
    gone("rawfilter", "json", Drift::FaceLevelSwitch, "", 1804, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("rawfilter", "nameOnly", Drift::Renamed, "nameOnlyMode", 1798, ""),
    added("rawfilter", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("repacku", "clipboard", Drift::Dropped, "", 1880, "reads the folder list from the clipboard; neither a field nor a face switch replaces it"),
    gone("repacku", "config", Drift::Alias, "configPath", 1875, "cli.ts declares both --config and --configPath"),
    gone("repacku", "gallery", Drift::ActionVariant, "", 1883, "the def declares gallery-pack as an action"),
    gone("repacku", "json", Drift::FaceLevelSwitch, "", 1887, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("repacku", "output", Drift::Alias, "outputPath", 1878, ""),
    gone("repacku", "path", Drift::Renamed, "pathsText", 1873, ""),
    gone("repacku", "paths", Drift::Alias, "pathsText", 1874, "cli.ts:464 one list from both spellings"),
    gone("repacku", "single", Drift::ActionVariant, "", 1884, "the def declares single-pack as an action"),
    added("repacku", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("seriex", "config", Drift::Renamed, "configPath", 2015, ""),
    gone("seriex", "json", Drift::FaceLevelSwitch, "", 2026, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("seriex", "known", Drift::Renamed, "knownSeriesNames", 2017, ""),
    gone("seriex", "knownDir", Drift::Renamed, "knownSeriesDirs", 2018, ""),
    gone("seriex", "lengthDiff", Drift::Renamed, "lengthDiffMax", 2025, ""),
    gone("seriex", "noPrefix", Drift::Inverted, "addPrefix", 2019, "the legacy switch suppressed the prefix the def field grants"),
    gone("seriex", "partial", Drift::Renamed, "partialThreshold", 2023, ""),
    gone("seriex", "path", Drift::Renamed, "directoryPath", 2014, ""),
    gone("seriex", "ratio", Drift::Renamed, "ratioThreshold", 2022, ""),
    gone("seriex", "token", Drift::Renamed, "tokenThreshold", 2024, ""),
    added("seriex", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    gone("sleept", "download", Drift::Renamed, "downloadThreshold", 2119, ""),
    gone("sleept", "duration", Drift::Split, "netDuration,cpuDuration", 2120, "cli.ts:357 and cli.ts:385 feed one flag into the two per-mode durations"),
    gone("sleept", "json", Drift::FaceLevelSwitch, "", 2086, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("sleept", "lang", Drift::FaceLevelSwitch, "", 2071, "cli.ts:287 the ui/gd launcher's language"),
    gone("sleept", "maxWait", Drift::Renamed, "maxWaitSeconds", 2122, "cli.ts:359"),
    gone("sleept", "power", Drift::Renamed, "powerMode", 2097, "cli.ts:360"),
    gone("sleept", "renderer", Drift::FaceLevelSwitch, "", 2070, "cli.ts:286 selects the opentui renderer"),
    gone("sleept", "target", Drift::Renamed, "targetDatetime", 2107, "cli.ts:328"),
    gone("sleept", "theme", Drift::FaceLevelSwitch, "", 2072, "cli.ts:288 terminal theme name"),
    gone("sleept", "threshold", Drift::Renamed, "cpuThreshold", 2133, "cli.ts:384"),
    gone("sleept", "trigger", Drift::Renamed, "netTriggerMode", 2121, "cli.ts:358"),
    gone("sleept", "upload", Drift::Renamed, "uploadThreshold", 2118, "cli.ts:355"),
    added("sleept", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
    added("sleept", "cpuDuration", Drift::GuidedField, "comes from packages/nodes/sleept/src/interaction.ts and never had a legacy CLI spelling"),
    added("sleept", "netDuration", Drift::GuidedField, "comes from packages/nodes/sleept/src/interaction.ts and never had a legacy CLI spelling"),
    gone("trename", "base", Drift::Alias, "basePath", 2256, "cli.ts:364 basePath || base"),
    gone("trename", "exclude", Drift::Dropped, "", 2262, "cli.ts:358 merges it into excludeExts, and the definition declares neither"),
    gone("trename", "excludeExts", Drift::Dropped, "", 2263, "cli.ts:282 comma-separated excluded extensions; no field"),
    gone("trename", "excludePattern", Drift::Dropped, "", 2264, "cli.ts:359 merges it into excludePatterns, and the definition declares neither"),
    gone("trename", "excludePatterns", Drift::Dropped, "", 2265, "cli.ts:285 comma-separated excluded name patterns; no field"),
    gone("trename", "execute", Drift::Inverted, "dryRun", 2271, "cli.ts:365 dryRun = execute ? false : (dryRun ?? true), and the def defaults dryRun true"),
    gone("trename", "hidden", Drift::Alias, "includeHidden", 2259, "cli.ts:279 is documented as 'Alias for --includeHidden'"),
    gone("trename", "input", Drift::Alias, "jsonContent", 2253, "cli.ts:342 inputFile = args.inputFile || args.input"),
    gone("trename", "inputFile", Drift::Renamed, "jsonContent", 2254, ""),
    gone("trename", "json", Drift::FaceLevelSwitch, "", 2275, "the machine-readable output switch belongs to the face; xiranite-cli-runtime has no output-format module, so nobody honours it yet"),
    gone("trename", "noRoot", Drift::Inverted, "includeRoot", 2261, "cli.ts:357 includeRoot = !noRoot when the flag is set"),
    gone("trename", "output", Drift::Dropped, "", 2255, "cli.ts:275 writes the scan JSON segments to a file; no field"),
    gone("trename", "path", Drift::Alias, "paths", 2251, ""),
    gone("trename", "split", Drift::Alias, "maxLines", 2266, "cli.ts:360 maxLines ?? split"),
    added("trename", "action", Drift::SubcommandSelector, "the legacy per-subcommand flag groups become one action field on a flat command"),
];

// ------------------------------------------------------------------ reading the two sides

fn repo_root() -> PathBuf {
    let start = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let marker = Path::new("docs").join("xiranite-target-node-manifest.json");
    let mut current = Some(start.as_path());
    while let Some(directory) = current {
        if directory.join(&marker).is_file() {
            return directory.to_path_buf();
        }
        current = directory.parent();
    }
    panic!("no repository root above {start:?} (needs {})", marker.display());
}

fn is_flag_entry(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|character| character.is_ascii_alphanumeric() || character == '-')
}

/// The first line inside each node's region of the baseline where a flag name is listed.
///
/// Read positionally rather than by re-serialising, because the evidence this test cites is a line number in a
/// generated file, and a line number has to come from the file itself. Region = this `"nodeId"` up to the next one,
/// which is where `commands` lives, before the supplementary `flagLiterals` block.
fn flag_lines_by_node(root: &Path) -> BTreeMap<String, BTreeMap<String, u32>> {
    let text = std::fs::read_to_string(root.join(BASELINE_RELPATH)).expect("readable CLI surface baseline");
    let lines: Vec<&str> = text.lines().collect();
    let mut starts: Vec<(usize, String)> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if let Some(rest) = line.trim().strip_prefix("\"nodeId\": \"")
            && let Some(end) = rest.find('"')
        {
            starts.push((index + 1, rest[..end].to_owned()));
        }
    }
    let mut by_node = BTreeMap::new();
    for (position, (start, node_id)) in starts.iter().enumerate() {
        let end = starts.get(position + 1).map(|(next, _)| *next).unwrap_or(lines.len());
        let mut flags: BTreeMap<String, u32> = BTreeMap::new();
        for number in *start..end {
            // A bare array entry is `"flag",` — or `"flag"` for the last one. Anything else keeps a `:` or a
            // space (`"nodeId": "audiov",`, `"name": "extract",`) and is therefore not a flag name.
            let Some(entry) = lines[number - 1].trim().strip_prefix('"').and_then(|body| body.strip_suffix("\",").or_else(|| body.strip_suffix('"'))) else {
                continue;
            };
            if is_flag_entry(entry) && !flags.contains_key(entry) {
                flags.insert(entry.to_owned(), number as u32);
            }
        }
        by_node.insert(node_id.clone(), flags);
    }
    by_node
}

/// The baseline's legacy surfaces. `style` is kept because it decides what this test compares and what it discloses.
fn load_surfaces(root: &Path) -> Vec<LegacySurface> {
    let text = std::fs::read_to_string(root.join(BASELINE_RELPATH)).expect("readable CLI surface baseline");
    let document: Value = serde_json::from_str(&text).expect("the baseline is JSON");
    let lines = flag_lines_by_node(root);
    let surfaces = document.get("surfaces").and_then(Value::as_array).expect("`surfaces` is an array");
    surfaces
        .iter()
        .map(|surface| {
            let node_id = surface.get("nodeId").and_then(Value::as_str).expect("nodeId").to_owned();
            let style = surface.get("style").and_then(Value::as_str).expect("style").to_owned();
            let program = surface.get("program").and_then(Value::as_str).map(str::to_owned);
            let mut flags = BTreeSet::new();
            let commands = surface.get("commands").and_then(Value::as_array).expect("`commands` is an array");
            for command in commands {
                for flag in command.get("flags").and_then(Value::as_array).expect("`flags` is an array") {
                    flags.insert(flag.as_str().expect("a flag is a string").to_owned());
                }
            }
            LegacySurface {
                command_count: commands.len(),
                flag_lines: lines.get(&node_id).cloned().unwrap_or_default(),
                node_id,
                program,
                style,
                flags,
            }
        })
        .collect()
}

/// Published definitions win over drafts, exactly as `audit:node-definitions` and `audit:node-interaction-parity`
/// resolve them, so this comparison reads the file the shipped face would read.
fn definition_document(root: &Path, node: &str) -> Option<(PathBuf, String)> {
    for candidate in [
        root.join("plugins").join(node).join("definition.json"),
        root.join("node-definitions").join(format!("{node}.json")),
    ] {
        if candidate.is_file() {
            return Some((candidate.clone(), std::fs::read_to_string(&candidate).expect("readable definition")));
        }
    }
    None
}

fn definition_for(root: &Path, node: &str) -> (PathBuf, NodeDefinition) {
    let (path, text) = definition_document(root, node).unwrap_or_else(|| panic!("no definition for {node} under plugins/ or node-definitions/"));
    let definition = parse_definition(&text).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
    assert_eq!(definition.node_id.as_str(), node, "{} declares a different nodeId", path.display());
    (path, definition)
}

/// The long flags a user would be able to type for this node.
///
/// Taken from `command_for`, not from the JSON, because the thing under test is the clap command the CLI face
/// builds: a field the builder skips, or a name it rewrites, must show up here.
#[cfg(feature = "tty")]
fn built_flags(definition: &NodeDefinition, program: &str) -> BTreeSet<String> {
    xiranite_cli_runtime::term::command_for(definition, program, LANGUAGE)
        .get_arguments()
        .map(|argument| argument.get_long().unwrap_or_default().to_owned())
        .collect()
}

#[cfg(feature = "tty")]
fn program_of(surface: &LegacySurface) -> String {
    surface.program.clone().unwrap_or_else(|| format!("x{}", surface.node_id))
}

/// What one node's two sides say about each name.
#[cfg(feature = "tty")]
struct NodeTally {
    legacy: usize,
    built: usize,
    matched: usize,
    legacy_gone: Vec<String>,
    definition_new: Vec<String>,
}

/// The comparison itself, as a pure function so the negative controls can feed it a hand-made flag set.
#[cfg(feature = "tty")]
fn compare_names(legacy: &BTreeSet<String>, built: &BTreeSet<String>) -> NodeTally {
    let legacy_gone: Vec<String> = legacy.difference(built).cloned().collect();
    let definition_new: Vec<String> = built.difference(legacy).cloned().collect();
    NodeTally {
        built: built.len(),
        definition_new,
        legacy: legacy.len(),
        legacy_gone,
        matched: legacy.intersection(built).count(),
    }
}

/// Names every difference of one node, and returns the ones the table does not account for.
///
/// Every way a row can stop being true is checked here rather than trusted: the difference it names disappeared
/// (stale row), its evidence line moved or never existed, its `counterpart` is not built any more, a
/// definition-only row points at a flag the definition dropped, or a definition-only row pretends to cite the
/// baseline. Each failure message carries the offending name.
#[cfg(feature = "tty")]
fn audit_node(surface: &LegacySurface, built: &BTreeSet<String>) -> (NodeTally, Vec<String>) {
    let tally = compare_names(&surface.flags, built);
    let mut problems: Vec<String> = Vec::new();
    let rows: Vec<&AcceptedDifference> = ACCEPTED.iter().filter(|row| row.node == surface.node_id).collect();
    let explained: BTreeSet<String> = rows
        .iter()
        .filter(|row| row.side == Side::LegacyFlagGone)
        .flat_map(|row| row.counterpart.split(',').filter(|name| !name.is_empty()).map(str::to_owned))
        .collect();

    for name in &tally.legacy_gone {
        if !rows.iter().any(|row| row.side == Side::LegacyFlagGone && row.flag == *name) {
            problems.push(format!("{}: --{name} was typable in the legacy CLI and no row accepts its loss", surface.node_id));
        }
    }
    for name in &tally.definition_new {
        let named = rows.iter().any(|row| row.side == Side::DefinitionFlagNew && row.flag == *name);
        if !named && !explained.contains(name) {
            problems.push(format!("{}: command_for builds --{name}, which the legacy CLI never offered and no row explains", surface.node_id));
        }
    }

    for row in &rows {
        match row.side {
            Side::LegacyFlagGone => {
                if !tally.legacy_gone.iter().any(|name| name == row.flag) {
                    problems.push(format!("{}: the row accepting the loss of --{} (\"{}\") is stale — that difference no longer exists", surface.node_id, row.flag, row.rationale()));
                }
                match surface.flag_lines.get(row.flag) {
                    None => problems.push(format!("{}: row cites --{} but the baseline lists no such flag for this node", surface.node_id, row.flag)),
                    Some(line) if *line != row.baseline_line => {
                        problems.push(format!("{}: the baseline lists --{} on line {line}, the row cites {}", surface.node_id, row.flag, row.baseline_line));
                    }
                    Some(_) => {}
                }
                for counterpart in row.counterpart.split(',').filter(|name| !name.is_empty()) {
                    if !built.contains(counterpart) {
                        problems.push(format!("{}: row says --{} became --{counterpart}, but command_for builds no such flag", surface.node_id, row.flag));
                    }
                }
            }
            Side::DefinitionFlagNew => {
                if !built.contains(row.flag) {
                    problems.push(format!("{}: row accepts --{} as a new field, but command_for no longer builds it", surface.node_id, row.flag));
                }
                if row.baseline_line != 0 {
                    problems.push(format!("{}: row for --{} cites baseline line {}; a flag the legacy CLI never had cannot be evidenced there", surface.node_id, row.flag, row.baseline_line));
                }
            }
        }
    }
    (tally, problems)
}

/// The nodes this test compares: a legacy CLI that declared flags of its own.
fn compared_surfaces(surfaces: &[LegacySurface]) -> Vec<&LegacySurface> {
    surfaces.iter().filter(|surface| !surface.flags.is_empty()).collect()
}

fn disclosed_surfaces(surfaces: &[LegacySurface]) -> Vec<&LegacySurface> {
    surfaces.iter().filter(|surface| surface.flags.is_empty()).collect()
}

// ------------------------------------------------------------------ the scans themselves

#[test]
fn the_baseline_really_carries_a_legacy_flag_surface() {
    let root = repo_root();
    let surfaces = load_surfaces(&root);
    assert!(!surfaces.is_empty(), "{BASELINE_RELPATH} carries no surfaces at all");

    let compared = compared_surfaces(&surfaces);
    let legacy_flags: usize = compared.iter().map(|surface| surface.flags.len()).sum();
    let commands: usize = compared.iter().map(|surface| surface.command_count).sum();
    assert!(
        compared.len() >= MIN_COMPARED_NODES,
        "only {} node(s) with a legacy flag surface were found (floor {MIN_COMPARED_NODES}); the comparison would be comparing nothing",
        compared.len()
    );
    assert!(
        legacy_flags >= MIN_LEGACY_FLAGS,
        "only {legacy_flags} legacy flag name(s) were read (floor {MIN_LEGACY_FLAGS}); an empty or truncated scan must not pass"
    );
    assert!(commands > 0, "the compared nodes declare no commands at all");

    // A node with a legacy CLI but no definition is a hole in the rewrite, not a skip: named here so it cannot hide.
    let missing: Vec<String> = compared
        .iter()
        .filter(|surface| definition_document(&root, &surface.node_id).is_none())
        .map(|surface| surface.node_id.clone())
        .collect();
    assert!(missing.is_empty(), "{} compared node(s) have no definition to compare against: {missing:?}", missing.len());

    // The disclosure side: nodes whose legacy CLI declared no flags, so this file has nothing to prove about them.
    let disclosed = disclosed_surfaces(&surfaces);
    let styles: BTreeMap<&str, usize> = disclosed.iter().fold(BTreeMap::new(), |mut counted, surface| {
        *counted.entry(surface.style.as_str()).or_insert(0) += 1;
        counted
    });
    assert!(
        disclosed.iter().all(|surface| surface.style == "interaction-driven" || surface.style == "none"),
        "a node with no legacy flags was disclosed while its style is not a known no-flag one: {:?}",
        disclosed.iter().filter(|surface| surface.style != "interaction-driven" && surface.style != "none").map(|surface| format!("{}={}", surface.node_id, surface.style)).collect::<Vec<String>>()
    );
    println!(
        "legacy side: {} node(s) compared carrying {commands} command(s) and {legacy_flags} flag name(s); {} node(s) disclosed without flags: {styles:?}",
        compared.len(),
        disclosed.len()
    );
}

#[test]
fn the_accepted_table_has_no_duplicate_or_self_contradicting_rows() {
    let mut seen: BTreeSet<(&str, &str, u8)> = BTreeSet::new();
    let duplicates: Vec<String> = ACCEPTED
        .iter()
        .filter(|row| !seen.insert((row.node, row.flag, if row.side == Side::LegacyFlagGone { 0 } else { 1 })))
        .map(|row| format!("{} --{} ({:?})", row.node, row.flag, row.side))
        .collect();
    assert!(duplicates.is_empty(), "the accepted table lists the same difference twice: {duplicates:?}");
    assert!(ACCEPTED.iter().all(|row| !row.node.is_empty() && !row.flag.is_empty()), "an accepted row has no node or no flag name");
    assert!(
        ACCEPTED.iter().all(|row| row.drift != Drift::Alias || !row.counterpart.is_empty()),
        "an Alias row must name the spelling the definition kept, or it claims a merge that cannot be checked"
    );

    let debt: Vec<String> = ACCEPTED
        .iter()
        .filter(|row| row.drift.is_open_debt())
        .map(|row| format!("{} --{} [{side}] {}", row.node, row.flag, row.rationale(), side = if row.side == Side::LegacyFlagGone { "legacy" } else { "definition" }))
        .collect();
    println!("{} accepted row(s), of which {} are open debt:", ACCEPTED.len(), debt.len());
    for line in &debt {
        println!("  DEBT {line}");
    }
}

#[test]
#[cfg(feature = "tty")]
fn every_flag_difference_between_the_legacy_cli_and_command_for_is_named() {
    let root = repo_root();
    let surfaces = load_surfaces(&root);
    let compared = compared_surfaces(&surfaces);
    let mut problems: Vec<String> = Vec::new();
    let mut legacy_flags = 0;
    let mut built_flags_total = 0;
    let mut matched = 0;
    let mut gone_rows = 0;
    let mut new_rows = 0;

    for surface in &compared {
        let (_, definition) = definition_for(&root, &surface.node_id);
        let built = built_flags(&definition, &program_of(surface));
        let (tally, node_problems) = audit_node(surface, &built);
        legacy_flags += tally.legacy;
        built_flags_total += tally.built;
        matched += tally.matched;
        gone_rows += tally.legacy_gone.len();
        new_rows += tally.definition_new.len();
        problems.extend(node_problems);
    }

    assert!(
        compared.len() >= MIN_COMPARED_NODES && legacy_flags >= MIN_LEGACY_FLAGS && built_flags_total >= MIN_BUILT_FLAGS,
        "the comparison shrank below its measured floor: {} node(s), {legacy_flags} legacy flag(s), {built_flags_total} built flag(s)",
        compared.len()
    );
    assert!(matched > 0, "not one legacy flag is covered, so the comparison would be reporting a total loss");
    assert!(problems.is_empty(), "{} unaccepted or rotted flag difference(s):\n{}", problems.len(), problems.join("\n"));

    let added_rows = ACCEPTED.iter().filter(|row| row.side == Side::DefinitionFlagNew).count();
    let debt_rows = ACCEPTED.iter().filter(|row| row.drift.is_open_debt()).count();
    println!(
        "flags: {legacy_flags} legacy name(s) over {} node(s); {matched} matched by command_for; {gone_rows} legacy-only, each one its own row; \
         {new_rows} definition-only, {added_rows} with a row of their own and {} accepted as the target a rename row already names; \
         {debt_rows} of the {} accepted rows are open debt.",
        compared.len(),
        new_rows - added_rows,
        ACCEPTED.len()
    );
}

#[test]
#[cfg(feature = "tty")]
fn a_definition_that_drops_a_typable_flag_is_reported_by_that_flag_name() {
    let root = repo_root();
    let surface = load_surfaces(&root).into_iter().find(|candidate| candidate.node_id == "trename").expect("trename is in the baseline");
    let (_, definition) = definition_for(&root, "trename");
    let program = program_of(&surface);
    let built = built_flags(&definition, &program);

    // Preconditions, so the control below cannot prove nothing: `paths` is a flag both sides agree on today.
    assert!(surface.flags.contains("paths"), "the legacy surface no longer accepts --paths, pick another flag");
    assert!(built.contains("paths"), "command_for no longer builds --paths, pick another flag");
    assert!(audit_node(&surface, &built).1.is_empty(), "trename is not clean today, so this control cannot show a new loss");

    let mut dropped = definition.clone();
    dropped.fields.retain(|field| field.id != "paths");
    let after = built_flags(&dropped, &program);
    assert!(!after.contains("paths"), "command_for still builds --paths after the field was removed");

    let (tally, problems) = audit_node(&surface, &after);
    assert!(tally.legacy_gone.contains(&"paths".to_owned()), "--paths was dropped but is not reported as gone: {:?}", tally.legacy_gone);
    assert_eq!(tally.matched + 1, compare_names(&surface.flags, &built).matched, "dropping one flag changed the matched count by something other than one");
    // Two rows talk about `--paths`: the unaccepted loss itself, and the row that merged the legacy `--path`
    // spelling into it. Both have to name the flag, or the control would pass on a misfiled message.
    assert!(problems.contains(&"trename: --paths was typable in the legacy CLI and no row accepts its loss".to_owned()), "the dropped flag must be reported by name: {problems:?}");
    assert_eq!(problems.len(), 2, "the unaccepted loss plus the one row whose counterpart vanished: {problems:?}");
    assert!(problems.iter().all(|problem| problem.contains("paths")), "every problem must name the flag that was lost: {problems:?}");
}

#[test]
#[cfg(feature = "tty")]
fn a_rename_accepted_by_a_row_is_invalidated_when_the_target_disappears() {
    let root = repo_root();
    let surface = load_surfaces(&root).into_iter().find(|candidate| candidate.node_id == "movea").expect("movea is in the baseline");
    let (_, definition) = definition_for(&root, "movea");
    let program = program_of(&surface);
    assert!(audit_node(&surface, &built_flags(&definition, &program)).1.is_empty(), "movea is not clean today");

    // Two rows say `--root` and `--path` became `--rootPath`; if the definition stops declaring it, the merge is a lie.
    let mut renamed = definition.clone();
    renamed.fields.retain(|field| field.id != "rootPath");
    let problems = audit_node(&surface, &built_flags(&renamed, &program)).1;
    let named: Vec<&String> = problems.iter().filter(|problem| problem.contains("rootPath")).collect();
    assert_eq!(named.len(), 2, "both rows pointing at --rootPath must be invalidated, got {problems:?}");
    for problem in &named {
        assert!(problem.contains("--root") || problem.contains("--path"), "the invalidation must name the row's legacy flag: {problem}");
    }
}

#[test]
#[cfg(feature = "tty")]
fn command_for_builds_one_long_flag_per_declared_field_for_every_compared_node() {
    let root = repo_root();
    let surfaces = load_surfaces(&root);
    let mut mismatched: Vec<String> = Vec::new();
    for surface in compared_surfaces(&surfaces) {
        let (path, definition) = definition_for(&root, &surface.node_id);
        let built = built_flags(&definition, &program_of(surface));
        let declared: BTreeSet<String> = definition.fields.iter().map(|field| field.id.clone()).collect();
        if built != declared {
            let only_built: Vec<String> = built.difference(&declared).cloned().collect();
            let only_declared: Vec<String> = declared.difference(&built).cloned().collect();
            mismatched.push(format!("{} ({}): built but undeclared {only_built:?}, declared but unbuilt {only_declared:?}", surface.node_id, path.display()));
        }
    }
    assert!(mismatched.is_empty(), "the flag set a user can type stopped being the field list\n{}", mismatched.join("\n"));
}
