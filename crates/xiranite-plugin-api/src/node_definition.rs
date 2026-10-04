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

/// Text a face must be able to show in either language.
///
/// Today every node writes these inline — `label: zh ? "扫描目录" : "Folders"`
/// (`packages/nodes/trename/src/interaction.ts:40`) — so a definition that carried one `String` would
/// silently delete a language. A record of both is WIT-expressible and keeps the node's authored copy
/// intact; which one renders is the face's choice, made once from the resolved terminal language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalizedText {
    /// Chinese copy, as authored.
    pub zh: String,
    /// English copy, as authored.
    pub en: String,
}

impl LocalizedText {
    /// Both strings, in the order the nodes write them.
    #[must_use]
    pub fn new(zh: impl Into<String>, en: impl Into<String>) -> Self {
        Self { zh: zh.into(), en: en.into() }
    }

    /// The copy for one language; anything but `"en"` selects Chinese, matching `resolveTerminalLanguage`'s
    /// default of `zh` in the current code.
    #[must_use]
    pub fn resolve(&self, language: &str) -> &str {
        if language == "en" { self.en.as_str() } else { self.zh.as_str() }
    }

    /// True when either side is blank, which a definition must not carry: it would render an empty label
    /// for half the users.
    #[must_use]
    pub fn has_blank_side(&self) -> bool {
        self.zh.trim().is_empty() || self.en.trim().is_empty()
    }
}

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
    pub label: LocalizedText,
    /// `hint`, optional secondary line.
    pub hint: Option<LocalizedText>,
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
    /// Keyboard and slider increment; absent when the node only bounds the value
    /// (gifu's number fields declare min/max without a step).
    pub step: Option<f64>,
}

/// A named action of the node: the `action` entry of today's `interaction.ts` field options.
#[derive(Debug, Clone, PartialEq)]
pub struct NodeAction {
    /// Stable id used by the CLI subcommand, the TUI tab and the `input.action` slot.
    pub id: String,
    /// Human label, as in `{ value: "scan", label: zh ? "⌕ 扫描" : "⌕ Scan" }`.
    pub label: LocalizedText,
    /// Key into the node's `help.ts` dictionary. Help text never drifts (ADR-0069), so the definition
    /// references it instead of restating it.
    pub help_key: String,
}

/// One test on the current values, without negation.
///
/// Kept deliberately flat: a WIT `variant` cannot contain itself, so a recursive
/// `Not(Box<Condition>)`/`All(Vec<Condition>)` shape would have to be re-encoded the day the adapter
/// changes, which is exactly what ADR-0068 forbids. Negation is therefore a flag on the test
/// (`Predicate::negated`), and composition stops at one level (`Condition::All`/`Any` of predicates) —
/// enough for every node transcribed so far, whose conditions are `actionIs(..)`, `not(actionIs(..))`
/// and `all[actionIs, not fieldTrue]`.
#[derive(Debug, Clone, PartialEq)]
pub enum Test {
    /// No constraint.
    Always,
    /// Never satisfied: the node keeps the field for its input shape but hides it from every face
    /// (`packages/nodes/cleanf/src/interaction.ts` writes `visibleWhen: () => false`).
    Never,
    /// `actionIs(..)`: the action field equals one of these ids.
    ActionIs { action_field: String, allowed: Vec<String> },
    /// A named field holds exactly this value.
    FieldEquals { field_id: String, value: Scalar },
    /// A named text field holds a non-empty value.
    FieldFilled { field_id: String },
    /// A named boolean field is set.
    FieldTrue { field_id: String },
    /// A named number field is at or above `minimum`.
    NumberAtLeast { field_id: String, minimum: f64 },
}

/// A test plus whether it is negated.
#[derive(Debug, Clone, PartialEq)]
pub struct Predicate {
    /// The test itself.
    pub test: Test,
    /// `true` means "this test does not hold".
    pub negated: bool,
}

impl Predicate {
    /// A positive test.
    #[must_use]
    pub fn holds(test: Test) -> Self {
        Self { test, negated: false }
    }

    /// A negated test, which is how `not(actionIs("status"))` is expressed.
    #[must_use]
    pub fn fails(test: Test) -> Self {
        Self { test, negated: true }
    }

    /// The field this predicate reads, for the reference check.
    pub fn referenced_field(&self) -> Option<String> {
        match &self.test {
            Test::Always | Test::Never => None,
            Test::ActionIs { action_field, .. } => Some(action_field.clone()),
            Test::FieldEquals { field_id, .. }
            | Test::FieldFilled { field_id }
            | Test::FieldTrue { field_id }
            | Test::NumberAtLeast { field_id, .. } => Some(field_id.clone()),
        }
    }
}

