//! The node's shared interaction semantics — `packages/nodes/classq/src/interaction.ts`, as data and pure
//! functions rather than as closures inside one face.
//!
//! AGENTS.md keeps `TerminalInteractionSchema`'s shape (`fields`/`view`/`toInput`/`validate`/`preview`/
//! `isDangerous`/`dangerPrompt`/`result`) as the node's own contract: a face may decide *how* to draw it, never
//! *what* it means. So everything the TypeScript closure computed lives here as an exported pure function that the
//! CLI, the TUI and the GUI call identically (ADR-0069), and the strings are quoted, not reworded.
//!
//! Two things the published definition cannot carry and this module therefore does, both recorded in the port report:
//!
//! - `view.dashboard.display` (`interaction.ts:22`) is a closure over three fields and one conditional. The
//!   definition language's [`ValueSource`] has `Field`/`Literal`/`ActionLabel`/`FirstNonEmpty` and no join or
//!   conditional, so `node-definitions/classq.json` publishes no `dashboard` block at all. [`classq_dashboard`]
//!   keeps the content reachable instead of approximating it in a face.
//! - `toInput` (`interaction.ts:31`) *clamps* rather than rejects (`values.action === "classify" ? … : "plan"`),
//!   while the definition declares `rules: [{ type: "oneOfDeclaredOptions" }]` for `action`. Both are implemented:
//!   [`classq_input_from_field_values`] clamps like the TypeScript, and [`validate_declared_rules`] reports the rule
//!   violation a face must show before it binds.

use serde::{Deserialize, Serialize};

use crate::contract::{
    ClassqAction, ClassqExistingPolicy, ClassqRunResult, ClassqResultView, ClassqTransferMode,
};
use crate::input_normalization::{ClassqDryRun, ClassqInput, ClassqPathList, NormalizedClassqInput, clean};

/// The prompt language. `interaction.ts:9` defaults to `"zh"`, so `ClassqLanguage::default()` does too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ClassqLanguage {
    /// Chinese copy.
    #[default]
    Zh,
    /// English copy.
    En,
}

impl ClassqLanguage {
    /// Reads `"zh"`/`"en"` (also `zh-CN`, which `help.ts:37` keys its dictionary on); anything else keeps the
    /// node's own default language.
    #[must_use]
    pub fn from_language_tag(tag: &str) -> Self {
        if tag.trim().to_ascii_lowercase().starts_with("en") { Self::En } else { Self::Zh }
    }

    /// The wire tag.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Zh => "zh",
            Self::En => "en",
        }
    }

    const fn zh(self, zh: &'static str, en: &'static str) -> &'static str {
        match self {
            Self::Zh => zh,
            Self::En => en,
        }
    }
}

/// The raw field answers a face holds (`ClassqInteractionValues`, `interaction.ts:5`). Text in, because a face
/// prompts for text.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClassqFieldValues {
    /// `action` field: `"plan"` or `"classify"`.
    pub action: String,
    /// `paths` field: the `path-list` text.
    pub paths: String,
    /// `keyword` field.
    pub keyword: String,
    /// `waitKeyword` field.
    pub wait_keyword: String,
    /// `transferMode` field.
    pub transfer_mode: String,
    /// `existingPolicy` field.
    pub existing_policy: String,
    /// `dryRun` field text, read by `Transform::AsBoolean`.
    pub dry_run: String,
}

/// `defaultClassqInteractionValues` (`interaction.ts:6`).
#[must_use]
pub fn default_classq_field_values() -> ClassqFieldValues {
    ClassqFieldValues {
        action: "plan".to_owned(),
        paths: String::new(),
        keyword: "already".to_owned(),
        wait_keyword: "wait".to_owned(),
        transfer_mode: "move".to_owned(),
        existing_policy: "merge".to_owned(),
        dry_run: "true".to_owned(),
    }
}

/// `classqInputFromInteractionValues` (`interaction.ts:31`): the field-to-input binding the published definition
/// declares as `inputBindings`, with the same clamping.
#[must_use]
pub fn classq_input_from_field_values(values: &ClassqFieldValues) -> ClassqInput {
    ClassqInput {
        action: Some(ClassqAction::from_field_text(&values.action)),
        paths: Some(ClassqPathList::Values(crate::input_normalization::split_delimited(&values.paths))),
        keyword: Some(non_blank_or_default(clean(Some(values.keyword.as_str())), "already")),
        wait_keyword: Some(non_blank_or_default(clean(Some(values.wait_keyword.as_str())), "wait")),
        transfer_mode: Some(ClassqTransferMode::from_field_text(&values.transfer_mode)),
        existing_policy: Some(ClassqExistingPolicy::from_field_text(&values.existing_policy)),
        dry_run: Some(ClassqDryRun::Flag(
            crate::input_normalization::ClassqDryRun::Text(values.dry_run.clone())
                .as_bool()
                .unwrap_or(true),
        )),
        ..ClassqInput::default()
    }
}

