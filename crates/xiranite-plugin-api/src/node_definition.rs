//! The node definition: the one vocabulary every face of a node reads (ADR-0069).
//!
//! Today that vocabulary is spread over three TypeScript files per node — `node def`, `help.ts` and
//! `interaction.ts` — and the interactive parts are *closures*: `visibleWhen(values) => boolean`,
//! `validate(value, values) => string | null`, `preview(input) => string[]`. A closure cannot cross into
//! `clap`, `ratatui` or a data file, so the vocabulary becomes declarative here and each face renders it.
//! The split ADR-0069 fixes is enforced by these types:
//!
//! - **shared semantics** live in this module — actions, fields, defaults, ranges, visibility, validation,
//!   the danger gate, help text, and which plugin export produces the preview and the result view;
//! - **composition** stays per face — how commands are grouped, which panels appear, how keys behave.
//!   Nothing here can express a layout, a widget or a key binding, which is the point.
//!
//! A rule that genuinely cannot be declared does not become a Rust closure either: it becomes a named
//! plugin export ([`Rule::Custom`], [`DangerGate::PluginExport`]), so the node still has exactly one
//! implementation and every host reaches it the same way.
//!
//! ## Encoding is not this crate's job
//!
//! Like the rest of the Plugin API these are plain records, fieldless-ish variants, lists, options and
//! fixed-width integers — the shapes WIT expresses directly, and deliberately no `usize`, no lifetime,
//! no trait object and no serialization derive. How a definition is written to disk or sent over the
//! boundary belongs to the host and plugin shim layers, with `camelCase` JSON field names where the HTTP
//! protocol already publishes them (ADR-0068).

use std::collections::BTreeSet;

use crate::identifiers::PluginId;

/// Value space of [`Scalar`]: the three types `InteractionValues` allows today
/// (`packages/cli-runtime/src/interaction.ts:7`, `string | number | boolean`).
#[derive(Debug, Clone, PartialEq)]
pub enum Scalar {
    /// `text`, `multiline` and `path-list` fields carry text.
    Text(String),
    /// `number` fields carry a float; the wire has always allowed `step: 100` style fractions.
    Number(f64),
    /// `boolean` fields carry a flag.
    Boolean(bool),
}

impl Scalar {
    /// The kind label a face renders this value with, matching `InteractionFieldKind` for its field.
    #[must_use]
    pub const fn kind_label(&self) -> &'static str {
        match self {
            Self::Text(_) => "text",
            Self::Number(_) => "number",
            Self::Boolean(_) => "boolean",
        }
    }

    /// The text form the CLI and TUI show in a field summary.
    #[must_use]
    pub fn display_text(&self) -> String {
        match self {
            Self::Text(text) => text.clone(),
            Self::Number(number) => {
                if number.fract() == 0.0 { format!("{}", *number as i64) } else { number.to_string() }
            }
            Self::Boolean(flag) => flag.to_string(),
        }
    }
}

/// The six field kinds of `InteractionFieldKind` (`packages/cli-runtime/src/interaction.ts:9`), verbatim.
///
/// A face chooses the widget — `multiline` may be a `ratatui-textarea`, a JSON dialog in React, or a
/// flag file in the CLI — this enum only says what the value means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind {
    Text,
    Multiline,
    PathList,
    Number,
    Select,
    Boolean,
}

impl FieldKind {
    /// Every kind, in the order the old TypeScript union lists them.
    pub const ALL: [Self; 6] = [
        Self::Text,
        Self::Multiline,
        Self::PathList,
        Self::Number,
        Self::Select,
        Self::Boolean,
    ];

    /// The wire label.
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Multiline => "multiline",
            Self::PathList => "path-list",
            Self::Number => "number",
            Self::Select => "select",
            Self::Boolean => "boolean",
        }
    }

    /// Decode a wire label; `None` for anything the union does not list.
    #[must_use]
    pub fn from_wire(value: &str) -> Option<Self> {
        match value {
            "text" => Some(Self::Text),
            "multiline" => Some(Self::Multiline),
            "path-list" => Some(Self::PathList),
            "number" => Some(Self::Number),
            "select" => Some(Self::Select),
            "boolean" => Some(Self::Boolean),
            _ => None,
        }
    }

    /// Whether a `number` field is the only kind carrying [`FieldRange`].
    #[must_use]
    pub const fn carries_range(&self) -> bool {
        matches!(self, Self::Number)
    }

    /// Whether the kind lists options, which is what makes it a `select`.
    #[must_use]
    pub const fn carries_options(&self) -> bool {
        matches!(self, Self::Select)
    }
}

