//! `packages/nodes/soundw/src/core.ts` as Rust, branch for branch.
//!
//! The TypeScript takes an injected `SoundwRuntime` (`core.ts:6,8`), so this is a faithful port
//! rather than a reimplementation: the pre-flight order, the argv table, the stdout/stderr join,
//! the timeout rewrite, the profile-table parser and the `muteState` rule all keep their original
//! line-for-line meaning. Anything that had to change is listed at the bottom of this module
//! comment and is pinned by a test in `tests/parity_cases.rs`.
//!
//! | TypeScript | Rust |
//! | --- | --- |
//! | `core.ts:9` action default | [`run_soundw`] first line |
//! | `core.ts:10-11` CLI resolution | `runtime.resolve` + [`NOT_INSTALLED_MESSAGE`] |
//! | `core.ts:12-18` argv chain | `SoundwAction::cli_args` |
//! | `core.ts:19` blank profile guard | [`PROFILE_NAME_REQUIRED_MESSAGE`] |
//! | `core.ts:20,31` progress events | [`running_message`], [`COMPLETED_MESSAGE`] |
//! | `core.ts:22` output join | `crate::js_text::js_join_streams` |
//! | `core.ts:24-27` failure message choice | [`failure_message`] |
//! | `core.ts:29-30` profile display | [`parse_profiles`], [`PROFILES_PREFIX`] |
//! | `core.ts:32` result assembly | [`run_soundw`] tail |
//!
//! Deliberate differences from the TypeScript, all of them additions rather than substitutions:
//!
//! 1. **One checkpoint yield** between the pre-flight and the invocation. ADR-0066 requires a
//!    plugin to ask before doing work it cannot undo; `core.ts` had no equivalent because the Bun
//!    host could kill the process. A cancelled checkpoint answers the same `failure` result shape
//!    the rest of the function uses, with `installed: true` and the argv it never ran.
//! 2. **An unlisted `action` spelling is refused by `crate::soundw_input`** before this function
//!    is reached. `core.ts:18`'s else-branch would have treated it as `status`; the published
//!    definition declares `oneOfDeclaredOptions`, so the plugin honours the rule instead of the
//!    accident of an untyped JSON field.

use crate::js_text::{js_join_streams, js_trim, js_trim_option, matches_timeout_pattern, split_on_box_drawing, trimmed_or_none, js_split_lines};
use crate::soundw_model::{SoundwAction, SoundwData, SoundwInput, SoundwRunEvent, SoundwRunResult};
use crate::soundw_runtime::{SoundwCheckpoint, SoundwEventSink, SoundwRuntime};

/// `core.ts:11`, verbatim: the CLI is what the node is built on, so the sentence names it.
pub const NOT_INSTALLED_MESSAGE: &str =
    "SoundSwitch.CLI.exe not found. Install and start SoundSwitch first.";
/// `core.ts:19`, verbatim. Note this is the run-level sentence; the field-level rule in
/// `interaction.ts:21` has its own zh/en copy and lives in `crate::soundw_input`.
pub const PROFILE_NAME_REQUIRED_MESSAGE: &str = "Enter a SoundSwitch profile name.";
/// `core.ts:26`'s last-resort message when the process failed and printed nothing.
pub const COMMAND_FAILED_MESSAGE: &str = "SoundSwitch command failed.";
/// `core.ts:25`, the rewrite of a CLI that could not reach the tray app.
pub const BACKGROUND_APP_MESSAGE: &str = "SoundSwitch CLI could not reach the SoundSwitch background app. Start SoundSwitch from the system tray, then try again.";
/// `core.ts:31,32`: the completion event message and the empty-output fallback message are the
/// same sentence in the TypeScript, so they are one constant here.
pub const COMPLETED_MESSAGE: &str = "SoundSwitch command completed.";
/// `core.ts:30` when the table had no rows.
pub const NO_PROFILES_MESSAGE: &str = "No SoundSwitch profiles found.";
/// `core.ts:30`'s display prefix (the trailing separator belongs to it).
pub const PROFILES_PREFIX: &str = "Profiles: ";
/// The separator `core.ts:30` joins profile names with.
pub const PROFILES_SEPARATOR: &str = ", ";
/// The box-drawing character `core.ts:35-37` parses SoundSwitch's table with.
pub const PROFILE_TABLE_BORDER: char = '│';
/// The header cell `core.ts:38` skips.
pub const PROFILE_TABLE_HEADER: &str = "Profile";

