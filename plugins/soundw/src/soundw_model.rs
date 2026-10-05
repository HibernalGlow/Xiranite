//! The flat data the `soundw` boundary speaks, one-to-one with the TypeScript contract.
//!
//! Every shape here mirrors `packages/nodes/soundw/src/core.ts` rather than inventing a Rust
//! idiom, because these are the product's wire types: `SoundwInput` is
//! `nodeRunRequestSchema.input` (`packages/shared/src/index.ts:140-144`), `SoundwRunResult`
//! is `nodeRunResultSchema` (`:97-102`) and `SoundwData` is the `data` the React card
//! (`src/nodes/soundw/Component.tsx`) and the CLI pipe mode (`cli.ts:210-215`) both read.
//! ADR-0068's WIT clause is satisfied by construction: option/enum/record/list/string/bool/
//! fixed-width integers, no machine words, no serde tricks beyond `camelCase` field naming.
//!
//! Port map:
//!
//! | TypeScript | Rust |
//! | --- | --- |
//! | `core.ts:3` `SoundwAction` | [`SoundwAction`] |
//! | `core.ts:4` `SoundwInput` | [`SoundwInput`] |
//! | `core.ts:5` `SoundwData` | [`SoundwData`] |
//! | `core.ts:12-18` the argv ternary chain | [`SoundwAction::cli_args`] |
//! | `core.ts:34-40` `parseProfiles` | `crate::soundw_core::parse_profiles` |
//! | `index.ts:3` `def` | [`SoundwNodeDescription::soundw_node_description`] |

/// The registry `def` fields (`index.ts:3`), quoted rather than paraphrased: `audit:node-help-text`
/// treats a node's own copy as the dictionary, and the plugin is the only remaining producer of it.
pub const SOUNDW_NODE_ID: &str = "soundw";
/// `index.ts:3` `name`.
pub const SOUNDW_NODE_NAME: &str = "SoundW";
/// `index.ts:3` `version`. This is the node's own release, not the Plugin API version the
/// manifest declares (ADR-0068 keeps those three facts apart).
pub const SOUNDW_NODE_VERSION: &str = "0.1.0";
/// `index.ts:3` `category`.
pub const SOUNDW_NODE_CATEGORY: &str = "system";
/// `index.ts:3` `description`.
pub const SOUNDW_NODE_DESCRIPTION: &str =
    "Quickly switch SoundSwitch recording devices and microphone mute state.";
/// `index.ts:3` `icon`.
pub const SOUNDW_NODE_ICON: &str = "Mic";

/// The eight actions of `SoundwAction` (`core.ts:3`), in the order `interaction.ts:8` lists them.
///
/// The order is the TUI tab order and the CLI subcommand order (ADR-0069), so it is content, not
/// an accident of the enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SoundwAction {
    /// `"status"` — reads the mute state; `core.ts:18`'s fall-through argv is `["mute"]`.
    Status,
    /// `"switch-recording"` — `core.ts:12`.
    SwitchRecording,
    /// `"mute"` — `core.ts:13`.
    Mute,
    /// `"unmute"` — `core.ts:14`.
    Unmute,
    /// `"toggle-mute"` — `core.ts:15`.
    ToggleMute,
    /// `"profiles"` — `core.ts:16`.
    Profiles,
    /// `"profile"` — `core.ts:17`, the only action that needs `profileName`.
    Profile,
    /// `"settings"` — `core.ts:18`.
    Settings,
}

impl SoundwAction {
    /// Every action, in definition order (`interaction.ts:8`, `node-definitions/soundw.json`
    /// `actions[]`).
    pub const ALL: [Self; 8] = [
        Self::Status,
        Self::SwitchRecording,
        Self::Mute,
        Self::Unmute,
        Self::ToggleMute,
        Self::Profiles,
        Self::Profile,
        Self::Settings,
    ];