/// `visibleWhen` as data, one level deep.
#[derive(Debug, Clone, PartialEq)]
pub enum Condition {
    /// A single predicate, which covers most fields.
    Single(Predicate),
    /// Every predicate holds.
    All(Vec<Predicate>),
    /// At least one predicate holds.
    Any(Vec<Predicate>),
    /// Disjunctive normal form: an OR of ANDs, so `any_all[[a, b], [c]]` reads
    /// `(a and b) or c`.
    ///
    /// marku and migratef gate fields on exactly that shape, which `All`/`Any` of leaves cannot express.
    /// Nesting through lists is fine for WIT — a `variant` containing itself is not — so this stays
    /// convertible, unlike a recursive `Not(Box<Condition>)`.
    AnyAll(Vec<Vec<Predicate>>),
}

impl Condition {
    /// Refuse an empty compound: `all([])` is vacuously true and `any([])` vacuously false, so either one
    /// silently shows or hides every field while still reading as well-formed data.
    #[must_use]
    pub fn reject_empty(&self) -> Result<(), String> {
        match self {
            Self::Single(_) => Ok(()),
            Self::All(predicates) | Self::Any(predicates) if predicates.is_empty() => {
                Err("a compound condition needs at least one predicate".to_owned())
            }
            Self::All(_) | Self::Any(_) => Ok(()),
            Self::AnyAll(clauses) if clauses.is_empty() || clauses.iter().any(Vec::is_empty) => {
                Err("a normal form needs at least one non-empty clause".to_owned())
            }
            Self::AnyAll(_) => Ok(()),
        }
    }

    /// Fields this condition reads, for the structural check that it references only declared fields.
    pub fn referenced_fields(&self, into: &mut BTreeSet<String>) {
        let mut push = |predicate: &Predicate| {
            if let Some(field_id) = predicate.referenced_field() {
                into.insert(field_id);
            }
        };
        match self {
            Self::Single(predicate) => push(predicate),
            Self::All(predicates) | Self::Any(predicates) => {
                for predicate in predicates {
                    push(predicate);
                }
            }
            Self::AnyAll(clauses) => {
                for clause in clauses {
                    for predicate in clause {
                        push(predicate);
                    }
                }
            }
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
    /// A number at or above `minimum`, fractional bounds included — `positive` in
    /// `packages/nodes/bitv/src/interaction.ts:56` is `0.5`-stepped, not integer.
    NumberAtLeast { minimum: f64 },
    /// A number inside the field's [`FieldRange`], fractional bounds included.
    NumberInRange,
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
    /// Plugin export computing the effective value when the node's own defaulting rule depends on more
    /// than this field. Transq forces `preview` on for its `plan` action
    /// (`packages/nodes/transq/src/interaction.ts:15`: `preview: action === "plan" || v.preview !== false`),
    /// which is node behaviour, so it is declared as an export the host calls rather than restated in a
    /// face.
    pub default_export: Option<String>,
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
    /// Split on commas, semicolons or newlines, dropping blanks: the `list()` helper every keyword
    /// field uses (`packages/nodes/snf/src/interaction.ts` tail, nameu's `excludeKeywords`).
    Delimited,
    /// Trim, and omit the slot when nothing is left. `text()` in
    /// `packages/nodes/logx/src/interaction.ts:53` returns `undefined` for a blank field, and the
    /// difference between "no filter" and "empty filter" is load-bearing for a query node.
    TrimOrOmit,
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
    /// Compound: the gate holds when every listed predicate holds.
    All(Vec<Predicate>),
    /// Compound: the gate holds when any listed predicate holds — repacku's
    /// `dryRun === false || deleteAfter === true`
    /// (`packages/nodes/repacku/src/interaction.ts:74`) is exactly this, and without it the node has to
    /// push the decision into a plugin export for no reason.
    Any(Vec<Predicate>),
    /// The node computes it; name of the plugin export consulted.
    PluginExport { export_name: String },
}

/// The confirmation dialog's content, matching `dangerPrompt()`'s three strings
/// (`packages/nodes/trename/src/interaction.ts:75`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DangerPrompt {
    /// `title`.
    pub title: LocalizedText,
    /// `body`.
    pub body: LocalizedText,
    /// `confirmLabel`.
    pub confirm_label: LocalizedText,
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
    pub title: LocalizedText,
    /// Optional helper line.
    pub description: Option<LocalizedText>,
    /// `fieldIds`, in order.
    pub field_ids: Vec<String>,
}

/// A rule together with the condition that makes it apply.
///
/// Several nodes validate cross-field: transq requires roots except for its `status` action
/// (`packages/nodes/transq/src/interaction.ts:9`), and trename requires `jsonContent` only for
/// `import`/`validate`/`rename` (`packages/nodes/trename/src/interaction.ts:64`). That is declarable — a
/// rule plus the condition it holds under — so it does not have to become a plugin export.
#[derive(Debug, Clone, PartialEq)]
pub struct GuardedRule {
    /// The check itself.
    pub rule: Rule,
    /// The message this rule shows when it fails, in both languages. Nodes author these inline
    /// (`"需要 Rename JSON。" / "Rename JSON is required."`), and the copy is node content, so it travels
    /// with the definition instead of being re-invented by each face.
    pub message: Option<LocalizedText>,
    /// When the check applies; `None` means always.
    pub when: Option<Condition>,
}

impl GuardedRule {
    /// An unconditional rule.
    #[must_use]
    pub const fn always(rule: Rule) -> Self {
        Self { rule, message: None, when: None }
    }

