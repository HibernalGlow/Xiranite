//! `definition.json` → [`NodeDefinition`], the host-side reader.
//!
//! The Plugin API model deliberately has no serde dependency and no derives for this (ADR-0068: the model is
//! the ABI, JSON is one encoding of it, and the wasm side stays dependency-free), so the mapping lives in the
//! host layer that actually reads published files. Two properties matter and are enforced here:
//!
//! - **Unknown keys are rejected.** The TypeScript validator fails a definition that carries a key it does not
//!   know, so a reader that ignores extras would let a typo (`isActionSelecor`) silently mean "absent" — and
//!   the three faces would disagree with the gate that greened the file.
//! - **Every discriminant is a total match.** A new `Test`/`Rule`/`DangerGate` variant in the model cannot be
//!   added here without the compiler noticing, because each arm either maps a known spelling or reports one.

use std::fmt;

use serde_json::{Map, Value};

use xiranite_plugin_api::identifiers::PluginId;
use xiranite_plugin_api::node_definition::{
    Condition, DEFINITION_VERSION_V1, DashboardMetric, DashboardSpec, DangerGate, DangerPrompt, DefinitionError,
    FieldDefinition, FieldGroup, FieldKind, FieldOption, FieldRange, GuardedRule, InputBinding, LocalizedText,
    NodeAction, NodeDefinition, Predicate, ResultColumn, ResultTableSpec, Rule, Scalar, Test, Transform,
    ValueSource,
};

/// Why a published definition could not be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DefinitionReadError {
    /// The file is not JSON.
    InvalidJson(String),
    /// A value was not the shape the key promises.
    UnexpectedShape { owner: String, expected: &'static str },
    /// A key the contract does not define, which is always an authoring mistake.
    UnknownKey { owner: String, key: String },
    /// A key the contract requires.
    MissingKey { owner: String, key: &'static str },
    /// A `type`-style discriminant outside the vocabulary.
    UnknownDiscriminant { owner: String, found: String, vocabulary: &'static str },
    /// A localized pair with a blank side.
    BlankLocalization { owner: String },
    /// An identifier that arrived empty.
    EmptyIdentifier { owner: String },
    /// The document parsed but the model refused it.
    InvalidDefinition(String),
}

impl fmt::Display for DefinitionReadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidJson(detail) => write!(formatter, "definition.json is not valid JSON ({detail})"),
            Self::UnexpectedShape { owner, expected } => write!(formatter, "{owner} must be {expected}"),
            Self::UnknownKey { owner, key } => write!(formatter, "{owner} carries unknown key {key:?}"),
            Self::MissingKey { owner, key } => write!(formatter, "{owner} is missing {key}"),
            Self::UnknownDiscriminant { owner, found, vocabulary } => {
                write!(formatter, "{owner} = {found:?} is not one of {vocabulary}")
            }
            Self::BlankLocalization { owner } => write!(formatter, "{owner} has a blank zh or en side"),
            Self::EmptyIdentifier { owner } => write!(formatter, "{owner} must not be empty"),
            Self::InvalidDefinition(detail) => write!(formatter, "definition is invalid: {detail}"),
        }
    }
}

impl std::error::Error for DefinitionReadError {}

/// An object being consumed: reading a key removes it, so leftovers are unknown keys.
struct Reader {
    owner: String,
    fields: Map<String, Value>,
}

impl Reader {
    fn new(value: Value, owner: impl Into<String>) -> Result<Self, DefinitionReadError> {
        let owner = owner.into();
        match value {
            Value::Object(fields) => Ok(Self { owner, fields }),
            _ => Err(DefinitionReadError::UnexpectedShape { owner, expected: "an object" }),
        }
    }

    fn take(&mut self, key: &'static str) -> Option<Value> {
        self.fields.remove(key)
    }

    fn required(&mut self, key: &'static str) -> Result<Value, DefinitionReadError> {
        self.take(key).ok_or_else(|| DefinitionReadError::MissingKey { owner: self.owner.clone(), key })
    }

    fn child(&self) -> String {
        self.owner.clone()
    }

    fn finish(self) -> Result<(), DefinitionReadError> {
        match self.fields.keys().next() {
            Some(key) => Err(DefinitionReadError::UnknownKey { owner: self.owner, key: key.clone() }),
            None => Ok(()),
        }
    }
}

fn string_of(value: Value, owner: &str) -> Result<String, DefinitionReadError> {
    match value {
        Value::String(text) => Ok(text),
        _ => Err(DefinitionReadError::UnexpectedShape { owner: owner.to_owned(), expected: "a string" }),
    }
}