    /// The wire text, which is also the `action` slot of the input document (`interaction.ts:24`).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::SwitchRecording => "switch-recording",
            Self::Mute => "mute",
            Self::Unmute => "unmute",
            Self::ToggleMute => "toggle-mute",
            Self::Profiles => "profiles",
            Self::Profile => "profile",
            Self::Settings => "settings",
        }
    }

    /// The action named by some text, or `None`.
    ///
    /// `None` is the branch the TypeScript union made impossible; the plugin gets JSON off the
    /// wire, so an unlisted spelling is a refusible input rather than a silent `status`. The
    /// published definition declares exactly that as `oneOfDeclaredOptions`
    /// (`node-definitions/soundw.json:165-171`).
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|action| action.as_str() == value)
    }

    /// `core.ts:12-18`: the argv the SoundSwitch CLI is called with.
    ///
    /// `profile_name` arrives already trimmed by `crate::soundw_input`; the `""` case is what
    /// `core.ts:17` produces (`input.profileName?.trim() || ""`) and `core.ts:19` refuses before
    /// anything is invoked.
    #[must_use]
    pub fn cli_args(self, profile_name: &str) -> Vec<String> {
        let words: &[&str] = match self {
            Self::SwitchRecording => &["switch", "--type", "Recording"],
            Self::Mute => &["mute", "--state", "true"],
            Self::Unmute => &["mute", "--state", "false"],
            Self::ToggleMute => &["mute", "--toggle"],
            Self::Profiles => &["profile", "--list"],
            Self::Settings => &["settings"],
            // `status` is `core.ts:18`'s else-branch: a bare `mute` asks SoundSwitch for the
            // current state instead of setting one.
            Self::Status => &["mute"],
            Self::Profile => return vec!["profile".to_owned(), "--name".to_owned(), profile_name.to_owned()],
        };
        words.iter().map(|word| (*word).to_owned()).collect()
    }

    /// Whether this action reads state, which is what makes `muteState` meaningful (`core.ts:32`).
    #[must_use]
    pub const fn is_status(self) -> bool {
        matches!(self, Self::Status)
    }

    /// Whether this action asks for a profile name (`core.ts:19`).
    #[must_use]
    pub const fn needs_profile_name(self) -> bool {
        matches!(self, Self::Profile)
    }
}

/// `SoundwInput` (`core.ts:4`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SoundwInput {
    /// `action`, absent meaning `status` (`core.ts:9`).
    pub action: Option<SoundwAction>,
    /// `soundSwitchPath`, the CLI path override (`interaction.ts:22`, `platform.ts:7-9`).
    pub sound_switch_path: Option<String>,
    /// `profileName` (`interaction.ts:21`).
    pub profile_name: Option<String>,
}

/// `SoundwData` (`core.ts:5`), the `data` half of the run result.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SoundwData {
    /// `installed`: whether the SoundSwitch CLI was reachable at all (`core.ts:11,19,27,32`).
    pub installed: bool,
    /// `command`: the argv that was (or would have been) run.
    pub command: Vec<String>,
    /// `output`: display text, `core.ts:27,32`.
    pub output: String,
    /// `profiles`: names parsed out of the CLI table (`core.ts:29`).
    pub profiles: Vec<String>,
    /// `muteState`: raw stdout for `status`, `null` otherwise (`core.ts:32`).
    pub mute_state: Option<String>,
    /// `errors`: one entry per failure, set by `fail()` (`core.ts:43`).
    pub errors: Vec<String>,
}

/// `NodeRunResult<SoundwData>` (`packages/shared/src/index.ts:97-102`).
///
/// `data` is not optional here even though the schema allows it to be: `core.ts:41-43` builds a
/// full `SoundwData` for every success and every failure, so a soundw answer always carries one.
#[derive(Debug, Clone, PartialEq, Eq)]
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundwRunResult {
    /// `success`.
    pub success: bool,
    /// `message`.
    pub message: String,
    /// `data`.
    pub data: SoundwData,
}