/// `core.ts:20`'s progress message.
#[must_use]
pub fn running_message(args: &[String]) -> String {
    format!("Running SoundSwitch {}", args.iter().map(String::as_str).collect::<Vec<_>>().join(" "))
}

/// `core.ts:24-26`: which sentence a failed command reports.
///
/// The timeout pattern wins over the raw text because a CLI that could not reach the tray app
/// prints a .NET timeout stack the user cannot act on, and the printed text is the fallback when
/// there is any (`output ||`), with the generic sentence only for silence.
#[must_use]
pub fn failure_message(output: &str) -> &str {
    if matches_timeout_pattern(output) {
        BACKGROUND_APP_MESSAGE
    } else if output.is_empty() {
        COMMAND_FAILED_MESSAGE
    } else {
        output
    }
}

/// `core.ts:34-40` `parseProfiles`.
///
/// SoundSwitch's CLI prints a box-drawing table *and* progress chatter (`"Fetching profiles..."`
/// is in the same stdout, see `core.test.ts:50`), so only lines beginning with the border count,
/// only the second cell is a name, and the header row is skipped.
#[must_use]
pub fn parse_profiles(value: &str) -> Vec<String> {
    js_split_lines(value)
        .into_iter()
        .map(js_trim)
        .filter(|line| line.starts_with(PROFILE_TABLE_BORDER))
        .filter_map(|line| split_on_box_drawing(line).get(1).map(|cell| js_trim(cell)))
        .filter(|name| !name.is_empty() && *name != PROFILE_TABLE_HEADER)
        .map(str::to_owned)
        .collect()
}

/// `core.ts:30`'s display text for the `profiles` action.
#[must_use]
pub fn profiles_display(profiles: &[String]) -> String {
    if profiles.is_empty() {
        NO_PROFILES_MESSAGE.to_owned()
    } else {
        format!("{PROFILES_PREFIX}{}", profiles.iter().map(String::as_str).collect::<Vec<_>>().join(PROFILES_SEPARATOR))
    }
}