/// The localized message `validate` returns (`interaction.ts:24`): `None` means the input may run.
#[must_use]
pub fn validate_classq_input(input: &NormalizedClassqInput, language: ClassqLanguage) -> Option<&'static str> {
    if input.paths.is_empty() {
        return Some(language.zh("至少输入一个根目录。", "Enter at least one root directory."));
    }
    None
}

/// A violation of one rule the published definition declares.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClassqRuleViolation {
    /// The field id the rule belongs to.
    pub field_id: String,
    /// The rule type as published, so a face can point at the right control.
    pub rule: &'static str,
    /// Localized copy.
    pub message: String,
}

/// `node-definitions/classq.json` `fields[].rules`, evaluated over raw field text.
///
/// `action` declares `oneOfDeclaredOptions`; `paths` declares `atLeastLines` with `minimum: 1`; `keyword`,
/// `waitKeyword`, `transferMode`, `existingPolicy` and `dryRun` declare `rules: []` (their blank handling is the
/// `trimOrOmit` binding and the `interaction.ts:31` clamps, which is why [`classq_input_from_field_values`] never
/// leaves them empty).
#[must_use]
pub fn validate_declared_rules(values: &ClassqFieldValues, language: ClassqLanguage) -> Vec<ClassqRuleViolation> {
    let mut violations: Vec<ClassqRuleViolation> = Vec::new();
    let action = values.action.trim();
    if !action.is_empty() && !ClassqAction::ALL.iter().any(|candidate| candidate.as_str() == action) {
        violations.push(ClassqRuleViolation {
            field_id: "action".to_owned(),
            rule: "oneOfDeclaredOptions",
            message: language
                .zh("工作流必须是 plan 或 classify。", "Workflow must be one of the declared options: plan, classify.")
                .to_owned(),
        });
    }
    if crate::input_normalization::split_delimited(&values.paths).is_empty() {
        violations.push(ClassqRuleViolation {
            field_id: "paths".to_owned(),
            rule: "atLeastLines",
            message: language.zh("至少输入一个根目录。", "Enter at least one root directory.").to_owned(),
        });
    }
    violations
}

/// `isDangerous` (`interaction.ts:26`): `action === "classify" && dryRun === false`. The gate is evaluated on the
/// normalized input, where `dryRun` can never be `undefined` (`core.ts:89`), which is what makes this equal to the
/// published `danger` gate (`all[actionIs("classify"), not(fieldTrue("dryRun"))]`).
#[must_use]
pub const fn is_dangerous(input: &NormalizedClassqInput) -> bool {
    match (input.action, input.dry_run) {
        (ClassqAction::Classify, false) => true,
        _ => false,
    }
}

/// The confirmation copy (`dangerPrompt` in both `interaction.ts:27` and `definition.json` `dangerPrompt`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassqDangerPrompt {
    /// `title`.
    pub title: String,
    /// `body`.
    pub body: String,
    /// `confirmLabel`.
    pub confirm_label: String,
}

/// `dangerPrompt()` (`interaction.ts:27`), whose three strings are the definition's `dangerPrompt` verbatim.
#[must_use]
pub fn classq_danger_prompt(language: ClassqLanguage) -> ClassqDangerPrompt {
    ClassqDangerPrompt {
        title: language.zh("确认真实分类", "Confirm live classify").to_owned(),
        body: language
            .zh("将移动或复制所有就绪项；冲突项会保留为报告。", "Ready items will be transferred; conflicts remain reported.")
            .to_owned(),
        confirm_label: language.zh("确认分类", "Classify").to_owned(),
    }
}

/// `preview(input)` (`interaction.ts:25`), the `previewExport` document named by `definition.json`.
#[must_use]
pub fn classq_preview(input: &NormalizedClassqInput, language: ClassqLanguage) -> Vec<String> {
    vec![
        format!("{}: {} → {}", language.zh("规则", "Rule"), input.keyword, input.wait_keyword),
        format!("{}: {}", language.zh("根目录", "Roots"), input.paths.len()),
        input
            .dry_run
            .then(|| language.zh("安全预演", "Preview"))
            .unwrap_or_else(|| language.zh("真实移动/复制", "Live transfer"))
            .to_owned(),
    ]
}

/// `result(result)` (`interaction.ts:28`), the `resultExport` document named by `definition.json`.
#[must_use]
pub fn classq_result_view(result: &ClassqRunResult, language: ClassqLanguage) -> ClassqResultView {
    let lines = result
        .data
        .as_ref()
        .map(|data| {
            vec![
                format!("{}: {}", language.zh("关键词命中", "Keywords"), data.keyword_count),
                format!("{}: {}", language.zh("就绪", "Ready"), data.ready_count),
                format!("{}: {}", language.zh("冲突", "Conflicts"), data.conflict_count),
            ]
        })
        .unwrap_or_default();
    ClassqResultView { success: result.success, message: result.message.clone(), lines }
}

