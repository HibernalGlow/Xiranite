//! The two plugin-export bindings the published definition names, plus the danger gate.
//!
//! `node-definitions/soundw.json:271-272` declares `"previewExport": "preview"` and
//! `"resultExport": "result_view"`, which ADR-0069 resolves to *this* crate: the closures they
//! replace (`interaction.ts:25-27`) are node behaviour, so each face must call the plugin rather
//! than restate them. The label table below is `interaction.ts:9-12` quoted verbatim, and
//! `tests/definition_contract.rs` greps the TypeScript for every string in it.
//!
//! Note the deliberate double identity of one sentence: `interaction.ts:10-11` authored a schema
//! description (`"快速切换 SoundSwitch 录音设备与麦克风状态。"`) that is *not* the `help.ts`
//! `short` the definition publishes as `description` (`"通过 SoundSwitch 快速查看、切换和静音录音设备。"`).
//! Both are node copy, both are kept, and neither is derived from the other.

use crate::js_text::{js_split_lines, js_trim};
use crate::soundw_model::{SoundwAction, SoundwInput, SoundwRunResult};

/// `interaction.ts:27`'s `slice(0, 8)`: how many output lines a result view shows.
pub const RESULT_VIEW_MAX_LINES: usize = 8;

/// A pair of authored strings, `LocalizedText` in the definition language (ADR-0069).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SoundwLabel {
    /// Chinese copy.
    pub zh: &'static str,
    /// English copy.
    pub en: &'static str,
}

impl SoundwLabel {
    /// The copy for one language; anything but `"en"` selects Chinese, the default
    /// `interaction.ts:14` gives `language`.
    #[must_use]
    pub fn resolve(self, language: &str) -> &'static str {
        if language == "en" { self.en } else { self.zh }
    }
}

/// `interaction.ts:10-11` `labels.zh.name` / `labels.en.name`.
pub const LABEL_NAME: SoundwLabel = SoundwLabel { zh: "SoundW", en: "SoundW" };
/// `interaction.ts:10-11` `description`, the interaction schema's own line.
pub const LABEL_DESCRIPTION: SoundwLabel =
    SoundwLabel { zh: "快速切换 SoundSwitch 录音设备与麦克风状态。", en: "Quickly switch SoundSwitch recording devices and microphone state." };
/// `interaction.ts:10-11` `path`, the `soundSwitchPath` field's label.
pub const LABEL_PATH: SoundwLabel = SoundwLabel { zh: "CLI 路径覆盖", en: "CLI path override" };
/// `interaction.ts:10-11` `profileName`, the `profileName` field's label.
pub const LABEL_PROFILE_NAME: SoundwLabel = SoundwLabel { zh: "预设名称", en: "Profile name" };

/// `interaction.ts:10-11`: the eight action labels, keyed by the action itself so the table cannot
/// drift from the vocabulary `SoundwAction` defines.
#[must_use]
pub const fn action_label(action: SoundwAction) -> SoundwLabel {
    match action {
        SoundwAction::Status => SoundwLabel { zh: "当前状态", en: "Current status" },
        SoundwAction::SwitchRecording => SoundwLabel { zh: "切换录音设备", en: "Switch recording" },
        SoundwAction::Mute => SoundwLabel { zh: "静音麦克风", en: "Mute microphone" },
        SoundwAction::Unmute => SoundwLabel { zh: "解除静音", en: "Unmute microphone" },
        SoundwAction::ToggleMute => SoundwLabel { zh: "切换静音", en: "Toggle mute" },
        SoundwAction::Profiles => SoundwLabel { zh: "扫描预设", en: "Scan profiles" },
        SoundwAction::Profile => SoundwLabel { zh: "激活预设", en: "Activate profile" },
        SoundwAction::Settings => SoundwLabel { zh: "打开设置", en: "Open settings" },
    }
}

/// `interaction.ts:31` `soundwActionLabel`.
#[must_use]
pub fn soundw_action_label(action: SoundwAction, language: &str) -> &'static str {
    action_label(action).resolve(language)
}