/// One choice of a `select` field: `InteractionOption` (`packages/cli-runtime/src/interaction.ts:11-16`).
#[derive(Debug, Clone, PartialEq)]
pub struct FieldOption {
    /// `value`.
    pub value: Scalar,
    /// `label`, the text a face shows.
    pub label: String,
    /// `hint`, optional secondary line.
    pub hint: Option<String>,
    /// `disabled`.
    pub disabled: bool,
}

/// `min`/`max`/`step` of a number field, as integers where the node means integers.
///
/// The old code used `number` for all three; `step` keeps a float because `trename`'s
/// `nonNegativeInteger(zh)` rule combined `step: 100` with an integer check, and the integer-ness is
/// carried by [`Rule::IntegerInRange`] rather than by the step's type.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FieldRange {
    /// Inclusive lower bound, absent when unbounded.
    pub min: Option<f64>,
    /// Inclusive upper bound.
    pub max: Option<f64>,
    /// Keyboard and slider increment.
    pub step: f64,
}

/// A named action of the node: the `action` entry of today's `interaction.ts` field options.
#[derive(Debug, Clone, PartialEq)]
pub struct NodeAction {
    /// Stable id used by the CLI subcommand, the TUI tab and the `input.action` slot.
    pub id: String,
    /// Human label, as in `{ id: "scan", label: "扫描" }`.
    pub label: String,
    /// Key into the node's `help.ts` dictionary. Help text never drifts (ADR-0069), so the definition
    /// references it instead of restating it.
    pub help_key: String,
}

/// `visibleWhen` as data. Every predicate the current node set actually uses is expressible here:
/// trename writes `visibleWhen: actionIs("scan")` and `actionIs("import", "validate", "rename")`
/// (`packages/nodes/trename/src/interaction.ts:40-52`).
#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    /// Always visible — the absence of a `visibleWhen`.
    Always,
    /// `actionIs(..)`: the `action` field equals one of these ids.
    ActionIs { action_field: String, allowed: Vec<String> },
    /// A named field holds exactly this value.
    FieldEquals { field_id: String, value: Scalar },
    /// A named field holds a non-empty text value.
    FieldFilled { field_id: String },
    /// A named boolean field is set.
    FieldTrue { field_id: String },
    /// All of these hold.
    All(Vec<Condition>),
    /// Any of these hold.
    Any(Vec<Condition>),
    /// Negation.
    Not(Box<Condition>),
}

impl Condition {
    /// Field ids this condition reads, for the structural check that a definition references only
    /// fields it declares.
    pub fn referenced_fields(&self, into: &mut BTreeSet<String>) {
        match self {
            Self::Always => {}
            Self::ActionIs { action_field, .. } => {
                into.insert(action_field.clone());
            }
            Self::FieldEquals { field_id, .. } | Self::FieldFilled { field_id } | Self::FieldTrue { field_id } => {
                into.insert(field_id.clone());
            }
            Self::All(inner) | Self::Any(inner) => {
                for condition in inner {
                    condition.referenced_fields(into);
                }
            }
            Self::Not(inner) => inner.referenced_fields(into),
        }
    }
}

/// `validate` as data, with a named escape hatch.
#[derive(Debug, Clone, PartialEq)]
pub enum Rule {
    /// The field must hold a value.
    Required,
    /// Text must not be blank after trimming.
    NonBlank,
    /// `nonNegativeInteger(..)`, the trename `maxLines` rule.
    IntegerAtLeast { minimum: i64 },
    /// Bounded integer; the bounds are the field's [`FieldRange`] when present.
    IntegerInRange,
    /// `select` values must come from the declared options.
    OneOfDeclaredOptions,
    /// A path list must contain at least `minimum` entries.
    AtLeastLines { minimum: u32 },
    /// A rule the node could not declare: name of a plugin export taking the field value and the whole
    /// value map, and returning either nothing or a message. The export, not a per-face Rust closure.
    Custom { export_name: String },
}

