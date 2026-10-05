//! Session-level power actions — blanking the display and starting the screen saver — as host data.
//!
//! Verified target: the macOS arms were measured on this machine while they lived in
//! `packages/nodes/sleept/src/platform.ts` (`pmset displaysleepnow` exits 0 and blanks the panel; `open -a
//! ScreenSaverEngine` returns in ~0.07 s while the engine really starts). The Windows and Linux tables are
//! **stated, not measured**: the Windows host has been unreachable (2026-10-06, `ssh` connect timeout on port
//! 22) and Linux is not a delivery target, so those rows carry a mechanism name and nothing more.
//!
//! ## Why this is a second type and not two more [`crate::power::PowerAction`] variants
//!
//! The five machine states go through `system_shutdown` 4.1.0, which exposes no display or saver arm on any
//! platform, so these two have a different mechanism (a spawned plan) and a different reversibility: neither
//! ends the session nor stops running work, and both are undone by moving a mouse. They also have no `force`
//! axis, which is the second thing [`crate::power::PowerSupport`] spends three per-platform tables on. Folding
//! them into one enum would mean two more booleans plus a `ForceRoute` answer that can only ever be a lie.
//!
//! ## The plan is data because this crate does not spawn
//!
//! [`plan_for`] hands the argv over as a value; [`CommandBackend`] is the one small impl that runs it, written
//! in the same shape as [`crate::power::SystemShutdownBackend`]. The `power` service's arm calls
//! [`request_with`], so the gate, the plan and the classification are the live ones for a real request and for
//! a rehearsal alike — the rehearsal differs only in which backend it is handed.
//!
//! ## Names are the wire contract
//!
//! [`SessionPowerAction::as_str`] spells `display-sleep` and `screensaver` because those are the words the three
//! faces, the node's own vocabulary and the target manifest already use. The host does not rename what a
//! operator picks in a terminal.

use std::io;

use crate::config_paths::Platform;

/// A screen-level action the host can be asked to perform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionPowerAction {
    DisplaySleep,
    Screensaver,
}

impl SessionPowerAction {
    /// The stable spelling, shared with the faces and with the node's word list.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DisplaySleep => "display-sleep",
            Self::Screensaver => "screensaver",
        }
    }

    /// The action a log line or a request argument names.
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        ALL_SESSION_ACTIONS.into_iter().find(|action| action.as_str() == name)
    }
}

/// Every session action the host knows the name of, in the order a face should list them.
pub const ALL_SESSION_ACTIONS: [SessionPowerAction; 2] =
    [SessionPowerAction::DisplaySleep, SessionPowerAction::Screensaver];

/// The child process the host runs for one action on one platform.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionPlan {
    pub program: &'static str,
    pub args: &'static [&'static str],
    /// The mechanism, spelled for a log line in the same voice as `PowerSupport::mechanism`.
    pub mechanism: &'static str,
}

/// One `WM_SYSCOMMAND` broadcast to every window, which is how Windows asks the *session* to power the screen.
///
/// Both Windows arms share this shape and differ only in the message number: `0xF170` with `2` is
/// `SC_MONITORPOWER` (display off) and `0xF140` with `0` is `SC_SCREENSAVE`. The target `-1` is
/// `HWND_BROADCAST`. The command rides as a single argv element, so nothing here is shell-interpolated, and it
/// is the same `powershell.exe` the machine-state arms of this service already have to reach.
const WINDOWS_MONITOR_POWER: &str = "$sig='[System.Runtime.InteropServices.DllImport(\"user32.dll\")]public static extern int SendMessage(int hWnd,int Msg,int wParam,int lParam);'; Add-Type -MemberDefinition $sig -Name SessionPower -Namespace Xiranite; [Xiranite.SessionPower]::SendMessage(-1,0x0112,0xF170,2) | Out-Null";

/// The same broadcast that starts whatever saver the session has configured.
const WINDOWS_SCREEN_SAVER: &str = "$sig='[System.Runtime.InteropServices.DllImport(\"user32.dll\")]public static extern int SendMessage(int hWnd,int Msg,int wParam,int lParam);'; Add-Type -MemberDefinition $sig -Name SessionPower -Namespace Xiranite; [Xiranite.SessionPower]::SendMessage(-1,0x0112,0xF140,0) | Out-Null";