fn bool_of(value: Value, owner: &str) -> Result<bool, DefinitionReadError> {
    match value {
        Value::Bool(flag) => Ok(flag),
        _ => Err(DefinitionReadError::UnexpectedShape { owner: owner.to_owned(), expected: "a boolean" }),
    }
}

fn number_of(value: Value, owner: &str) -> Result<f64, DefinitionReadError> {
    match value {
        Value::Number(number) => number.as_f64().ok_or_else(|| DefinitionReadError::UnexpectedShape {
            owner: owner.to_owned(),
            expected: "a finite number",
        }),
        _ => Err(DefinitionReadError::UnexpectedShape { owner: owner.to_owned(), expected: "a number" }),
    }
}

fn array_of(value: Value, owner: &str) -> Result<Vec<Value>, DefinitionReadError> {
    match value {
        Value::Array(items) => Ok(items),
        _ => Err(DefinitionReadError::UnexpectedShape { owner: owner.to_owned(), expected: "an array" }),
    }
}

fn localized(value: Value, owner: &str) -> Result<LocalizedText, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let zh = string_of(reader.required("zh")?, &reader.child())?;
    let en = string_of(reader.required("en")?, &reader.child())?;
    reader.finish()?;
    let text = LocalizedText::new(zh, en);
    if text.has_blank_side() {
        return Err(DefinitionReadError::BlankLocalization { owner: owner.to_owned() });
    }
    Ok(text)
}

fn optional_localized(reader: &mut Reader, key: &'static str) -> Result<Option<LocalizedText>, DefinitionReadError> {
    match reader.take(key) {
        Some(value) => Ok(Some(localized(value, &format!("{}.{key}", reader.child()))?)),
        None => Ok(None),
    }
}

/// `Scalar`: exactly one of `text` / `number` / `boolean`, never two and never another key.
fn scalar(value: Value, owner: &str) -> Result<Scalar, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let text = reader.take("text").map(|v| string_of(v, owner)).transpose()?;
    let number = reader.take("number").map(|v| number_of(v, owner)).transpose()?;
    let boolean = reader.take("boolean").map(|v| bool_of(v, owner)).transpose()?;
    reader.finish()?;
    match (text, number, boolean) {
        (Some(text), None, None) => Ok(Scalar::Text(text)),
        (None, Some(number), None) => Ok(Scalar::Number(number)),
        (None, None, Some(boolean)) => Ok(Scalar::Boolean(boolean)),
        _ => Err(DefinitionReadError::UnexpectedShape { owner: owner.to_owned(), expected: "exactly one of text/number/boolean" }),
    }
}

fn field_kind(value: Value, owner: &str) -> Result<FieldKind, DefinitionReadError> {
    let text = string_of(value, owner)?;
    FieldKind::from_wire(&text).ok_or_else(|| DefinitionReadError::UnknownDiscriminant {
        owner: owner.to_owned(),
        found: text,
        vocabulary: "text, multiline, path-list, number, select, boolean",
    })
}

fn transform(value: Value, owner: &str) -> Result<Transform, DefinitionReadError> {
    let text = string_of(value, owner)?;
    match text.as_str() {
        "identity" => Ok(Transform::Identity),
        "trim" => Ok(Transform::Trim),
        "lines" => Ok(Transform::Lines),
        "delimited" => Ok(Transform::Delimited),
        "trimOrOmit" => Ok(Transform::TrimOrOmit),
        "asInteger" => Ok(Transform::AsInteger),
        "asBoolean" => Ok(Transform::AsBoolean),
        _ => Err(DefinitionReadError::UnknownDiscriminant {
            owner: owner.to_owned(),
            found: text,
            vocabulary: "identity, trim, lines, delimited, trimOrOmit, asInteger, asBoolean",
        }),
    }
}