/// How a field value becomes part of the plugin's input document.
///
/// Today `trenameInputFromInteractionValues(values)` hand-codes this mapping
/// (`packages/nodes/trename/src/interaction.ts:87`); declared here it lets all three faces build the
/// same input from the same values.
#[derive(Debug, Clone, PartialEq)]
pub struct InputBinding {
    /// Field id supplying the value.
    pub field_id: String,
    /// Slot name in the input document, e.g. `jsonContent`.
    pub slot: String,
    /// Conversion applied on the way.
    pub transform: Transform,
}

/// The conversions the current node set needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transform {
    /// Pass the value through.
    Identity,
    /// Trim surrounding whitespace.
    Trim,
    /// Split text into lines, dropping blanks — the `path-list` shape.
    Lines,
    /// Interpret text as an integer.
    AsInteger,
    /// Interpret text as a boolean flag.
    AsBoolean,
}

/// The danger gate: `isDangerous` plus `dangerPrompt` as data.
#[derive(Debug, Clone, PartialEq)]
pub enum DangerGate {
    /// Never asks.
    None,
    /// Asks when the action is one of these, e.g. trename's live `rename` with `dryRun` off.
    ActionIn { action_field: String, dangerous: Vec<String> },
    /// Asks when a boolean field is set (or, with `inverted`, when it is not).
    FieldFlag { field_id: String, inverted: bool },
    /// Compound: the gate holds when every listed condition holds.
    All(Vec<Condition>),
    /// The node computes it; name of the plugin export consulted.
    PluginExport { export_name: String },
}

/// The confirmation dialog's content, matching `dangerPrompt()`'s three strings
/// (`packages/nodes/trename/src/interaction.ts:75`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DangerPrompt {
    /// `title`.
    pub title: String,
    /// `body`.
    pub body: String,
    /// `confirmLabel`.
    pub confirm_label: String,
}

/// One labelled group of fields: `TerminalViewSection` (`packages/cli-runtime/src/interaction.ts:36-41`).
///
/// Positions and sizes are deliberately absent — a face lays out, this only says which fields belong
/// together and in what reading order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FieldGroup {
    /// Stable group id, also used as a keybinding anchor by the TUI.
    pub id: String,
    /// Group heading.
    pub title: String,
    /// Optional helper line.
    pub description: Option<String>,
    /// `fieldIds`, in order.
    pub field_ids: Vec<String>,
}

/// A single field of a definition.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldDefinition {
    /// `id`.
    pub id: String,
    /// `label`.
    pub label: String,
    /// `description`.
    pub description: Option<String>,
    /// `kind`.
    pub kind: FieldKind,
    /// `role: "action"` — the field that selects the node's action, if any.
    pub is_action_selector: bool,
    /// `options`.
    pub options: Vec<FieldOption>,
    /// `placeholder`.
    pub placeholder: Option<String>,
    /// Preferred editor height for `multiline`/`path-list`.
    pub lines: Option<u32>,
    /// Number bounds.
    pub range: Option<FieldRange>,
    /// The declared default, which is also the value a CLI uses when the flag is absent.
    pub default: Option<Scalar>,
    /// `visibleWhen`.
    pub visible: Condition,
    /// `validate`; several rules may apply and are checked in order.
    pub rules: Vec<Rule>,
}

/// Everything a face needs to render one node, and nothing about how to render it.
#[derive(Debug, Clone, PartialEq)]
pub struct NodeDefinition {
    /// Definition language version, so a host can refuse a future shape instead of mis-reading it.
    /// `pluginApiVersion` is a different thing (ADR-0068 principle 8) and stays in the manifest.
    pub definition_version: u32,
    /// The node id — the plugin id in the rewritten stack.
    pub node_id: PluginId,
    /// Card and terminal heading.
    pub title: String,
    /// One-line summary; the long text lives in `help.ts` behind [`NodeAction::help_key`].
    pub description: String,
    /// The actions offered, in the order the TUI tab strip and the CLI subcommand list show them.
    pub actions: Vec<NodeAction>,
    /// Fields, in declaration order.
    pub fields: Vec<FieldDefinition>,
    /// `view.sections`: field groups, without geometry.
    pub groups: Vec<FieldGroup>,
    /// Field-to-input mapping.
    pub input_bindings: Vec<InputBinding>,
    /// The danger gate.
    pub danger: DangerGate,
    /// Prompt shown when the gate holds.
    pub danger_prompt: Option<DangerPrompt>,
    /// Plugin export producing the `preview(input) => string[]` lines.
    pub preview_export: Option<String>,
    /// Plugin export producing the `result(result) => {..}` view model.
    pub result_export: Option<String>,
    /// Whether the node reports progress events, which decides if a face draws a gauge at all.
    pub reports_progress: bool,
    /// Whether a successful run publishes an output path (`outputPath` in the result DTO).
    pub publishes_output_path: bool,
}

