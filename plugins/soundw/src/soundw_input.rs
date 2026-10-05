//! Input normalization and the declared validation rules, from `interaction.ts`.
//!
//! `interaction.ts:24` (`toInput`) and the two rules the published definition carries
//! (`node-definitions/soundw.json:165-171`, `:200-223`) are the whole of this module. They live
//! here rather than in `soundw_core` because they are the node's *data contract*: the CLI, the TUI
//! and the React card must all reach the same normalized input, which is ADR-0069's rule that the
//! vocabulary exists in exactly one place.
//!
//! | TypeScript / definition | Rust |
//! | --- | --- |
//! | `interaction.ts:16` `initialValues` (`action: "status"`, both texts `""`) | [`DEFAULT_ACTION`], [`NormalizedSoundwInput::default`] |
//! | `interaction.ts:24` `toInput`'s `String(v ?? "").trim() || undefined` | [`normalize_soundw_input`] via `js_trim` |
//! | `interaction.ts:20` action select options | [`SoundwAction::ALL`], [`declared_action_texts`] |
//! | `interaction.ts:21` `validate` + definition `nonBlank` (`:200-223`) | [`validate_soundw_input`] |
//! | definition `oneOfDeclaredOptions` (`:165-171`) | [`parse_action_text`] |

use crate::js_text::{js_trim, trimmed_or_none};
use crate::soundw_model::{SoundwAction, SoundwInput};

/// `interaction.ts:16`: the field defaults the faces start from, which is also the CLI's behaviour
/// when `--action`/the subcommand is absent (`core.ts:9` reads the same default).
pub const DEFAULT_ACTION: SoundwAction = SoundwAction::Status;
/// The field id the action selector uses (`node-definitions/soundw.json:72`).
pub const ACTION_FIELD_ID: &str = "action";
/// The profile-name field id (`node-definitions/soundw.json:174`).
pub const PROFILE_NAME_FIELD_ID: &str = "profileName";
/// The CLI path field id (`node-definitions/soundw.json:226`).
pub const SOUND_SWITCH_PATH_FIELD_ID: &str = "soundSwitchPath";
/// `interaction.ts:21` / `node-definitions/soundw.json:219-221`, the authored Chinese copy.
pub const PROFILE_NAME_REQUIRED_ZH: &str = "请输入预设名称。";
/// `interaction.ts:21` / `node-definitions/soundw.json:220`, the authored English copy.
pub const PROFILE_NAME_REQUIRED_EN: &str = "Enter a profile name.";

/// An input after the node's defaulting rules, the shape `interaction.ts:24` returns.
#[derive(Debug, Clone, PartialEq, Eq)]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NormalizedSoundwInput {
    /// The action, defaulted rather than optional: `toInput` always writes one.
    pub action: SoundwAction,
    /// Trimmed, and absent when nothing was left (`trimOrOmit`).
    pub profile_name: Option<String>,
    /// Trimmed, and absent when nothing was left (`trimOrOmit`).
    pub sound_switch_path: Option<String>,
}

impl Default for NormalizedSoundwInput {
    /// `interaction.ts:16` `initialValues`, which is also what an empty request means.
    fn default() -> Self {
        Self { action: DEFAULT_ACTION, profile_name: None, sound_switch_path: None }
    }
}

impl NormalizedSoundwInput {
    /// The raw input this normalizes back into, for `run_soundw`.
    #[must_use]
    pub fn to_input(&self) -> SoundwInput {
        SoundwInput {
            action: Some(self.action),
            sound_switch_path: self.sound_switch_path.clone(),
            profile_name: self.profile_name.clone(),
        }
    }

    /// The boundary document, with the field names `interaction.ts:24` uses.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }
}

/// Every declared action spelling, in definition order: the vocabulary `oneOfDeclaredOptions`
/// checks against, kept as data so a face can render the same list it validates with.
#[must_use]
pub fn declared_action_texts() -> Vec<&'static str> {
    SoundwAction::ALL.iter().map(|action| action.as_str()).collect()
}

/// One refused field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoundwFieldViolation {
    /// The field the definition names.
    pub field_id: &'static str,
    /// The declared rule that refused it.
    pub rule: &'static str,
    /// Chinese copy, when the node authored any.
    pub message_zh: Option<&'static str>,
    /// English copy, when the node authored any.
    pub message_en: Option<&'static str>,
}