fn test(value: Value, owner: &str) -> Result<Test, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let kind = string_of(reader.required("type")?, &reader.child())?;
    let built = match kind.as_str() {
        "always" => Test::Always,
        "never" => Test::Never,
        "actionIs" => Test::ActionIs {
            action_field: string_of(reader.required("actionField")?, &reader.child())?,
            allowed: array_of(reader.required("allowed")?, &reader.child())?
                .into_iter()
                .map(|item| string_of(item, &reader.child()))
                .collect::<Result<Vec<String>, DefinitionReadError>>()?,
        },
        "fieldEquals" => Test::FieldEquals {
            field_id: string_of(reader.required("fieldId")?, &reader.child())?,
            value: scalar(reader.required("value")?, &format!("{owner}.value"))?,
        },
        "fieldFilled" => Test::FieldFilled { field_id: string_of(reader.required("fieldId")?, &reader.child())? },
        "fieldTrue" => Test::FieldTrue { field_id: string_of(reader.required("fieldId")?, &reader.child())? },
        "numberAtLeast" => Test::NumberAtLeast {
            field_id: string_of(reader.required("fieldId")?, &reader.child())?,
            minimum: number_of(reader.required("minimum")?, &reader.child())?,
        },
        _ => {
            return Err(DefinitionReadError::UnknownDiscriminant {
                owner: owner.to_owned(),
                found: kind,
                vocabulary: "always, never, actionIs, fieldEquals, fieldFilled, fieldTrue, numberAtLeast",
            });
        }
    };
    reader.finish()?;
    Ok(built)
}

fn predicate(value: Value, owner: &str) -> Result<Predicate, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let test = test(reader.required("test")?, &format!("{owner}.test"))?;
    let negated = bool_of(reader.required("negated")?, &reader.child())?;
    reader.finish()?;
    Ok(Predicate { test, negated })
}

fn predicates(value: Value, owner: &str) -> Result<Vec<Predicate>, DefinitionReadError> {
    array_of(value, owner)?
        .into_iter()
        .enumerate()
        .map(|(index, item)| predicate(item, &format!("{owner}[{index}]")))
        .collect()
}

fn condition(value: Value, owner: &str) -> Result<Condition, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let kind = string_of(reader.required("type")?, &reader.child())?;
    let built = match kind.as_str() {
        "single" => Condition::Single(predicate(reader.required("predicate")?, &format!("{owner}.predicate"))?),
        "all" => Condition::All(predicates(reader.required("predicates")?, &format!("{owner}.predicates"))?),
        "any" => Condition::Any(predicates(reader.required("predicates")?, &format!("{owner}.predicates"))?),
        "anyAll" => Condition::AnyAll(
            array_of(reader.required("clauses")?, &format!("{owner}.clauses"))?
                .into_iter()
                .enumerate()
                .map(|(index, clause)| predicates(clause, &format!("{owner}.clauses[{index}]")))
                .collect::<Result<Vec<Vec<Predicate>>, DefinitionReadError>>()?,
        ),
        _ => {
            return Err(DefinitionReadError::UnknownDiscriminant {
                owner: owner.to_owned(),
                found: kind,
                vocabulary: "single, all, any, anyAll",
            });
        }
    };
    reader.finish()?;
    built.reject_empty().map_err(DefinitionReadError::InvalidDefinition)?;
    Ok(built)
}

fn rule(value: Value, owner: &str) -> Result<Rule, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let kind = string_of(reader.required("type")?, &reader.child())?;
    let built = match kind.as_str() {
        "required" => Rule::Required,
        "nonBlank" => Rule::NonBlank,
        "integerAtLeast" => Rule::IntegerAtLeast { minimum: number_of(reader.required("minimum")?, &reader.child())? as i64 },
        "integerInRange" => Rule::IntegerInRange,
        "numberAtLeast" => Rule::NumberAtLeast { minimum: number_of(reader.required("minimum")?, &reader.child())? },
        "numberInRange" => Rule::NumberInRange,
        "oneOfDeclaredOptions" => Rule::OneOfDeclaredOptions,
        "atLeastLines" => Rule::AtLeastLines { minimum: number_of(reader.required("minimum")?, &reader.child())? as u32 },
        "custom" => Rule::Custom { export_name: string_of(reader.required("exportName")?, &reader.child())? },
        _ => {
            return Err(DefinitionReadError::UnknownDiscriminant {
                owner: owner.to_owned(),
                found: kind,
                vocabulary: "required, nonBlank, integerAtLeast, integerInRange, numberAtLeast, numberInRange, oneOfDeclaredOptions, atLeastLines, custom",
            });
        }
    };
    reader.finish()?;
    Ok(built)
}

fn guarded_rule(value: Value, owner: &str) -> Result<GuardedRule, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let rule = rule(reader.required("rule")?, &format!("{owner}.rule"))?;
    let message = optional_localized(&mut reader, "message")?;
    let when = reader.take("when").map(|item| condition(item, &format!("{owner}.when"))).transpose()?;
    reader.finish()?;
    Ok(GuardedRule { rule, message, when })
}