/// Why a definition is not self-consistent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DefinitionError {
    /// Two actions share an id.
    DuplicateActionId { action_id: String },
    /// No actions: a node with nothing to run is a build mistake, not an empty menu.
    NoActions,
    /// `actionIds` and the action-selector field's options disagree.
    ActionSelectorMismatch { field_id: String },
    /// Two fields share an id.
    DuplicateFieldId { field_id: String },
    /// A group or condition references a field the definition does not declare.
    UnknownFieldReference { referenced: String },
    /// A group references an action it does not declare.
    UnknownActionReference { referenced: String },
    /// A `select` field has no options.
    SelectWithoutOptions { field_id: String },
    /// A non-number field carries bounds.
    RangeOnNonNumberField { field_id: String },
    /// `min > max`.
    InvertedRange { field_id: String },
    /// A default whose type does not match the field kind.
    DefaultKindMismatch { field_id: String },
    /// A binding points at an undeclared field.
    BindingReferencesUnknownField { field_id: String },
    /// A `Custom` rule or plugin-export gate names nothing, which would silently drop the check.
    MissingExportName,
    /// The gate reads a field that is not declared.
    DangerReferencesUnknownField { field_id: String },
}

/// The current definition language version.
pub const DEFINITION_VERSION_V1: u32 = 1;