/// `core.ts:8-33` `runSoundw`.
#[must_use]
pub fn run_soundw(
    input: &SoundwInput,
    runtime: &dyn SoundwRuntime,
    on_event: &mut dyn SoundwEventSink,
) -> SoundwRunResult {
    let action = input.action.unwrap_or(SoundwAction::Status);

    // `core.ts:10-11`: nothing else runs until the CLI is there.
    let binary = runtime.resolve(input.sound_switch_path.as_deref());
    if !binary.found {
        return SoundwRunResult::failure(NOT_INSTALLED_MESSAGE, SoundwData::default());
    }

    // `core.ts:12-18` then `core.ts:19`: the argv is built first, and a blank name is refused
    // before the CLI is ever invoked (`core.test.ts:29-36`).
    let profile_name = js_trim_option(input.profile_name.as_deref());
    let args = action.cli_args(&profile_name);
    if action.needs_profile_name() && profile_name.is_empty() {
        return SoundwRunResult::failure(
            PROFILE_NAME_REQUIRED_MESSAGE,
            SoundwData { installed: true, ..SoundwData::default() },
        );
    }

    if let SoundwCheckpoint::Cancelled { message } = runtime.checkpoint() {
        return SoundwRunResult::failure(
            message,
            SoundwData { installed: true, command: args, ..SoundwData::default() },
        );
    }

    on_event.on_event(SoundwRunEvent::Progress { progress: 30, message: running_message(&args) });
    let process = runtime.run(&binary.path, &args);
    let output = js_join_streams(&process.stdout, &process.stderr);

    if process.code != 0 {
        let message = failure_message(&output).to_owned();
        return SoundwRunResult::failure(
            message,
            SoundwData { installed: true, command: args, output, ..SoundwData::default() },
        );
    }

    let profiles = if action == SoundwAction::Profiles { parse_profiles(&process.stdout) } else { Vec::new() };
    let display_output =
        if action == SoundwAction::Profiles { profiles_display(&profiles) } else { output };

    on_event.on_event(SoundwRunEvent::Progress { progress: 100, message: COMPLETED_MESSAGE.to_owned() });

    // `core.ts:32`: `muteState` reads the *raw* stdout of a `status` run, never the joined output,
    // and is `null` for every other action.
    let mute_state =
        if action.is_status() { trimmed_or_none(&process.stdout) } else { None };
    let message = if display_output.is_empty() { COMPLETED_MESSAGE.to_owned() } else { display_output.clone() };

    SoundwRunResult::ok(
        message,
        SoundwData {
            installed: true,
            command: args,
            output: display_output,
            profiles,
            mute_state,
            errors: Vec::new(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::soundw_runtime::{NoopSoundwEventSink, SoundwBinaryResolution, SoundwProcessOutput};

    struct Stub {
        output: SoundwProcessOutput,
        found: bool,
    }

    impl SoundwRuntime for Stub {
        fn resolve(&self, _path_override: Option<&str>) -> SoundwBinaryResolution {
            if self.found {
                SoundwBinaryResolution::found("SoundSwitch.CLI.exe")
            } else {
                SoundwBinaryResolution::missing()
            }
        }

        fn run(&self, _program: &str, _args: &[String]) -> SoundwProcessOutput {
            self.output.clone()
        }
    }

    fn run(action: SoundwAction, output: SoundwProcessOutput) -> SoundwRunResult {
        let input = SoundwInput { action: Some(action), ..SoundwInput::default() };
        run_soundw(&input, &Stub { output, found: true }, &mut NoopSoundwEventSink)
    }

    #[test]
    fn a_table_row_becomes_a_profile_name_and_the_header_does_not() {
        let parsed = parse_profiles("│ Profile │ Playback │\n│ womic │ Not set  │\n│  second │ x │");
        assert_eq!(parsed, vec!["womic".to_owned(), "second".to_owned()]);
    }

    #[test]
    fn chatter_and_borderless_lines_are_ignored() {
        assert_eq!(parse_profiles("Fetching profiles...\nplain text"), Vec::<String>::new());
        // Negative control: the same name without the leading border is not a table row.
        assert_eq!(parse_profiles(" womic │ Not set │"), Vec::<String>::new());
    }

    #[test]
    fn a_row_with_only_the_border_yields_no_second_cell() {
        assert_eq!(parse_profiles("│"), Vec::<String>::new());
        assert_eq!(parse_profiles("│  │"), Vec::<String>::new(), "a blank name is dropped, not empty-stringed");
    }

    #[test]
    fn the_failure_message_prefers_the_timeout_explanation_over_the_printed_text() {
        assert_eq!(failure_message("Error: The operation has timed out."), BACKGROUND_APP_MESSAGE);
        assert_eq!(failure_message("Access is denied."), "Access is denied.");
        assert_eq!(failure_message(""), COMMAND_FAILED_MESSAGE);
    }

    #[test]
    fn a_nonzero_exit_does_not_report_completion() {
        let result = run(SoundwAction::Status, SoundwProcessOutput::new(1, "", "boom"));
        assert!(!result.success);
        assert_eq!(result.message, "boom");
        assert_eq!(result.data.output, "boom");
        assert_eq!(result.data.mute_state, None);
    }

    #[test]
    fn an_unfound_cli_wins_over_every_other_answer() {
        let input = SoundwInput { action: Some(SoundwAction::Profile), profile_name: Some("  ".to_owned()), ..SoundwInput::default() };
        let result = run_soundw(&input, &Stub { output: SoundwProcessOutput::new(0, "x", ""), found: false }, &mut NoopSoundwEventSink);
        assert_eq!(result.message, NOT_INSTALLED_MESSAGE);
        assert!(!result.data.installed, "core.ts:11 reports installed:false");
        assert!(result.data.command.is_empty(), "nothing was planned yet");
    }

    #[test]
    fn the_blank_profile_guard_reports_installed_being_true() {
        // core.ts:19 fails with `{ installed: true }` — the CLI is there, the caller is not.
        let input = SoundwInput {
            action: Some(SoundwAction::Profile),
            profile_name: Some(" ".to_owned()),
            ..SoundwInput::default()
        };
        let result = run_soundw(&input, &Stub { output: SoundwProcessOutput::new(0, "x", ""), found: true }, &mut NoopSoundwEventSink);
        assert_eq!(result.message, PROFILE_NAME_REQUIRED_MESSAGE);
        assert!(result.data.installed);
        assert_eq!(result.data.output, "");
    }
}