impl SoundwRunResult {
    /// `core.ts:42` `ok()`.
    #[must_use]
    pub fn ok(message: impl Into<String>, data: SoundwData) -> Self {
        Self { success: true, message: message.into(), data }
    }

    /// `core.ts:43` `fail()`: the message is also appended to `errors`.
    #[must_use]
    pub fn failure(message: impl Into<String>, mut data: SoundwData) -> Self {
        let text = message.into();
        data.errors = vec![text.clone()];
        Self { success: false, message: text, data }
    }

    /// `{ success, message, data }` as the protocol document.
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).unwrap_or(serde_json::Value::Null)
    }
}

/// `NodeRunEvent` (`packages/shared/src/index.ts:89-96`), the shape `core.ts:20,31` produces.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SoundwRunEvent {
    /// `{ type: "progress", progress, message }`.
    Progress {
        /// `progress`, `30` then `100` in `core.ts:20,31`.
        progress: u32,
        /// `message`.
        message: String,
    },
    /// `{ type: "log", message }`. SoundW never logs through the event stream today; the variant
    /// exists because `nodeRunEventSchema` admits it and `xiranite.operation.emit` carries either.
    Log {
        /// `message`.
        message: String,
    },
}

impl SoundwRunEvent {
    /// The `type` discriminator.
    #[must_use]
    pub const fn event_type(&self) -> &'static str {
        match self {
            Self::Progress { .. } => "progress",
            Self::Log { .. } => "log",
        }
    }

    /// The wire document, with `progress` absent for a log event (`:89-96` marks it optional).
    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Self::Progress { progress, message } => serde_json::json!({
                "type": "progress",
                "progress": progress,
                "message": message,
            }),
            Self::Log { message } => serde_json::json!({ "type": "log", "message": message }),
        }
    }
}

/// `index.ts:3` `def` as data, for `describe`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundwNodeDescription {
    /// `id`.
    pub id: &'static str,
    /// `name`.
    pub name: &'static str,
    /// `version`.
    pub version: &'static str,
    /// `category`.
    pub category: &'static str,
    /// `description`.
    pub description: &'static str,
    /// `icon`.
    pub icon: &'static str,
    /// `keywords`.
    pub keywords: [&'static str; 4],
}