/// What one platform runs for one action, or `None` when nothing here can do it.
#[must_use]
pub fn plan_for(platform: Platform, action: SessionPowerAction) -> Option<SessionPlan> {
    // The annotation is what makes the arms comparable at all: each row writes its own array literal,
    // and the expected slice type is what coerces them into one value.
    let (program, args, mechanism): (&'static str, &'static [&'static str], &'static str) = match (platform, action) {
        // `open` rather than the engine binary, because that binary runs until the user dismisses it and a
        // request that never returns would hold the operation open.
        (Platform::MacOS, SessionPowerAction::DisplaySleep) => ("pmset", &["displaysleepnow"], "pmset-displaysleepnow"),
        (Platform::MacOS, SessionPowerAction::Screensaver) => ("open", &["-a", "ScreenSaverEngine"], "launchservices-screensaverengine"),
        (Platform::Windows, SessionPowerAction::DisplaySleep) => {
            ("powershell.exe", &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", WINDOWS_MONITOR_POWER], "win32-wm-syscommand-monitorpower")
        }
        (Platform::Windows, SessionPowerAction::Screensaver) => {
            ("powershell.exe", &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", WINDOWS_SCREEN_SAVER], "win32-wm-syscommand-screensave")
        }
        (Platform::Linux, SessionPowerAction::DisplaySleep) => ("xset", &["dpms", "force", "off"], "x11-xset-dpms"),
        // There is no portal-backed way to say "start the saver now" on Linux, so the saver's own control
        // command is named rather than dressing up a screen lock as the answer that was asked for.
        (Platform::Linux, SessionPowerAction::Screensaver) => ("xscreensaver-command", &["-activate"], "x11-xscreensaver-command"),
    };
    Some(SessionPlan { program, args, mechanism })
}

/// The session actions this platform has a mechanism for. Derived from [`plan_for`], so deleting a row cannot
/// leave a table that still promises the action.
#[must_use]
pub fn supported_session_actions(platform: Platform) -> Vec<SessionPowerAction> {
    ALL_SESSION_ACTIONS.iter().copied().filter(|action| plan_for(platform, *action).is_some()).collect()
}

/// Why a session action did not happen.
///
/// The codes are the three [`crate::power::PowerError`] shapes that can mean something here. `Denied` is
/// deliberately absent: neither arm needs a permission the operator has to go grant — measured on macOS as an
/// ordinary user, both arms ran without an Automation prompt, which is a different answer from the five machine
/// states whose `osascript` arm does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionPowerError {
    /// This platform has no mechanism for that action.
    NotSupported { action: SessionPowerAction, mechanism: &'static str },
    /// The action exists here but a forced version of it does not, so the face greys the control out.
    ForceUnsupported { action: SessionPowerAction, mechanism: &'static str },
    /// The mechanism said no this time, in its own words.
    Failed { action: SessionPowerAction, message: String },
}

impl SessionPowerError {
    /// The stable code a face switches on, matching the vocabulary `power.request` already answers with.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::NotSupported { .. } => "not-supported",
            Self::ForceUnsupported { .. } => "force-not-supported",
            Self::Failed { .. } => "failed",
        }
    }
}

impl std::fmt::Display for SessionPowerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotSupported { action, mechanism } => {
                write!(formatter, "{mechanism} does not answer {action:?} on this platform")
            }
            Self::ForceUnsupported { action, mechanism } => {
                write!(formatter, "{mechanism} has no forced form for {action:?}; the action runs the same either way")
            }
            Self::Failed { action, message } => write!(formatter, "{action:?} failed: {message}"),
        }
    }
}

impl std::error::Error for SessionPowerError {}

/// How a session action is carried out.
pub trait SessionBackend {
    /// # Errors
    ///
    /// The OS cause, or the child's own words when it ran and refused.
    fn run(&self, plan: &SessionPlan) -> Result<(), io::Error>;
}

/// The real backend: run the plan to completion and treat a non-zero exit as a failure carrying the program's
/// own text, because "the engine is not installed" and "the saver is disabled by policy" are different
/// pictures for a face to draw.
pub struct CommandBackend;

impl SessionBackend for CommandBackend {
    fn run(&self, plan: &SessionPlan) -> Result<(), io::Error> {
        // A spawn failure names the OS cause only (`No such file or directory (os error 2)`), which is useless
        // in a log about a power action unless the program is in the sentence.
        let output = std::process::Command::new(plan.program)
            .args(plan.args)
            .output()
            .map_err(|error| io::Error::new(error.kind(), format!("{} could not start: {error}", plan.program)))?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        Err(io::Error::other(format!(
            "{} {} exited with {}{}",
            plan.program,
            plan.args.join(" "),
            output.status,
            if detail.is_empty() { String::new() } else { format!(": {detail}") }
        )))
    }
}