impl NodeDefinition {
    /// Check the invariants a face relies on.
    ///
    /// Every variant of [`DefinitionError`] is reachable from a real authoring mistake, and the checks
    /// are ordered so the first report is the one an author can act on.
    #[must_use]
    pub fn validate(&self) -> Result<(), DefinitionError> {
        if self.actions.is_empty() {
            return Err(DefinitionError::NoActions);
        }
        let mut action_ids: BTreeSet<String> = BTreeSet::new();
        for action in &self.actions {
            if !action_ids.insert(action.id.clone()) {
                return Err(DefinitionError::DuplicateActionId { action_id: action.id.clone() });
            }
        }

        let mut declared: BTreeSet<String> = BTreeSet::new();
        let mut selectors: Vec<&FieldDefinition> = Vec::new();
        for field in &self.fields {
            if !declared.insert(field.id.clone()) {
                return Err(DefinitionError::DuplicateFieldId { field_id: field.id.clone() });
            }
            if field.kind.carries_options() && field.options.is_empty() {
                return Err(DefinitionError::SelectWithoutOptions { field_id: field.id.clone() });
            }
            if !field.kind.carries_range() && field.range.is_some() {
                return Err(DefinitionError::RangeOnNonNumberField { field_id: field.id.clone() });
            }
            if let Some(range) = &field.range {
                if let (Some(min), Some(max)) = (range.min, range.max) {
                    if min > max {
                        return Err(DefinitionError::InvertedRange { field_id: field.id.clone() });
                    }
                }
            }
            if let Some(default) = &field.default {
                let matches_kind = match field.kind {
                    FieldKind::Number => matches!(default, Scalar::Number(_)),
                    FieldKind::Boolean => matches!(default, Scalar::Boolean(_)),
                    _ => matches!(default, Scalar::Text(_)),
                };
                if !matches_kind {
                    return Err(DefinitionError::DefaultKindMismatch { field_id: field.id.clone() });
                }
            }
            for rule in &field.rules {
                if let Rule::Custom { export_name } = rule {
                    if export_name.trim().is_empty() {
                        return Err(DefinitionError::MissingExportName);
                    }
                }
            }
            if field.is_action_selector {
                selectors.push(field);
            }
        }

        // Action selector, if declared, must offer exactly the declared actions.
        for selector in &selectors {
            let option_ids: BTreeSet<String> = selector
                .options
                .iter()
                .map(|option| option.value.display_text())
                .collect();
            if option_ids != action_ids {
                return Err(DefinitionError::ActionSelectorMismatch { field_id: selector.id.clone() });
            }
        }

        for field in &self.fields {
            let mut referenced = BTreeSet::new();
            field.visible.referenced_fields(&mut referenced);
            for reference in referenced {
                if !declared.contains(&reference) {
                    return Err(DefinitionError::UnknownFieldReference { referenced: reference });
                }
            }
        }

        for group in &self.groups {
            for field_id in &group.field_ids {
                if !declared.contains(field_id) {
                    return Err(DefinitionError::UnknownFieldReference { referenced: field_id.clone() });
                }
            }
        }

        for binding in &self.input_bindings {
            if !declared.contains(&binding.field_id) {
                return Err(DefinitionError::BindingReferencesUnknownField { field_id: binding.field_id.clone() });
            }
        }

        let mut danger_fields = BTreeSet::new();
        match &self.danger {
            DangerGate::None => {}
            DangerGate::ActionIn { action_field, dangerous } => {
                danger_fields.insert(action_field.clone());
                for action in dangerous {
                    if !action_ids.contains(action) {
                        return Err(DefinitionError::UnknownActionReference { referenced: action.clone() });
                    }
                }
            }
            DangerGate::FieldFlag { field_id, .. } => {
                danger_fields.insert(field_id.clone());
            }
            DangerGate::All(conditions) => {
                for condition in conditions {
                    condition.referenced_fields(&mut danger_fields);
                }
            }
            DangerGate::PluginExport { export_name } => {
                if export_name.trim().is_empty() {
                    return Err(DefinitionError::MissingExportName);
                }
            }
        }
        for field_id in danger_fields {
            if !declared.contains(&field_id) {
                return Err(DefinitionError::DangerReferencesUnknownField { field_id });
            }
        }

        for export in self.preview_export.iter().chain(self.result_export.iter()) {
            if export.trim().is_empty() {
                return Err(DefinitionError::MissingExportName);
            }
        }

        Ok(())
    }

    /// The field marked as the action selector, if the node has one.
    #[must_use]
    pub fn action_selector(&self) -> Option<&FieldDefinition> {
        self.fields.iter().find(|field| field.is_action_selector)
    }