/// The danger gate, as the node declares it: `interaction.ts:26` is `isDangerous: () => false`
/// and `node-definitions/soundw.json:268-270` is `danger: { "type": "none" }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SoundwDangerGate {
    /// Never asks. What SoundW declares.
    None,
    /// Asks for these actions. Not what SoundW declares, but the definition language's
    /// `DangerGate::ActionIn`, kept so the gate has an evaluator and a negative control.
    ActionIn {
        /// The actions that confirm first.
        dangerous: Vec<SoundwAction>,
    },
}

impl SoundwDangerGate {
    /// `interaction.ts:26`: the gate this node publishes.
    #[must_use]
    pub const fn soundw_declared() -> Self {
        Self::None
    }

    /// Whether a gate holds for one action.
    #[must_use]
    pub fn holds(&self, action: SoundwAction) -> bool {
        match self {
            Self::None => false,
            Self::ActionIn { dangerous } => dangerous.contains(&action),
        }
    }
}

/// `interaction.ts:26` `isDangerous(values)`.
///
/// The closure ignores its values and returns `false`, and the gate it reads is
/// [`SoundwDangerGate::None`], so this is `false` for every action. It is written against the gate
/// rather than as a literal so the next node that copies this shape cannot forget the check.
#[must_use]
pub fn is_dangerous(input: &SoundwInput) -> bool {
    SoundwDangerGate::soundw_declared().holds(input.action.unwrap_or(SoundwAction::Status))
}

/// `interaction.ts:25` `preview(input)`: the lines a face shows before anything runs.
///
/// The action label always leads (`l[input.action ?? "status"]`), and the two optional lines are
/// the field label plus the value, which `.filter(Boolean)` drops when the value was absent.
#[must_use]
pub fn preview(input: &SoundwInput, language: &str) -> Vec<String> {
    let action = input.action.unwrap_or(SoundwAction::Status);
    let mut lines = vec![soundw_action_label(action, language).to_owned()];
    if let Some(profile_name) = present(input.profile_name.as_deref()) {
        lines.push(format!("{}: {profile_name}", LABEL_PROFILE_NAME.resolve(language)));
    }
    if let Some(path) = present(input.sound_switch_path.as_deref()) {
        lines.push(format!("{}: {path}", LABEL_PATH.resolve(language)));
    }
    lines
}

/// `interaction.ts:27` `result(result)`: the result view model.
#[must_use]
pub fn result_view(result: &SoundwRunResult) -> SoundwResultView {
    let lines: Vec<String> = if result.data.output.is_empty() {
        Vec::new()
    } else {
        js_split_lines(&result.data.output)
            .into_iter()
            .take(RESULT_VIEW_MAX_LINES)
            .map(str::to_owned)
            .collect()
    };
    SoundwResultView { success: result.success, message: result.message.clone(), lines }
}

/// The `result_view` document: `{ success, message, lines }`, the three keys `interaction.ts:27`
/// returns and the React card renders.
#[derive(Debug, Clone, PartialEq, Eq)]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundwResultView {
    /// `success`, copied rather than re-derived.
    pub success: bool,
    /// `message`, copied rather than re-derived.
    pub message: String,
    /// `lines`, the first [`RESULT_VIEW_MAX_LINES`] lines of `data.output`.
    pub lines: Vec<String>,
}