impl SoundwFieldViolation {
    /// The message in the requested language; anything but `"en"` is Chinese, the same default
    /// `interaction.ts:14` uses (`language: TerminalLanguage = "zh"`).
    ///
    /// A rule the definition declares without copy (`oneOfDeclaredOptions`, which has no
    /// `message` key at `node-definitions/soundw.json:165-171`) reports the field and the rule
    /// instead of an invented translation — the node's authored sentences are its own, and a
    /// plugin may not add to that dictionary.
    #[must_use]
    pub fn message(&self, language: &str) -> String {
        let authored =
            if language == "en" { self.message_en.or(self.message_zh) } else { self.message_zh.or(self.message_en) };
        authored.map(str::to_owned).unwrap_or_else(|| format!("{self}"))
    }
}

impl std::fmt::Display for SoundwFieldViolation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{} fails the declared rule {}", self.field_id, self.rule)
    }
}

impl std::error::Error for SoundwFieldViolation {}

/// Why an input document could not be normalized at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoundwInputRejection {
    /// A stable identifier, `PluginError.code`'s spelling (ADR-0068: codes are machine-readable).
    pub code: &'static str,
    /// The refused field.
    pub field_id: &'static str,
    /// The declared rule that refused it.
    pub rule: &'static str,
    /// Display text; the vocabulary list, never invented prose.
    pub message: String,
}

impl SoundwInputRejection {
    /// The `PluginError` document ADR-0068 defines: `{ code, message, details? }`.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "code": self.code,
            "message": self.message,
            "details": [["field", self.field_id], ["rule", self.rule]],
        })
    }
}

impl std::fmt::Display for SoundwInputRejection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.field_id, self.message)
    }
}

impl std::error::Error for SoundwInputRejection {}

/// The action slot of a request document.
///
/// Absent means `status` (`interaction.ts:16`, `core.ts:9`). A spelling outside the declared
/// options is refused, which is what `oneOfDeclaredOptions` means and what the TypeScript made
/// impossible by typing the field (`core.ts:3`).
///
/// # Errors
///
/// Returns a [`SoundwInputRejection`] when the text is not one of the eight declared actions.
pub fn parse_action_text(value: Option<&str>) -> Result<SoundwAction, SoundwInputRejection> {
    let text = js_trim(value.unwrap_or_default());
    if text.is_empty() {
        return Ok(DEFAULT_ACTION);
    }
    SoundwAction::parse(text).ok_or_else(|| SoundwInputRejection {
        code: "input.action_not_declared",
        field_id: ACTION_FIELD_ID,
        rule: "oneOfDeclaredOptions",
        message: format!("action must be one of: {}", declared_action_texts().join(", ")),
    })
}

/// `interaction.ts:24` applied to a typed input: default the action, trim the two text fields,
/// omit the blanks.
#[must_use]
pub fn normalize_soundw_input(input: &SoundwInput) -> NormalizedSoundwInput {
    NormalizedSoundwInput {
        action: input.action.unwrap_or(DEFAULT_ACTION),
        profile_name: trimmed_or_none(input.profile_name.as_deref().unwrap_or_default()),
        sound_switch_path: trimmed_or_none(input.sound_switch_path.as_deref().unwrap_or_default()),
    }
}

/// Normalization from the raw slot texts a face collects, refusing an undeclared action.
///
/// # Errors
///
/// Returns [`SoundwInputRejection`] when `action` is not one of the declared options.
pub fn normalize_soundw_values(
    action: Option<&str>,
    profile_name: Option<&str>,
    sound_switch_path: Option<&str>,
) -> Result<NormalizedSoundwInput, SoundwInputRejection> {
    Ok(NormalizedSoundwInput {
        action: parse_action_text(action)?,
        profile_name: non_empty(js_trim(profile_name.unwrap_or_default())),
        sound_switch_path: non_empty(js_trim(sound_switch_path.unwrap_or_default())),
    })
}

/// The declared rules, evaluated over a normalized input.
///
/// The node publishes two rules. `oneOfDeclaredOptions` is enforced where the action is read
/// ([`parse_action_text`]) and cannot fire again here, because `NormalizedSoundwInput::action` is
/// already a `SoundwAction`; `nonBlank` is guarded by `actionIs("profile")`
/// (`node-definitions/soundw.json:205-217`), so for every other action a blank profile name is
/// legal and must not be reported.
#[must_use]
pub fn validate_soundw_input(input: &NormalizedSoundwInput) -> Vec<SoundwFieldViolation> {
    let mut violations = Vec::new();
    if input.action.needs_profile_name()
        && input.profile_name.as_deref().is_none_or(|name| name.is_empty())
    {
        violations.push(SoundwFieldViolation {
            field_id: PROFILE_NAME_FIELD_ID,
            rule: "nonBlank",
            message_zh: Some(PROFILE_NAME_REQUIRED_ZH),
            message_en: Some(PROFILE_NAME_REQUIRED_EN),
        });
    }
    violations
}