/// The rehearsal: answers as if the action ran and touches nothing.
///
/// This exists for the same reason [`crate::power::DryRunBackend`] does, and for a measured reason — a request
/// that carried `dryRun: true` to a host without a rehearsal arm was not a rehearsal, and the machine slept.
pub struct DryRunBackend;

impl SessionBackend for DryRunBackend {
    fn run(&self, _plan: &SessionPlan) -> Result<(), io::Error> {
        Ok(())
    }
}

/// Ask `platform` for one session action, carried out through `backend`.
///
/// The platform is a parameter rather than read from the environment, so a test on one machine can state all
/// three tables; [`crate::power::request_with`] keeps the same shape.
///
/// # Errors
///
/// [`SessionPowerError::NotSupported`] when no mechanism exists here, [`SessionPowerError::ForceUnsupported`]
/// when `force` is asked of an action that has no forced form, and [`SessionPowerError::Failed`] with the
/// child's own words when the mechanism refused.
pub fn request_with(
    backend: &dyn SessionBackend,
    platform: Platform,
    action: SessionPowerAction,
    force: bool,
) -> Result<(), SessionPowerError> {
    let Some(plan) = plan_for(platform, action) else {
        return Err(SessionPowerError::NotSupported { action, mechanism: "no session mechanism on this platform" });
    };
    if force {
        // Neither arm has a forced form: the display comes back on input either way, and a saver cannot be
        // started "more forcefully". Answered rather than ignored, because an ignored flag reads as the stronger
        // action having run — the same reasoning `force_route_for` records for the machine states.
        return Err(SessionPowerError::ForceUnsupported { action, mechanism: plan.mechanism });
    }
    backend.run(&plan).map_err(|error| SessionPowerError::Failed { action, message: error.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct Recorder {
        runs: RefCell<Vec<Vec<String>>>,
        fail_with: Option<String>,
    }

    impl SessionBackend for Recorder {
        fn run(&self, plan: &SessionPlan) -> Result<(), io::Error> {
            let mut argv = vec![plan.program.to_string()];
            argv.extend(plan.args.iter().map(|argument| (*argument).to_string()));
            self.runs.borrow_mut().push(argv);
            match &self.fail_with {
                Some(message) => Err(io::Error::other(message.clone())),
                None => Ok(()),
            }
        }
    }

    fn argv_of(recorder: &Recorder) -> Vec<Vec<String>> {
        recorder.runs.borrow().clone()
    }

    #[test]
    fn every_platform_answers_both_session_actions_with_a_named_mechanism() {
        for platform in [Platform::Windows, Platform::MacOS, Platform::Linux] {
            let supported = supported_session_actions(platform);
            assert_eq!(supported, ALL_SESSION_ACTIONS.to_vec(), "{platform:?} owes both arms");
            for action in supported {
                let plan = plan_for(platform, action).unwrap_or_else(|| panic!("{platform:?} listed {action:?} without a plan"));
                assert!(!plan.program.is_empty(), "{platform:?} {action:?} names no program");
                assert!(!plan.mechanism.is_empty(), "{platform:?} {action:?} states no mechanism");
            }
        }
    }

    /// The macOS argv is the pair measured on this machine, and these strings are the whole answer: a silent
    /// edit here is a different action wearing the same name.
    #[test]
    fn the_macos_plans_are_the_two_commands_measured_blanking_the_panel() {
        let display = plan_for(Platform::MacOS, SessionPowerAction::DisplaySleep).expect("macOS has a display arm");
        assert_eq!((display.program, display.args), ("pmset", &["displaysleepnow"][..]));
        let saver = plan_for(Platform::MacOS, SessionPowerAction::Screensaver).expect("macOS has a saver arm");
        assert_eq!((saver.program, saver.args), ("open", &["-a", "ScreenSaverEngine"][..]));
    }

    /// Both Windows arms are one `WM_SYSCOMMAND` broadcast and differ only by the message number. If they ever
    /// become byte-identical, the two arms have collapsed into one action without anyone saying so.
    #[test]
    fn the_windows_arms_differ_only_by_the_syscommand_they_broadcast() {
        let monitor = plan_for(Platform::Windows, SessionPowerAction::DisplaySleep).expect("Windows has a display arm");
        let saver = plan_for(Platform::Windows, SessionPowerAction::Screensaver).expect("Windows has a saver arm");
        assert_eq!(monitor.program, saver.program);
        assert_eq!(&monitor.args[..4], ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"], "the shared flags come first");
        let monitor_command = monitor.args.last().expect("the command is the last element");
        let saver_command = saver.args.last().expect("the command is the last element");
        assert!(monitor_command.contains("0xF170") && monitor_command.contains("SendMessage(-1,0x0112,0xF170,2)"), "SC_MONITORPOWER=2: {monitor_command}");
        assert!(saver_command.contains("SendMessage(-1,0x0112,0xF140,0)"), "SC_SCREENSAVE: {saver_command}");
        assert_ne!(monitor_command, saver_command, "the two arms must not be the same request");
    }

    /// The parse is what the service routes on, and it is the wire vocabulary: an unknown spelling must not be
    /// accepted as some other action.
    #[test]
    fn the_wire_spellings_parse_and_nothing_else_does() {
        assert_eq!(SessionPowerAction::parse("display-sleep"), Some(SessionPowerAction::DisplaySleep));
        assert_eq!(SessionPowerAction::parse("screensaver"), Some(SessionPowerAction::Screensaver));
        assert_eq!(SessionPowerAction::parse("display_sleep"), None, "the faces spell it with a hyphen");
        assert_eq!(SessionPowerAction::parse("sleep"), None, "that is a machine state, not a session action");
    }

    /// A rehearsal is a different backend, not a different gate: the refusal codes and the plan must be the
    /// live ones, or `dryRun` stops meaning anything on the arm it was added to.
    #[test]
    fn the_rehearsal_runs_the_same_gate_and_touches_nothing() {
        request_with(&DryRunBackend, Platform::MacOS, SessionPowerAction::DisplaySleep, false).expect("a rehearsal answers ok");
        let forced = request_with(&DryRunBackend, Platform::MacOS, SessionPowerAction::Screensaver, true)
            .expect_err("a rehearsal of a forced session action is still a refusal");
        assert_eq!(forced.code(), "force-not-supported", "{forced:?}");
    }

    #[test]
    fn a_live_request_hands_the_plan_to_the_mechanism() {
        let recorder = Recorder::default();
        request_with(&recorder, Platform::Linux, SessionPowerAction::DisplaySleep, false).expect("the recorder always accepts");
        let runs = argv_of(&recorder);
        assert_eq!(runs.len(), 1, "{runs:?}");
        assert_eq!(runs[0], vec!["xset".to_string(), "dpms".to_string(), "force".to_string(), "off".to_string()]);
    }

    #[test]
    fn a_child_failure_keeps_its_own_words() {
        let recorder = Recorder { fail_with: Some("The application ScreenSaverEngine cannot be opened.".to_string()), ..Default::default() };
        let error = request_with(&recorder, Platform::MacOS, SessionPowerAction::Screensaver, false).expect_err("the child failed");
        match &error {
            SessionPowerError::Failed { message, .. } => {
                assert!(message.contains("ScreenSaverEngine"), "the cause is kept: {message}");
            }
            other => panic!("expected a failure, got {other:?}"),
        }
        assert_eq!(error.code(), "failed");
    }

    /// The real backend, on a program that cannot exist on any platform. This is the only arm of
    /// [`CommandBackend`] a test can reach without either touching the machine or inventing a fixture binary:
    /// the OS gives a bare `No such file or directory`, so the sentence has to carry the program itself.
    #[test]
    fn a_program_that_cannot_be_started_is_named_in_the_failure() {
        let plan = SessionPlan {
            program: "xiranite-power-session-probe-that-does-not-exist",
            args: &[],
            mechanism: "probe",
        };
        let error = CommandBackend.run(&plan).expect_err("nothing of that name exists");
        let message = error.to_string();
        assert!(message.contains(plan.program), "the refusal names the program: {message}");
        assert_eq!(error.kind(), io::ErrorKind::NotFound, "and it really is the spawn arm: {message}");
    }

    /// The other arm: a program that runs and exits non-zero. `/usr/bin/false` and `cmd.exe /c exit /b 3` are
    /// both present on their platform and both change nothing on the machine, which is what makes the exit-code
    /// text measurable without rehearsing a screen blank.
    #[cfg(any(unix, windows))]
    #[test]
    fn a_non_zero_exit_is_reported_with_the_status_and_the_programs_words() {
        #[cfg(unix)]
        let plan = SessionPlan { program: "/usr/bin/false", args: &[], mechanism: "probe" };
        #[cfg(windows)]
        let plan = SessionPlan { program: "cmd.exe", args: &["/c", "exit /b 3"], mechanism: "probe" };

        let error = CommandBackend.run(&plan).expect_err("the probe exits non-zero by construction");
        let message = error.to_string();
        assert!(message.contains(plan.program), "the refusal names the program: {message}");
        assert!(message.contains("exited with"), "and says it ran and refused rather than could not start: {message}");
    }
}