fn present(value: Option<&str>) -> Option<&str> {
    let trimmed = js_trim(value.unwrap_or_default());
    (!trimmed.is_empty()).then_some(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(action: Option<SoundwAction>, profile_name: Option<&str>, path: Option<&str>) -> SoundwInput {
        SoundwInput { action, profile_name: profile_name.map(str::to_owned), sound_switch_path: path.map(str::to_owned) }
    }

    #[test]
    fn the_preview_leads_with_the_action_label_in_the_requested_language() {
        assert_eq!(preview(&input(Some(SoundwAction::Mute), None, None), "zh"), vec!["静音麦克风"]);
        assert_eq!(preview(&input(Some(SoundwAction::Mute), None, None), "en"), vec!["Mute microphone"]);
    }

    #[test]
    fn an_absent_action_previews_as_status() {
        // `interaction.ts:25` reads `input.action ?? "status"`.
        assert_eq!(preview(&input(None, None, None), "zh"), vec!["当前状态"]);
    }

    #[test]
    fn the_optional_preview_lines_carry_their_field_labels() {
        let lines = preview(&input(Some(SoundwAction::Profile), Some("womic"), Some("C:/cli.exe")), "en");
        assert_eq!(lines, vec!["Activate profile", "Profile name: womic", "CLI path override: C:/cli.exe"]);
        // Negative control: blank values are dropped, exactly as `.filter(Boolean)` does.
        assert_eq!(preview(&input(Some(SoundwAction::Profile), Some("   "), Some("")), "zh"), vec!["激活预设"]);
    }

    #[test]
    fn every_action_has_both_languages() {
        for action in SoundwAction::ALL {
            let label = action_label(action);
            assert!(!label.zh.trim().is_empty(), "{action:?} has no Chinese label");
            assert!(!label.en.trim().is_empty(), "{action:?} has no English label");
            assert_ne!(label.zh, label.en, "{action:?} would render one language twice");
        }
        assert_eq!(LABEL_NAME.zh, LABEL_NAME.en, "interaction.ts:10-11 spell the name the same way");
        assert_eq!(LABEL_PATH.zh, "CLI 路径覆盖");
        assert_eq!(LABEL_PROFILE_NAME.en, "Profile name");
        assert_eq!(LABEL_DESCRIPTION.en, "Quickly switch SoundSwitch recording devices and microphone state.");
    }

    #[test]
    fn the_result_view_copies_the_headline_and_slices_the_output() {
        let result = SoundwRunResult::ok(
            "Profiles: a, b",
            crate::soundw_model::SoundwData {
                installed: true,
                output: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj".to_owned(),
                ..Default::default()
            },
        );
        let view = result_view(&result);
        assert!(view.success);
        assert_eq!(view.message, "Profiles: a, b");
        assert_eq!(view.lines.len(), RESULT_VIEW_MAX_LINES);
        assert_eq!(view.lines.first().map(String::as_str), Some("a"));
        assert_eq!(view.lines.last().map(String::as_str), Some("h"));
    }

    #[test]
    fn an_empty_output_has_no_lines_at_all() {
        // `interaction.ts:27`: `result.data?.output ? … : []`.
        let result = SoundwRunResult::failure("boom", crate::soundw_model::SoundwData::default());
        let view = result_view(&result);
        assert!(!view.success);
        assert_eq!(view.message, "boom");
        assert!(view.lines.is_empty());
        // Negative control: a single line still yields exactly one entry.
        let single = SoundwRunResult::ok(
            "Muted",
            crate::soundw_model::SoundwData { output: "Muted".to_owned(), ..Default::default() },
        );
        assert_eq!(result_view(&single).lines, vec!["Muted".to_owned()]);
    }

    #[test]
    fn crlf_output_does_not_leave_carriage_returns_in_the_view() {
        let result = SoundwRunResult::ok(
            "x",
            crate::soundw_model::SoundwData { output: "one\r\ntwo".to_owned(), ..Default::default() },
        );
        assert_eq!(result_view(&result).lines, vec!["one".to_owned(), "two".to_owned()]);
    }

    #[test]
    fn the_declared_gate_never_asks_and_an_action_in_gate_would() {
        assert!(!is_dangerous(&input(Some(SoundwAction::SwitchRecording), None, None)));
        for action in SoundwAction::ALL {
            assert!(!SoundwDangerGate::soundw_declared().holds(action), "{action:?} must not confirm");
        }
        // Negative control for the evaluator itself: `ActionIn` is what a node that does ask
        // publishes, and it must actually hold.
        let asking = SoundwDangerGate::ActionIn { dangerous: vec![SoundwAction::SwitchRecording] };
        assert!(asking.holds(SoundwAction::SwitchRecording));
        assert!(!asking.holds(SoundwAction::Status));
    }
}