/// `interaction.ts:24`'s `String(value).trim() ? null : message` for the profile-name field,
/// answering with the authored message or `None`.
#[must_use]
pub fn validate_profile_name(value: Option<&str>, language: &str) -> Option<String> {
    let trimmed = js_trim(value.unwrap_or_default());
    if trimmed.is_empty() {
        Some(if language == "en" { PROFILE_NAME_REQUIRED_EN } else { PROFILE_NAME_REQUIRED_ZH }.to_owned())
    } else {
        None
    }
}

fn non_empty(trimmed: &str) -> Option<String> {
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_action_is_status_and_blank_text_is_omitted() {
        let input = SoundwInput {
            action: None,
            profile_name: Some("   ".to_owned()),
            sound_switch_path: Some("  C:/tools/SoundSwitch.CLI.exe  ".to_owned()),
        };
        let normalized = normalize_soundw_input(&input);
        assert_eq!(normalized.action, SoundwAction::Status);
        assert_eq!(normalized.profile_name, None, "trimOrOmit, not an empty string");
        assert_eq!(normalized.sound_switch_path.as_deref(), Some("C:/tools/SoundSwitch.CLI.exe"));
    }

    #[test]
    fn a_non_blank_profile_name_survives_the_trim() {
        // Negative control for the test above.
        let normalized =
            normalize_soundw_values(Some("profiles"), Some("  womic  "), None).expect("declared action");
        assert_eq!(normalized.action, SoundwAction::Profiles);
        assert_eq!(normalized.profile_name.as_deref(), Some("womic"));
    }

    #[test]
    fn an_undeclared_action_spelling_is_refused_with_the_declared_vocabulary() {
        let refused = parse_action_text(Some("recording")).expect_err("the CLI alias is not an action id");
        assert_eq!(refused.field_id, ACTION_FIELD_ID);
        assert_eq!(refused.rule, "oneOfDeclaredOptions");
        assert!(refused.message.contains("switch-recording"), "{}", refused.message);
        // Negative control: the empty spelling is the *absent* case, which is legal.
        assert_eq!(parse_action_text(Some("  ")).expect("default"), SoundwAction::Status);
    }

    #[test]
    fn the_non_blank_rule_applies_only_to_the_profile_action() {
        let blank = NormalizedSoundwInput { action: SoundwAction::Profile, profile_name: None, sound_switch_path: None };
        let violations = validate_soundw_input(&blank);
        assert_eq!(violations.len(), 1);
        assert_eq!(violations[0].field_id, PROFILE_NAME_FIELD_ID);
        assert_eq!(violations[0].rule, "nonBlank");
        assert_eq!(violations[0].message("zh"), PROFILE_NAME_REQUIRED_ZH);
        assert_eq!(violations[0].message("en"), PROFILE_NAME_REQUIRED_EN);

        // Negative controls: every other action accepts a missing name, and `profile` with a name
        // accepts too.
        for action in SoundwAction::ALL {
            if action.needs_profile_name() {
                continue;
            }
            let input = NormalizedSoundwInput { action, profile_name: None, sound_switch_path: None };
            assert!(validate_soundw_input(&input).is_empty(), "{action:?} must not require a name");
        }
        let named = NormalizedSoundwInput {
            action: SoundwAction::Profile,
            profile_name: Some("womic".to_owned()),
            sound_switch_path: None,
        };
        assert!(validate_soundw_input(&named).is_empty());
    }

    #[test]
    fn the_field_level_validate_helper_answers_in_the_requested_language() {
        assert_eq!(validate_profile_name(Some("  "), "zh").as_deref(), Some(PROFILE_NAME_REQUIRED_ZH));
        assert_eq!(validate_profile_name(Some("  "), "en").as_deref(), Some(PROFILE_NAME_REQUIRED_EN));
        assert_eq!(validate_profile_name(Some("womic"), "zh"), None);
    }

    #[test]
    fn a_rejection_serializes_as_the_plugin_error_document() {
        let refused = parse_action_text(Some("nope")).expect_err("refused");
        let document = refused.to_json();
        assert_eq!(document["code"], serde_json::json!("input.action_not_declared"));
        assert_eq!(document["details"], serde_json::json!([["field", "action"], ["rule", "oneOfDeclaredOptions"]]));
    }

    #[test]
    fn normalization_round_trips_through_the_input_document() {
        let normalized = NormalizedSoundwInput {
            action: SoundwAction::ToggleMute,
            profile_name: None,
            sound_switch_path: Some("/opt/bin/SoundSwitch.CLI".to_owned()),
        };
        let document = normalized.to_json();
        assert_eq!(document["action"], serde_json::json!("toggle-mute"));
        assert_eq!(document["soundSwitchPath"], serde_json::json!("/opt/bin/SoundSwitch.CLI"));
        assert_eq!(normalized.to_input().action, Some(SoundwAction::ToggleMute));
    }
}