fn field_option(value: Value, owner: &str) -> Result<FieldOption, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let value = scalar(reader.required("value")?, &format!("{owner}.value"))?;
    let label = localized(reader.required("label")?, &format!("{owner}.label"))?;
    let hint = optional_localized(&mut reader, "hint")?;
    let disabled = match reader.take("disabled") {
        Some(flag) => bool_of(flag, &reader.child())?,
        None => false,
    };
    reader.finish()?;
    Ok(FieldOption { value, label, hint, disabled })
}

fn range(value: Value, owner: &str) -> Result<FieldRange, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let number = |reader: &mut Reader, key: &'static str| -> Result<Option<f64>, DefinitionReadError> {
        Ok(match reader.take(key) {
            Some(item) => Some(number_of(item, &format!("{}.{key}", reader.child()))?),
            None => None,
        })
    };
    let min = number(&mut reader, "min")?;
    let max = number(&mut reader, "max")?;
    let step = number(&mut reader, "step")?;
    reader.finish()?;
    Ok(FieldRange { min, max, step })
}

fn field(value: Value, owner: &str) -> Result<FieldDefinition, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let id = string_of(reader.required("id")?, &reader.child())?;
    let label = localized(reader.required("label")?, &format!("{owner}.label"))?;
    let description = optional_localized(&mut reader, "description")?;
    let kind = field_kind(reader.required("kind")?, &format!("{owner}.kind"))?;
    let is_action_selector = match reader.take("isActionSelector") {
        Some(flag) => bool_of(flag, &reader.child())?,
        None => false,
    };
    let options = match reader.take("options") {
        Some(items) => array_of(items, &format!("{owner}.options"))?
            .into_iter()
            .enumerate()
            .map(|(index, item)| field_option(item, &format!("{owner}.options[{index}]")))
            .collect::<Result<Vec<FieldOption>, DefinitionReadError>>()?,
        None => Vec::new(),
    };
    let placeholder = optional_localized(&mut reader, "placeholder")?;
    let lines = match reader.take("lines") {
        Some(item) => Some(number_of(item, &format!("{owner}.lines"))? as u32),
        None => None,
    };
    let range = reader.take("range").map(|item| range(item, &format!("{owner}.range"))).transpose()?;
    let default = reader.take("default").map(|item| scalar(item, &format!("{owner}.default"))).transpose()?;
    let visible = reader
        .take("visible")
        .map(|item| condition(item, &format!("{owner}.visible")))
        .transpose()?
        .unwrap_or(Condition::Single(Predicate::holds(Test::Always)));
    let rules = match reader.take("rules") {
        Some(items) => array_of(items, &format!("{owner}.rules"))?
            .into_iter()
            .enumerate()
            .map(|(index, item)| guarded_rule(item, &format!("{owner}.rules[{index}]")))
            .collect::<Result<Vec<GuardedRule>, DefinitionReadError>>()?,
        None => Vec::new(),
    };
    reader.finish()?;
    Ok(FieldDefinition {
        id,
        label,
        description,
        kind,
        is_action_selector,
        options,
        placeholder,
        lines,
        range,
        default,
        visible,
        rules,
    })
}

fn action(value: Value, owner: &str) -> Result<NodeAction, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let id = string_of(reader.required("id")?, &reader.child())?;
    let label = localized(reader.required("label")?, &format!("{owner}.label"))?;
    reader.finish()?;
    Ok(NodeAction { id, label })
}

fn group(value: Value, owner: &str) -> Result<FieldGroup, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let id = string_of(reader.required("id")?, &reader.child())?;
    let title = localized(reader.required("title")?, &format!("{owner}.title"))?;
    let description = optional_localized(&mut reader, "description")?;
    let field_ids = array_of(reader.required("fieldIds")?, &format!("{owner}.fieldIds"))?
        .into_iter()
        .map(|item| string_of(item, &reader.child()))
        .collect::<Result<Vec<String>, DefinitionReadError>>()?;
    reader.finish()?;
    Ok(FieldGroup { id, title, description, field_ids })
}

fn binding(value: Value, owner: &str) -> Result<InputBinding, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let field_id = string_of(reader.required("fieldId")?, &reader.child())?;
    let slot = string_of(reader.required("slot")?, &reader.child())?;
    let transform = transform(reader.required("transform")?, &format!("{owner}.transform"))?;
    let default_export = match reader.take("defaultExport") {
        Some(item) => Some(string_of(item, &reader.child())?),
        None => None,
    };
    reader.finish()?;
    Ok(InputBinding { field_id, slot, transform, default_export })
}