/// One `label: value` dashboard row (`interaction.ts:22`'s `metrics`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassqDashboardMetric {
    /// Row heading.
    pub label: String,
    /// Row value.
    pub value: String,
}

/// `view.dashboard` (`interaction.ts:22`), kept here because the definition language cannot express it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassqDashboard {
    /// `dashboard.title`.
    pub title: String,
    /// Which workflow is selected.
    pub primary: String,
    /// `"<keyword> → <waitKeyword>"`.
    pub secondary: String,
    /// The one safety row.
    pub metrics: Vec<ClassqDashboardMetric>,
}

/// `dashboard.display(values)` (`interaction.ts:22`).
#[must_use]
pub fn classq_dashboard(input: &NormalizedClassqInput, language: ClassqLanguage) -> ClassqDashboard {
    ClassqDashboard {
        title: language.zh("分类路由", "Routing").to_owned(),
        primary: match input.action {
            ClassqAction::Classify => language.zh("分类执行", "Classify"),
            ClassqAction::Plan => language.zh("扫描计划", "Plan"),
        }
        .to_owned(),
        secondary: format!("{} → {}", input.keyword, input.wait_keyword),
        metrics: vec![ClassqDashboardMetric {
            label: language.zh("安全", "Safety").to_owned(),
            value: if input.dry_run {
                language.zh("预演", "Preview")
            } else {
                language.zh("真实执行", "Live")
            }
            .to_owned(),
        }],
    }
}

fn non_blank_or_default(value: String, fallback: &str) -> String {
    if value.is_empty() { fallback.to_owned() } else { value }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input_normalization::normalize_classq_input;

    fn normalized(action: ClassqAction, dry_run: bool) -> NormalizedClassqInput {
        normalize_classq_input(&ClassqInput {
            action: Some(action),
            paths: Some(ClassqPathList::Values(vec!["/root".to_owned()])),
            dry_run: Some(ClassqDryRun::Flag(dry_run)),
            ..ClassqInput::default()
        })
    }

    #[test]
    fn the_binding_clamps_exactly_like_interaction_ts() {
        let values = ClassqFieldValues {
            action: "classify".into(),
            paths: "D:/a; D:/b\nD:/a".into(),
            keyword: "  ".into(),
            wait_keyword: "hold".into(),
            transfer_mode: "copy".into(),
            existing_policy: "nonsense".into(),
            dry_run: "false".into(),
        };
        let bound = classq_input_from_field_values(&values);
        let normalized = normalize_classq_input(&bound);
        assert_eq!(normalized.action, ClassqAction::Classify);
        assert_eq!(normalized.paths, vec!["D:/a", "D:/b"]);
        assert_eq!(normalized.keyword, "already");
        assert_eq!(normalized.wait_keyword, "hold");
        assert_eq!(normalized.transfer_mode, ClassqTransferMode::Copy);
        assert_eq!(normalized.existing_policy, ClassqExistingPolicy::Merge);
        assert!(!normalized.dry_run);
    }

    #[test]
    fn only_a_live_classify_is_dangerous() {
        assert!(!is_dangerous(&normalized(ClassqAction::Classify, true)));
        assert!(!is_dangerous(&normalized(ClassqAction::Plan, false)));
        // The one dangerous combination the node has.
        assert!(is_dangerous(&normalized(ClassqAction::Classify, false)));
    }

    #[test]
    fn the_declared_rules_reject_an_undeclared_action_and_an_empty_root_box() {
        let violations = validate_declared_rules(
            &ClassqFieldValues { action: "delete".into(), paths: "  ".into(), ..Default::default() },
            ClassqLanguage::En,
        );
        assert_eq!(violations.len(), 2);
        assert_eq!(violations[0].rule, "oneOfDeclaredOptions");
        assert_eq!(violations[1].rule, "atLeastLines");
        let clean_defaults = validate_declared_rules(
            &ClassqFieldValues { action: "plan".into(), paths: "/root".into(), ..Default::default() },
            ClassqLanguage::En,
        );
        assert!(clean_defaults.is_empty(), "{clean_defaults:?}");
    }

    #[test]
    fn preview_and_dashboard_quote_the_typescript_strings() {
        let input = normalized(ClassqAction::Classify, false);
        assert_eq!(
            classq_preview(&input, ClassqLanguage::Zh),
            vec!["规则: already → wait", "根目录: 1", "真实移动/复制"]
        );
        assert_eq!(classq_preview(&input, ClassqLanguage::En)[2], "Live transfer");
        let dashboard = classq_dashboard(&input, ClassqLanguage::En);
        assert_eq!(dashboard.primary, "Classify");
        assert_eq!(dashboard.secondary, "already → wait");
        assert_eq!(dashboard.metrics[0].label, "Safety");
        assert_eq!(dashboard.metrics[0].value, "Live");
    }
}