    /// A rule that applies only while `when` holds.
    #[must_use]
    pub fn only(rule: Rule, when: Condition) -> Self {
        Self { rule, message: None, when: Some(when) }
    }
}

/// What the status area shows for one value: `TerminalViewDisplay`'s `primary`/`secondary`
/// (`packages/cli-runtime/src/interaction.ts:48-53`) computed by a closure today.
///
/// Every node reads one of three things: a field's current value, a fixed string, or the label of the
/// selected action. Declaring it keeps the dashboard's content in the shared vocabulary while the face
/// still decides where to draw it.
#[derive(Debug, Clone, PartialEq)]
pub enum ValueSource {
    /// The field's current value, formatted by the face.
    Field { field_id: String },
    /// Fixed authored copy.
    Literal(LocalizedText),
    /// The label of the action the action selector currently holds.
    ActionLabel,
    /// The first of these fields that holds a non-empty value, else `fallback`.
    ///
    /// logx's dashboard secondary is `values.search || values.scope || values.minimumSeverity || "info"`
    /// (`packages/nodes/logx/src/interaction.ts:48`); a list of field ids plus one literal keeps that
    /// flat and therefore WIT-expressible.
    FirstNonEmpty { field_ids: Vec<String>, fallback_text: LocalizedText },
}

impl ValueSource {
    /// Fields this source reads, so the reference check covers `FirstNonEmpty` too.
    pub fn referenced_fields(&self, into: &mut BTreeSet<String>) {
        if let Self::Field { field_id } = self {
            into.insert(field_id.clone());
        }
        if let Self::FirstNonEmpty { field_ids, .. } = self {
            for field_id in field_ids {
                into.insert(field_id.clone());
            }
        }
    }
}

/// One `label: value` pair under the dashboard heading: `TerminalViewMetric`
/// (`packages/cli-runtime/src/interaction.ts:43-46`).
#[derive(Debug, Clone, PartialEq)]
pub struct DashboardMetric {
    /// Row heading.
    pub label: LocalizedText,
    /// Where the value comes from.
    pub source: ValueSource,
}

/// The dashboard content, without geometry: `TerminalInteractionView.dashboard`
/// (`packages/cli-runtime/src/interaction.ts:71-78`).
#[derive(Debug, Clone, PartialEq)]
pub struct DashboardSpec {
    /// Panel heading.
    pub title: LocalizedText,
    /// Optional subheading.
    pub description: Option<LocalizedText>,
    /// `primary`.
    pub primary: ValueSource,
    /// `secondary`.
    pub secondary: Option<ValueSource>,
    /// `metrics`.
    pub metrics: Vec<DashboardMetric>,
}

/// A column of the result table: `TerminalViewTableColumn`
/// (`packages/cli-runtime/src/interaction.ts:55-60`). `width` is a hint, not a layout — the TUI may
/// ignore it, the Web table may honour it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResultColumn {
    /// Stable column id, also the row map key.
    pub id: String,
    /// Header copy.
    pub label: LocalizedText,
    /// Preferred width in cells.
    pub width: Option<u32>,
}

/// The shape of `result(result).table`: columns plus the empty-state line, so a face renders results
/// without inventing column names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResultTableSpec {
    /// Columns, in order.
    pub columns: Vec<ResultColumn>,
    /// `emptyMessage`.
    pub empty_message: Option<LocalizedText>,
}