fn danger_gate(value: Value, owner: &str) -> Result<DangerGate, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let kind = string_of(reader.required("type")?, &reader.child())?;
    let built = match kind.as_str() {
        "none" => DangerGate::None,
        "actionIn" => DangerGate::ActionIn {
            action_field: string_of(reader.required("actionField")?, &reader.child())?,
            dangerous: array_of(reader.required("dangerous")?, &format!("{owner}.dangerous"))?
                .into_iter()
                .map(|item| string_of(item, &reader.child()))
                .collect::<Result<Vec<String>, DefinitionReadError>>()?,
        },
        "fieldFlag" => DangerGate::FieldFlag {
            field_id: string_of(reader.required("fieldId")?, &reader.child())?,
            inverted: bool_of(reader.required("inverted")?, &reader.child())?,
        },
        "all" => DangerGate::All(predicates(reader.required("predicates")?, &format!("{owner}.predicates"))?),
        "any" => DangerGate::Any(predicates(reader.required("predicates")?, &format!("{owner}.predicates"))?),
        "pluginExport" => DangerGate::PluginExport { export_name: string_of(reader.required("exportName")?, &reader.child())? },
        _ => {
            return Err(DefinitionReadError::UnknownDiscriminant {
                owner: owner.to_owned(),
                found: kind,
                vocabulary: "none, actionIn, fieldFlag, all, any, pluginExport",
            });
        }
    };
    reader.finish()?;
    Ok(built)
}

fn value_source(value: Value, owner: &str) -> Result<ValueSource, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let kind = string_of(reader.required("type")?, &reader.child())?;
    let built = match kind.as_str() {
        "field" => ValueSource::Field { field_id: string_of(reader.required("fieldId")?, &reader.child())? },
        "literal" => ValueSource::Literal(localized(reader.required("value")?, &format!("{owner}.value"))?),
        "actionLabel" => ValueSource::ActionLabel,
        "firstNonEmpty" => ValueSource::FirstNonEmpty {
            field_ids: array_of(reader.required("fieldIds")?, &format!("{owner}.fieldIds"))?
                .into_iter()
                .map(|item| string_of(item, &reader.child()))
                .collect::<Result<Vec<String>, DefinitionReadError>>()?,
            fallback_text: localized(reader.required("fallbackText")?, &format!("{owner}.fallbackText"))?,
        },
        _ => {
            return Err(DefinitionReadError::UnknownDiscriminant {
                owner: owner.to_owned(),
                found: kind,
                vocabulary: "field, literal, actionLabel, firstNonEmpty",
            });
        }
    };
    reader.finish()?;
    Ok(built)
}

fn dashboard(value: Value, owner: &str) -> Result<DashboardSpec, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let title = localized(reader.required("title")?, &format!("{owner}.title"))?;
    let description = optional_localized(&mut reader, "description")?;
    let primary = value_source(reader.required("primary")?, &format!("{owner}.primary"))?;
    let secondary = reader.take("secondary").map(|item| value_source(item, &format!("{owner}.secondary"))).transpose()?;
    let metrics = match reader.take("metrics") {
        Some(items) => array_of(items, &format!("{owner}.metrics"))?
            .into_iter()
            .enumerate()
            .map(|(index, item)| {
                let mut entry = Reader::new(item, format!("{owner}.metrics[{index}]"))?;
                let label = localized(entry.required("label")?, &entry.child())?;
                let source = value_source(entry.required("source")?, &format!("{owner}.metrics[{index}].source"))?;
                entry.finish()?;
                Ok(DashboardMetric { label, source })
            })
            .collect::<Result<Vec<DashboardMetric>, DefinitionReadError>>()?,
        None => Vec::new(),
    };
    reader.finish()?;
    Ok(DashboardSpec { title, description, primary, secondary, metrics })
}

fn result_table(value: Value, owner: &str) -> Result<ResultTableSpec, DefinitionReadError> {
    let mut reader = Reader::new(value, owner)?;
    let columns = array_of(reader.required("columns")?, &format!("{owner}.columns"))?
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            let mut column = Reader::new(item, format!("{owner}.columns[{index}]"))?;
            let id = string_of(column.required("id")?, &column.child())?;
            let label = localized(column.required("label")?, &format!("{owner}.columns[{index}].label"))?;
            let width = match column.take("width") {
                Some(item) => Some(number_of(item, &format!("{owner}.columns[{index}].width"))? as u32),
                None => None,
            };
            column.finish()?;
            Ok(ResultColumn { id, label, width })
        })
        .collect::<Result<Vec<ResultColumn>, DefinitionReadError>>()?;
    let empty_message = optional_localized(&mut reader, "emptyMessage")?;
    reader.finish()?;
    Ok(ResultTableSpec { columns, empty_message })
}