    /// Default values a face starts from, keyed by field id.
    #[must_use]
    pub fn default_values(&self) -> Vec<(String, Scalar)> {
        self.fields
            .iter()
            .filter_map(|field| field.default.clone().map(|value| (field.id.clone(), value)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action(id: &str) -> NodeAction {
        NodeAction { id: id.to_owned(), label: id.to_owned(), help_key: format!("action.{id}") }
    }

    fn selector(actions: &[&str]) -> FieldDefinition {
        FieldDefinition {
            id: "action".to_owned(),
            label: "Action".to_owned(),
            description: None,
            kind: FieldKind::Select,
            is_action_selector: true,
            options: actions
                .iter()
                .map(|id| FieldOption {
                    value: Scalar::Text((*id).to_owned()),
                    label: (*id).to_owned(),
                    hint: None,
                    disabled: false,
                })
                .collect(),
            placeholder: None,
            lines: None,
            range: None,
            default: Some(Scalar::Text("scan".to_owned())),
            visible: Condition::Always,
            rules: vec![Rule::OneOfDeclaredOptions],
        }
    }

    /// The trename shape: `scan` / `import` / `validate` / `rename` / `undo` / `history`, a paths list
    /// visible only for `scan`, a `maxLines` number with the non-negative integer rule, and a live
    /// rename that must be confirmed.
    fn trename_like() -> NodeDefinition {
        let actions = ["scan", "import", "validate", "rename", "undo", "history"];
        NodeDefinition {
            definition_version: DEFINITION_VERSION_V1,
            node_id: PluginId::try_new("trename").expect("valid id"),
            title: "Trename".to_owned(),
            description: "中文路径转英文".to_owned(),
            actions: actions.iter().map(|id| action(id)).collect(),
            fields: vec![
                selector(&actions),
                FieldDefinition {
                    id: "paths".to_owned(),
                    label: "Folders".to_owned(),
                    description: Some("One folder per line".to_owned()),
                    kind: FieldKind::PathList,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: Some(4),
                    range: None,
                    default: Some(Scalar::Text(String::new())),
                    visible: Condition::ActionIs {
                        action_field: "action".to_owned(),
                        allowed: vec!["scan".to_owned()],
                    },
                    rules: vec![Rule::AtLeastLines { minimum: 1 }],
                },
                FieldDefinition {
                    id: "maxLines".to_owned(),
                    label: "Lines per segment".to_owned(),
                    description: None,
                    kind: FieldKind::Number,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: None,
                    range: Some(FieldRange { min: Some(0.0), max: None, step: 100.0 }),
                    default: Some(Scalar::Number(0.0)),
                    visible: Condition::ActionIs {
                        action_field: "action".to_owned(),
                        allowed: vec!["scan".to_owned()],
                    },
                    rules: vec![Rule::IntegerAtLeast { minimum: 0 }],
                },
                FieldDefinition {
                    id: "dryRun".to_owned(),
                    label: "Dry run".to_owned(),
                    description: Some("Turning this off moves files".to_owned()),
                    kind: FieldKind::Boolean,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: None,
                    range: None,
                    default: Some(Scalar::Boolean(true)),
                    visible: Condition::ActionIs {
                        action_field: "action".to_owned(),
                        allowed: vec!["rename".to_owned()],
                    },
                    rules: Vec::new(),
                },
                FieldDefinition {
                    id: "undoPath".to_owned(),
                    label: "Undo store".to_owned(),
                    description: None,
                    kind: FieldKind::Text,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: None,
                    range: None,
                    default: Some(Scalar::Text(String::new())),
                    visible: Condition::Any(vec![
                        Condition::ActionIs {
                            action_field: "action".to_owned(),
                            allowed: vec!["undo".to_owned()],
                        },
                        Condition::ActionIs {
                            action_field: "action".to_owned(),
                            allowed: vec!["history".to_owned()],
                        },
                    ]),
                    rules: Vec::new(),
                },
            ],
            groups: vec![
                FieldGroup {
                    id: "source".to_owned(),
                    title: "Source".to_owned(),
                    description: None,
                    field_ids: vec!["action".to_owned(), "paths".to_owned(), "maxLines".to_owned()],
                },
                FieldGroup {
                    id: "apply".to_owned(),
                    title: "Apply".to_owned(),
                    description: None,
                    field_ids: vec!["dryRun".to_owned(), "undoPath".to_owned()],
                },
            ],
            input_bindings: vec![
                InputBinding { field_id: "action".to_owned(), slot: "action".to_owned(), transform: Transform::Trim },
                InputBinding { field_id: "paths".to_owned(), slot: "paths".to_owned(), transform: Transform::Lines },
                InputBinding {
                    field_id: "maxLines".to_owned(),
                    slot: "maxLines".to_owned(),
                    transform: Transform::AsInteger,
                },
                InputBinding { field_id: "dryRun".to_owned(), slot: "dryRun".to_owned(), transform: Transform::Identity },
            ],
            danger: DangerGate::All(vec![
                Condition::ActionIs { action_field: "action".to_owned(), allowed: vec!["rename".to_owned()] },
                Condition::Not(Box::new(Condition::FieldTrue { field_id: "dryRun".to_owned() })),
            ]),
            danger_prompt: Some(DangerPrompt {
                title: "Confirm live rename".to_owned(),
                body: "Files will be moved.".to_owned(),
                confirm_label: "Move files".to_owned(),
            }),
            preview_export: Some("preview".to_owned()),
            result_export: Some("result_view".to_owned()),
            reports_progress: true,
            publishes_output_path: false,
        }
    }

    #[test]
    fn a_trename_shaped_definition_is_self_consistent() {
        let definition = trename_like();
        assert_eq!(definition.validate(), Ok(()));
        assert_eq!(definition.action_selector().expect("selector").id, "action");
        let defaults = definition.default_values();
        assert!(defaults.iter().any(|(id, value)| id == "dryRun" && value == &Scalar::Boolean(true)));
        // The scalar display form keeps integers readable in a field summary.
        assert_eq!(Scalar::Number(320.0).display_text(), "320");
        assert_eq!(Scalar::Number(1.5).display_text(), "1.5");
    }

    #[test]
    fn field_kinds_are_the_six_the_typescript_union_lists() {
        let wire: Vec<&str> = FieldKind::ALL.iter().map(FieldKind::as_str).collect();
        assert_eq!(wire, vec!["text", "multiline", "path-list", "number", "select", "boolean"]);
        for label in wire {
            assert_eq!(FieldKind::from_wire(label).map(|kind| kind.as_str()), Some(label));
        }
        assert_eq!(FieldKind::from_wire("dropdown"), None, "a kind the union lacks must not decode");
    }

    #[test]
    fn an_action_selector_must_offer_exactly_the_declared_actions() {
        let mut definition = trename_like();
        definition.actions.retain(|action| action.id != "history");
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::ActionSelectorMismatch { field_id: "action".to_owned() }),
            "dropping an action without dropping its option is a definition bug"
        );
    }

    #[test]
    fn conditions_groups_and_bindings_may_only_read_declared_fields() {
        let mut definition = trename_like();
        definition.fields[1].visible = Condition::FieldTrue { field_id: "ghost".to_owned() };
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::UnknownFieldReference { referenced: "ghost".to_owned() })
        );