/// A single field of a definition.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldDefinition {
    /// `id`.
    pub id: String,
    /// `label`.
    pub label: LocalizedText,
    /// `description`.
    pub description: Option<LocalizedText>,
    /// `kind`.
    pub kind: FieldKind,
    /// `role: "action"` — the field that selects the node's action, if any.
    pub is_action_selector: bool,
    /// `options`.
    pub options: Vec<FieldOption>,
    /// `placeholder`.
    pub placeholder: Option<LocalizedText>,
    /// Preferred editor height for `multiline`/`path-list`.
    pub lines: Option<u32>,
    /// Number bounds.
    pub range: Option<FieldRange>,
    /// The declared default, which is also the value a CLI uses when the flag is absent.
    pub default: Option<Scalar>,
    /// `visibleWhen`.
    pub visible: Condition,
    /// `validate`; several rules may apply and are checked in order.
    pub rules: Vec<GuardedRule>,
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
    pub title: LocalizedText,
    /// One-line summary; the long text lives in `help.ts` behind [`NodeAction::help_key`].
    pub description: LocalizedText,
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
    /// Prompt shown when the gate holds, when its text is fixed.
    pub danger_prompt: Option<DangerPrompt>,
    /// Plugin export producing the prompt, for nodes whose confirmation text depends on the action:
    /// enginev's body changes with `permanent` + `delete`, mvz's title with `extract`, and bitv's body
    /// interpolates the mode. Mutually exclusive with [`NodeDefinition::danger_prompt`].
    pub danger_prompt_export: Option<String>,
    /// Plugin export producing the `preview(input) => string[]` lines.
    pub preview_export: Option<String>,
    /// Plugin export producing the `result(result) => {..}` view model.
    pub result_export: Option<String>,
    /// Whether the node reports progress events, which decides if a face draws a gauge at all.
    pub reports_progress: bool,
    /// Whether a successful run publishes an output path (`outputPath` in the result DTO).
    pub publishes_output_path: bool,
    /// The status area's content. Absent means the face shows only the result message.
    pub dashboard: Option<DashboardSpec>,
    /// Columns the `resultExport` view model is expected to fill.
    pub result_table: Option<ResultTableSpec>,
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
    /// Some authored copy has an empty side, which would render a blank label for half the users.
    IncompleteLocalization { owner: String },
    /// Two result columns share an id, which would make a row map collide.
    DuplicateColumnId { column_id: String },
    /// A result table was declared with no columns.
    EmptyResultTable,
    /// Both a fixed prompt and a prompt export were declared, so the face cannot pick one.
    ContradictoryDangerPrompt,
    /// A compound condition or gate was declared with nothing in it. An empty `all` is vacuously true and
    /// an empty `any` vacuously false, so such a node hides or shows everything by accident.
    EmptyCondition { owner: String },
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
            for guarded in &field.rules {
                if let Some(message) = &guarded.message {
                    if message.has_blank_side() {
                        return Err(DefinitionError::IncompleteLocalization {
                            owner: format!("field.{}.rule.message", field.id),
                        });
                    }
                }
                if let Rule::Custom { export_name } = &guarded.rule {
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
            if let Err(reason) = field.visible.reject_empty() {
                return Err(DefinitionError::EmptyCondition { owner: format!("{}.visible: {reason}", field.id) });
            }
            let mut referenced = BTreeSet::new();
            field.visible.referenced_fields(&mut referenced);
            for (index, guarded) in field.rules.iter().enumerate() {
                if let Some(when) = &guarded.when {
                    when.referenced_fields(&mut referenced);
                    if let Err(reason) = when.reject_empty() {
                        return Err(DefinitionError::EmptyCondition {
                            owner: format!("{}.rules[{}].when: {reason}", field.id, index),
                        });
                    }
                }
            }
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
            if binding.default_export.as_deref().is_some_and(|name| name.trim().is_empty()) {
                return Err(DefinitionError::MissingExportName);
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
            DangerGate::All(predicates) | DangerGate::Any(predicates) => {
                if predicates.is_empty() {
                    return Err(DefinitionError::EmptyCondition { owner: "danger".to_owned() });
                }
                for predicate in predicates {
                    if let Some(field_id) = predicate.referenced_field() {
                        danger_fields.insert(field_id);
                    }
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

        if let Some(dashboard) = &self.dashboard {
            let mut sources = vec![&dashboard.primary];
            sources.extend(dashboard.secondary.iter());
            for metric in &dashboard.metrics {
                sources.push(&metric.source);
            }
            for source in sources {
                let mut referenced = BTreeSet::new();
                source.referenced_fields(&mut referenced);
                for field_id in referenced {
                    if !declared.contains(&field_id) {
                        return Err(DefinitionError::UnknownFieldReference { referenced: field_id });
                    }
                }
            }
        }
        if let Some(table) = &self.result_table {
            let mut ids: BTreeSet<String> = BTreeSet::new();
            for column in &table.columns {
                if !ids.insert(column.id.clone()) {
                    return Err(DefinitionError::DuplicateColumnId { column_id: column.id.clone() });
                }
            }
            if table.columns.is_empty() {
                return Err(DefinitionError::EmptyResultTable);
            }
        }

        for export in self.preview_export.iter().chain(self.result_export.iter()) {
            if export.trim().is_empty() {
                return Err(DefinitionError::MissingExportName);
            }
        }

        if self.danger_prompt.is_some() && self.danger_prompt_export.is_some() {
            return Err(DefinitionError::ContradictoryDangerPrompt);
        }
        if self.danger_prompt_export.as_deref().is_some_and(|name| name.trim().is_empty()) {
            return Err(DefinitionError::MissingExportName);
        }

        for owner in self.unlocalized_owners() {
            return Err(DefinitionError::IncompleteLocalization { owner });
        }

        Ok(())
    }

    /// Owners whose authored copy has an empty side, in reading order.
    ///
    /// Every node writes both languages inline (`label: zh ? "扫描" : "Scan"`), so a blank side is a
    /// transcription mistake made while moving a node's vocabulary into a definition file, and it only
    /// shows up for users of that language.
    #[must_use]
    pub fn unlocalized_owners(&self) -> Vec<String> {
        let mut problems = Vec::new();
        let mut check = |owner: String, text: &LocalizedText| {
            if text.has_blank_side() {
                problems.push(owner);
            }
        };
        check("title".to_owned(), &self.title);
        check("description".to_owned(), &self.description);
        for action in &self.actions {
            check(format!("action.{}", action.id), &action.label);
        }
        for field in &self.fields {
            check(format!("field.{}.label", field.id), &field.label);
            if let Some(description) = &field.description {
                check(format!("field.{}.description", field.id), description);
            }
            if let Some(placeholder) = &field.placeholder {
                check(format!("field.{}.placeholder", field.id), placeholder);
            }
            for option in &field.options {
                check(format!("field.{}.option.{}", field.id, option.value.display_text()), &option.label);
                if let Some(hint) = &option.hint {
                    check(format!("field.{}.option.{}.hint", field.id, option.value.display_text()), hint);
                }
            }
        }
        for group in &self.groups {
            check(format!("group.{}.title", group.id), &group.title);
            if let Some(description) = &group.description {
                check(format!("group.{}.description", group.id), description);
            }
        }
        if let Some(dashboard) = &self.dashboard {
            check("dashboard.title".to_owned(), &dashboard.title);
            if let Some(description) = &dashboard.description {
                check("dashboard.description".to_owned(), description);
            }
            for (index, metric) in dashboard.metrics.iter().enumerate() {
                check(format!("dashboard.metrics[{index}].label"), &metric.label);
            }
            let mut sources = vec![("dashboard.primary".to_owned(), &dashboard.primary)];
            if let Some(secondary) = &dashboard.secondary {
                sources.push(("dashboard.secondary".to_owned(), secondary));
            }
            for (index, metric) in dashboard.metrics.iter().enumerate() {
                sources.push((format!("dashboard.metrics[{index}].value"), &metric.source));
            }
            for (owner, source) in sources {
                match source {
                    ValueSource::Literal(text) | ValueSource::FirstNonEmpty { fallback_text: text, .. } => {
                        check(owner, text);
                    }
                    ValueSource::Field { .. } | ValueSource::ActionLabel => {}
                }
            }
        }
        if let Some(table) = &self.result_table {
            for column in &table.columns {
                check(format!("resultTable.column.{}", column.id), &column.label);
            }
            if let Some(empty_message) = &table.empty_message {
                check("resultTable.emptyMessage".to_owned(), empty_message);
            }
        }
        if let Some(prompt) = &self.danger_prompt {
            check("dangerPrompt.title".to_owned(), &prompt.title);
            check("dangerPrompt.body".to_owned(), &prompt.body);
            check("dangerPrompt.confirmLabel".to_owned(), &prompt.confirm_label);
        }
        problems
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
#[path = "node_definition/tests.rs"]
mod tests;