/// The registry entry, verbatim from `index.ts:3` (`keywords: ["audio", "microphone",
/// "soundswitch", "mute"]`).
#[must_use]
pub const fn soundw_node_description() -> SoundwNodeDescription {
    SoundwNodeDescription {
        id: SOUNDW_NODE_ID,
        name: SOUNDW_NODE_NAME,
        version: SOUNDW_NODE_VERSION,
        category: SOUNDW_NODE_CATEGORY,
        description: SOUNDW_NODE_DESCRIPTION,
        icon: SOUNDW_NODE_ICON,
        keywords: ["audio", "microphone", "soundswitch", "mute"],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_wire_texts_cover_the_declared_eight() {
        let texts: Vec<&str> = SoundwAction::ALL.iter().map(|action| action.as_str()).collect();
        assert_eq!(
            texts,
            vec![
                "status",
                "switch-recording",
                "mute",
                "unmute",
                "toggle-mute",
                "profiles",
                "profile",
                "settings"
            ],
            "interaction.ts:8 is the order the faces render"
        );
        for text in &texts {
            assert_eq!(SoundwAction::parse(text).map(|action| action.as_str()), Some(*text));
        }
    }

    #[test]
    fn an_unlisted_action_spelling_parses_to_nothing() {
        // Negative control for the test above: the kebab-case spellings are the whole vocabulary.
        assert_eq!(SoundwAction::parse("switch_recording"), None);
        assert_eq!(SoundwAction::parse("Status"), None);
        assert_eq!(SoundwAction::parse(""), None);
    }

    #[test]
    fn serde_reads_the_same_kebab_case_text() {
        let parsed: SoundwAction =
            serde_json::from_str("\"toggle-mute\"").expect("kebab-case action");
        assert_eq!(parsed, SoundwAction::ToggleMute);
        assert_eq!(serde_json::to_string(&parsed).expect("serialize"), "\"toggle-mute\"");

        let refused = serde_json::from_str::<SoundwAction>("\"recording\"");
        assert!(refused.is_err(), "core.ts:3's union has no `recording`; that spelling is a CLI alias");
    }

    #[test]
    fn cli_args_match_the_core_ternary_chain() {
        assert_eq!(SoundwAction::SwitchRecording.cli_args(""), ["switch", "--type", "Recording"]);
        assert_eq!(SoundwAction::Mute.cli_args(""), ["mute", "--state", "true"]);
        assert_eq!(SoundwAction::Unmute.cli_args(""), ["mute", "--state", "false"]);
        assert_eq!(SoundwAction::ToggleMute.cli_args(""), ["mute", "--toggle"]);
        assert_eq!(SoundwAction::Profiles.cli_args(""), ["profile", "--list"]);
        assert_eq!(SoundwAction::Profile.cli_args("womic"), ["profile", "--name", "womic"]);
        assert_eq!(SoundwAction::Settings.cli_args(""), ["settings"]);
        assert_eq!(SoundwAction::Status.cli_args(""), ["mute"]);
    }

    #[test]
    fn a_blank_profile_name_still_produces_the_empty_argument() {
        // core.ts:17 writes `input.profileName?.trim() || ""`, and core.ts:19 refuses before the
        // invocation, so the argv is built with the empty slot but never run.
        assert_eq!(SoundwAction::Profile.cli_args(""), ["profile", "--name", ""]);
    }

    #[test]
    fn data_serializes_with_the_camel_case_field_names_the_card_reads() {
        let data = SoundwData {
            installed: true,
            command: vec!["mute".to_owned()],
            output: "Muted".to_owned(),
            profiles: vec!["womic".to_owned()],
            mute_state: Some("Muted".to_owned()),
            errors: vec![],
        };
        let document = serde_json::to_value(&data).expect("json");
        assert_eq!(document["installed"], serde_json::json!(true));
        assert_eq!(document["muteState"], serde_json::json!("Muted"));
        assert_eq!(document["profiles"], serde_json::json!(["womic"]));
        // The six keys are the contract (`core.ts:5`); their order is not, because every consumer
        // reads `data.output` / `data.profiles` by name, and `serde_json::Map` sorts them.
        let mut keys: Vec<&String> = document.as_object().expect("object").keys().collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec!["command", "errors", "installed", "muteState", "output", "profiles"]
        );
    }

    #[test]
    fn a_null_mute_state_stays_present_as_null() {
        // core.ts:5 types `muteState: string | null`; JSON `null` is the answer, not an absent key.
        let document = serde_json::to_value(SoundwData::default()).expect("json");
        assert_eq!(document["muteState"], serde_json::Value::Null);
    }

    #[test]
    fn failure_appends_the_message_to_errors() {
        let result = SoundwRunResult::failure("boom", SoundwData { installed: true, ..Default::default() });
        assert!(!result.success);
        assert_eq!(result.data.errors, vec!["boom".to_owned()]);
        assert_eq!(result.data.command, Vec::<String>::new(), "core.ts:19 fails with no argv");
    }

    #[test]
    fn progress_events_carry_their_number_and_log_events_do_not() {
        assert_eq!(
            SoundwRunEvent::Progress { progress: 30, message: "x".to_owned() }.to_json(),
            serde_json::json!({ "type": "progress", "progress": 30, "message": "x" })
        );
        assert_eq!(
            SoundwRunEvent::Log { message: "x".to_owned() }.to_json(),
            serde_json::json!({ "type": "log", "message": "x" })
        );
    }
}