        let mut definition = trename_like();
        definition.groups[0].field_ids.push("ghost".to_owned());
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::UnknownFieldReference { referenced: "ghost".to_owned() })
        );

        let mut definition = trename_like();
        definition.input_bindings.push(InputBinding {
            field_id: "ghost".to_owned(),
            slot: "x".to_owned(),
            transform: Transform::Identity,
        });
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::BindingReferencesUnknownField { field_id: "ghost".to_owned() })
        );

        let mut definition = trename_like();
        definition.danger = DangerGate::FieldFlag { field_id: "ghost".to_owned(), inverted: false };
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::DangerReferencesUnknownField { field_id: "ghost".to_owned() })
        );
    }

    #[test]
    fn type_and_range_mistakes_are_reported_per_field() {
        let mut definition = trename_like();
        definition.fields[2].default = Some(Scalar::Text("12".to_owned()));
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::DefaultKindMismatch { field_id: "maxLines".to_owned() })
        );

        let mut definition = trename_like();
        definition.fields[2].range = Some(FieldRange { min: Some(90.0), max: Some(10.0), step: 1.0 });
        assert_eq!(definition.validate(), Err(DefinitionError::InvertedRange { field_id: "maxLines".to_owned() }));

        let mut definition = trename_like();
        definition.fields[1].range = Some(FieldRange { min: None, max: None, step: 1.0 });
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::RangeOnNonNumberField { field_id: "paths".to_owned() }),
            "bounds belong to number fields; a path list has `lines`"
        );
    }

    #[test]
    fn escape_hatches_must_name_the_plugin_export() {
        let mut definition = trename_like();
        definition.fields[1].rules.push(Rule::Custom { export_name: "  ".to_owned() });
        assert_eq!(definition.validate(), Err(DefinitionError::MissingExportName));

        let mut definition = trename_like();
        definition.preview_export = Some(String::new());
        assert_eq!(definition.validate(), Err(DefinitionError::MissingExportName));

        let mut definition = trename_like();
        definition.danger = DangerGate::PluginExport { export_name: "is_dangerous".to_owned() };
        assert_eq!(definition.validate(), Ok(()), "a named export gate is legal");
    }

    #[test]
    fn an_empty_action_list_and_duplicate_ids_are_refused() {
        let mut definition = trename_like();
        definition.actions.clear();
        assert_eq!(definition.validate(), Err(DefinitionError::NoActions));

        let mut definition = trename_like();
        let clone = definition.fields[3].clone();
        definition.fields.push(clone);
        assert_eq!(definition.validate(), Err(DefinitionError::DuplicateFieldId { field_id: "dryRun".to_owned() }));
    }

    #[test]
    fn select_fields_must_offer_something() {
        let mut definition = trename_like();
        definition.fields[0].options.clear();
        assert_eq!(definition.validate(), Err(DefinitionError::SelectWithoutOptions { field_id: "action".to_owned() }));
    }

    /// The rest of the vocabulary — the conditions, rules and gates trename happens not to use — must
    /// also build and validate, otherwise a variant exists only on paper.
    #[test]
    fn the_other_condition_rule_and_gate_variants_validate_too() {
        let actions = ["convert", "apply"];
        let definition = NodeDefinition {
            definition_version: DEFINITION_VERSION_V1,
            node_id: PluginId::try_new("nameu").expect("valid id"),
            title: "Nameu".to_owned(),
            description: "批量命名".to_owned(),
            actions: actions.iter().map(|id| action(id)).collect(),
            fields: vec![
                selector(&actions),
                FieldDefinition {
                    id: "template".to_owned(),
                    label: "Template".to_owned(),
                    description: None,
                    kind: FieldKind::Text,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: Some("{n}".to_owned()),
                    lines: None,
                    range: None,
                    default: Some(Scalar::Text(String::new())),
                    visible: Condition::All(vec![
                        Condition::FieldFilled { field_id: "preview".to_owned() },
                        Condition::Not(Box::new(Condition::FieldEquals {
                            field_id: "action".to_owned(),
                            value: Scalar::Text("apply".to_owned()),
                        })),
                    ]),
                    rules: vec![Rule::Required, Rule::NonBlank],
                },
                FieldDefinition {
                    id: "limit".to_owned(),
                    label: "Limit".to_owned(),
                    description: None,
                    kind: FieldKind::Number,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: None,
                    range: Some(FieldRange { min: Some(1.0), max: Some(500.0), step: 1.0 }),
                    default: Some(Scalar::Number(50.0)),
                    visible: Condition::Always,
                    rules: vec![Rule::IntegerInRange],
                },
                FieldDefinition {
                    id: "preview".to_owned(),
                    label: "Preview".to_owned(),
                    description: None,
                    kind: FieldKind::Boolean,
                    is_action_selector: false,
                    options: Vec::new(),
                    placeholder: None,
                    lines: None,
                    range: None,
                    default: Some(Scalar::Boolean(true)),
                    visible: Condition::Always,
                    rules: Vec::new(),
                },
            ],
            groups: Vec::new(),
            input_bindings: vec![
                InputBinding { field_id: "template".to_owned(), slot: "template".to_owned(), transform: Transform::Trim },
                InputBinding { field_id: "limit".to_owned(), slot: "limit".to_owned(), transform: Transform::AsInteger },
                InputBinding {
                    field_id: "preview".to_owned(),
                    slot: "preview".to_owned(),
                    transform: Transform::AsBoolean,
                },
            ],
            danger: DangerGate::ActionIn {
                action_field: "action".to_owned(),
                dangerous: vec!["apply".to_owned()],
            },
            danger_prompt: Some(DangerPrompt {
                title: "Confirm".to_owned(),
                body: "Files will be renamed.".to_owned(),
                confirm_label: "Apply".to_owned(),
            }),
            preview_export: None,
            result_export: None,
            reports_progress: false,
            publishes_output_path: true,
        };
        assert_eq!(definition.validate(), Ok(()));
        assert_eq!(definition.groups, Vec::new(), "a node may declare no field groups at all");
        assert_eq!(
            definition
                .fields
                .iter()
                .find(|field| field.id == "limit")
                .expect("limit")
                .kind
                .carries_range(),
            true
        );
    }

    #[test]
    fn duplicate_action_ids_are_refused() {
        let mut definition = trename_like();
        definition.actions.push(action("scan"));
        assert_eq!(definition.validate(), Err(DefinitionError::DuplicateActionId { action_id: "scan".to_owned() }));
    }

    #[test]
    fn a_gate_naming_a_dangerous_action_that_is_not_declared_is_refused() {
        let mut definition = trename_like();
        definition.danger = DangerGate::ActionIn {
            action_field: "action".to_owned(),
            dangerous: vec!["delete-everything".to_owned()],
        };
        assert_eq!(
            definition.validate(),
            Err(DefinitionError::UnknownActionReference { referenced: "delete-everything".to_owned() })
        );
    }
}