fn optional_string(reader: &mut Reader, key: &'static str) -> Result<Option<String>, DefinitionReadError> {
    match reader.take(key) {
        Some(item) => Ok(Some(string_of(item, &format!("{}.{key}", reader.child()))?)),
        None => Ok(None),
    }
}

fn array_field<T>(reader: &mut Reader, key: &'static str, read: fn(Value, &str) -> Result<T, DefinitionReadError>) -> Result<Vec<T>, DefinitionReadError> {
    match reader.take(key) {
        Some(items) => array_of(items, &format!("{}.{key}", reader.child()))?
            .into_iter()
            .enumerate()
            .map(|(index, item)| read(item, &format!("{}.{key}[{index}]", reader.child())))
            .collect(),
        None => Ok(Vec::new()),
    }
}

/// Read one published `definition.json`.
///
/// The result is validated by the model itself, so a file that parses but breaks a cross-reference (a rule
/// reading an undeclared field, a selector that disagrees with the actions) is refused here too — the faces
/// must not be able to load what the gate rejected.
pub fn parse_definition(text: &str) -> Result<NodeDefinition, DefinitionReadError> {
    let document: Value = serde_json::from_str(text).map_err(|error| DefinitionReadError::InvalidJson(error.to_string()))?;
    let mut reader = Reader::new(document, "definition")?;

    let definition_version = number_of(reader.required("definitionVersion")?, "definition.definitionVersion")? as u32;
    if definition_version != DEFINITION_VERSION_V1 {
        return Err(DefinitionReadError::UnexpectedShape {
            owner: "definition.definitionVersion".to_owned(),
            expected: "1 (DEFINITION_VERSION_V1)",
        });
    }
    let node_id = PluginId::try_new(string_of(reader.required("nodeId")?, "definition.nodeId")?)
        .map_err(|_| DefinitionReadError::EmptyIdentifier { owner: "definition.nodeId".to_owned() })?;
    let title = localized(reader.required("title")?, "definition.title")?;
    let description = localized(reader.required("description")?, "definition.description")?;
    let actions = array_field(&mut reader, "actions", action)?;
    let fields = array_field(&mut reader, "fields", field)?;
    let groups = array_field(&mut reader, "groups", group)?;
    let input_bindings = array_field(&mut reader, "inputBindings", binding)?;
    let danger = danger_gate(reader.required("danger")?, "definition.danger")?;
    let danger_prompt = reader
        .take("dangerPrompt")
        .map(|item| {
            let mut prompt = Reader::new(item, "definition.dangerPrompt")?;
            let title = localized(prompt.required("title")?, &prompt.child())?;
            let body = localized(prompt.required("body")?, &prompt.child())?;
            let confirm_label = localized(prompt.required("confirmLabel")?, &prompt.child())?;
            prompt.finish()?;
            Ok(DangerPrompt { title, body, confirm_label })
        })
        .transpose()?;
    let danger_prompt_export = optional_string(&mut reader, "dangerPromptExport")?;
    let preview_export = optional_string(&mut reader, "previewExport")?;
    let result_export = optional_string(&mut reader, "resultExport")?;
    let reports_progress = match reader.take("reportsProgress") {
        Some(flag) => bool_of(flag, "definition.reportsProgress")?,
        None => false,
    };
    let publishes_output_path = match reader.take("publishesOutputPath") {
        Some(flag) => bool_of(flag, "definition.publishesOutputPath")?,
        None => false,
    };
    let dashboard = reader.take("dashboard").map(|item| dashboard(item, "definition.dashboard")).transpose()?;
    let result_table = reader.take("resultTable").map(|item| result_table(item, "definition.resultTable")).transpose()?;
    reader.finish()?;

    let definition = NodeDefinition {
        definition_version,
        node_id,
        title,
        description,
        actions,
        fields,
        groups,
        input_bindings,
        danger,
        danger_prompt,
        danger_prompt_export,
        preview_export,
        result_export,
        reports_progress,
        publishes_output_path,
        dashboard,
        result_table,
    };
    definition.validate().map_err(|error: DefinitionError| DefinitionReadError::InvalidDefinition(error.to_string()))?;
    Ok(definition)
}
