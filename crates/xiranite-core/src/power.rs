//! Power actions (sleep / hibernate / shutdown / reboot / logout) as a host capability.
//!
//! Verified targets: macOS for the **answers** (`support()` and the `-1743`/Automation refusal mapping were
//! read here); no machine on this network was asked to sleep, hibernate or shut down, so the actions
//! themselves are unexercised on every target. `x86_64-pc-windows-msvc` and `x86_64-unknown-linux-gnu` are
//! **compile-verified only**, through the `#[path]` probe crate described in [`crate::clipboard`] — whose
//! sensitivity was proven by planting a `#[cfg(windows)]` type error, turning that target red while Linux
//! stayed green.
//!
//! ## Why the host owns this
//!
//! `sleept` reached these through `powershell.exe` on Windows (`Stop-Computer`, `rundll32.exe
//! powrprof.dll,SetSuspendState`) and `osascript` on macOS, with no POSIX arm at all. Those are exactly
//! the call sites the grant audit refused to sign: an interpreter on a node's allowlist hands the node a
//! script runner, and `DangerGate` sits on the registration point to prevent precisely that. The action
//! is also the least node-shaped thing in the product — it is the machine changing state, not a node
//! transforming data — so it belongs behind one host entry with one confirmation path.
//!
//! ## The ceiling is per platform, and it is answered before the machine is touched
//!
//! `system_shutdown` 4.1.0 exposes all eight functions on all three platforms, but macOS' `hibernate()`
//! is `#[doc(hidden)]` and returns the crate's `not_implemented!()` error
//! (`system_shutdown-4.1.0/src/macos.rs:77`) — it compiles and fails at runtime. So [`support_for`]
//! refuses `Hibernate` on macOS in the gate, and [`classify`] still maps that upstream error text to the
//! same answer as a backstop. A face that renders this table gets a greyed-out row with a reason instead
//! of a button that fails after the user pressed it.
//!
//! ## macOS needs an Automation grant, and that is a distinct answer
//!
//! Every macOS arm of the crate shells to `osascript -e 'tell application "System Events" to …'`, and
//! the crate's own comment says the first call prompts for permission
//! (`system_shutdown-4.1.0/src/macos.rs:25-27`). A refusal comes back as `io::ErrorKind::Other` carrying
//! AppleScript's stderr, whose signature is error `-1743` / "Not authorized to send Apple events". That
//! is not a failure to retry blindly — the user has to grant it in System Settings, and for an ad-hoc
//! signed build the grant is tied to the binary, so a rebuild drops it. [`PowerError::Denied`] exists so
//! the face can say that instead of "something went wrong".
//!
//! ## Nothing here runs on a test machine
//!
//! [`request_with`] takes a [`PowerBackend`] trait; the tests inject a recorder. The real backend exists
//! in one small `impl` and is never called from this module's own tests, because "verify the shutdown
//! path" and "shut the machine down" are not the same sentence.

use std::io;

use crate::config_paths::Platform;

/// A state change the host can be asked to perform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerAction {
    Sleep,
    Hibernate,
    Shutdown,
    Reboot,
    Logout,
}

impl PowerAction {
    /// The stable spelling a log line or a UI row uses. One vocabulary, three faces.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Sleep => "sleep",
            Self::Hibernate => "hibernate",
            Self::Shutdown => "shutdown",
            Self::Reboot => "reboot",
            Self::Logout => "logout",
        }
    }
}

/// Every action the host recognises, in the order a face should list them.
pub const ALL_ACTIONS: [PowerAction; 5] = [
    PowerAction::Sleep,
    PowerAction::Hibernate,
    PowerAction::Shutdown,
    PowerAction::Reboot,
    PowerAction::Logout,
];

/// What one platform can do, and how it does it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PowerSupport {
    pub sleep: bool,
    pub hibernate: bool,
    pub shutdown: bool,
    pub reboot: bool,
    pub logout: bool,
    /// The mechanism the real backend uses, spelled for an operator reading a log.
    pub mechanism: &'static str,
    /// Non-empty when the platform can refuse for a reason the user has to fix by hand.
    pub permission_note: &'static str,
}

impl PowerSupport {
    /// Is this action available here? The gate [`request_with`] consults before anything runs.
    #[must_use]
    pub const fn allows(&self, action: PowerAction) -> bool {
        match action {
            PowerAction::Sleep => self.sleep,
            PowerAction::Hibernate => self.hibernate,
            PowerAction::Shutdown => self.shutdown,
            PowerAction::Reboot => self.reboot,
            PowerAction::Logout => self.logout,
        }
    }

    /// Actions this platform answers, as a list a face can iterate without re-deriving the booleans.
    #[must_use]
    pub fn supported_actions(&self) -> Vec<PowerAction> {
        ALL_ACTIONS.iter().copied().filter(|action| self.allows(*action)).collect()
    }
}

/// The table for a named platform. Pure: a test on one machine can state all three.
#[must_use]
pub const fn support_for(platform: Platform) -> PowerSupport {
    match platform {
        Platform::Windows => PowerSupport {
            sleep: true,
            hibernate: true,
            shutdown: true,
            reboot: true,
            logout: true,
            mechanism: "win32-shutdown-and-power-apis",
            permission_note: "",
        },
        Platform::MacOS => PowerSupport {
            sleep: true,
            hibernate: false,
            shutdown: true,
            reboot: true,
            logout: true,
            mechanism: "osascript-system-events",
            permission_note: "requires the Automation grant for System Events; an ad-hoc signed build \
                 loses it on every rebuild",
        },
        Platform::Linux => PowerSupport {
            sleep: true,
            hibernate: true,
            shutdown: true,
            reboot: true,
            logout: true,
            mechanism: "logind-dbus-with-shutdown-command-fallback",
            permission_note: "",
        },
    }
}

/// The table for the machine this binary is running on.
#[must_use]
pub fn support() -> PowerSupport {
    support_for(crate::config_paths::PathContext::from_environment().platform)
}

/// Why a power action did not happen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PowerError {
    /// This platform does not answer that action. The gate says so before the mechanism runs.
    NotSupported { action: PowerAction, mechanism: &'static str },
    /// The OS refused because the user has not granted it — retrying without a grant never works.
    Denied { action: PowerAction, message: String },
    /// Anything else, with the mechanism's own text.
    Failed { action: PowerAction, message: String },
}

impl std::fmt::Display for PowerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotSupported { action, mechanism } => {
                write!(f, "the {mechanism:?} power backend does not support {}", action.as_str())
            }
            Self::Denied { action, message } => write!(
                f,
                "{} was refused by the system, usually for a missing permission grant: {message}",
                action.as_str()
            ),
            Self::Failed { action, message } => {
                write!(f, "{} failed: {}", action.as_str(), message)
            }
        }
    }
}

impl std::error::Error for PowerError {}

/// The machine-side half, so a test can watch routing without changing state.
pub trait PowerBackend {
    /// Perform the action. `force` skips the "ask running apps first" step where the platform has one.
    ///
    /// Implementations return the mechanism's own error; [`classify`] turns it into a [`PowerError`].
    fn run(&self, action: PowerAction, force: bool) -> io::Result<()>;
}

/// The real backend: `system_shutdown`, dispatched by [`PowerAction`].
pub struct SystemShutdownBackend;

impl PowerBackend for SystemShutdownBackend {
    fn run(&self, action: PowerAction, force: bool) -> io::Result<()> {
        use system_shutdown as api;
        match (action, force) {
            (PowerAction::Sleep, _) => api::sleep(),
            (PowerAction::Hibernate, _) => api::hibernate(),
            (PowerAction::Shutdown, false) => api::shutdown(),
            (PowerAction::Shutdown, true) => api::force_shutdown(),
            (PowerAction::Reboot, false) => api::reboot(),
            (PowerAction::Reboot, true) => api::force_reboot(),
            (PowerAction::Logout, false) => api::logout(),
            (PowerAction::Logout, true) => api::force_logout(),
        }
    }
}

/// Ask the running machine to perform an action, through the real backend.
pub fn request(action: PowerAction) -> Result<(), PowerError> {
    request_with(&SystemShutdownBackend, action, false)
}

/// The whole policy, with the mechanism injected: gate on the table, then run, then classify.
pub fn request_with(
    backend: &dyn PowerBackend,
    action: PowerAction,
    force: bool,
) -> Result<(), PowerError> {
    request_on(backend, support(), action, force)
}

/// [`request_with`] with an explicit support table, so a test can state a machine it is not standing on.
pub fn request_on(
    backend: &dyn PowerBackend,
    support: PowerSupport,
    action: PowerAction,
    force: bool,
) -> Result<(), PowerError> {
    if !support.allows(action) {
        return Err(PowerError::NotSupported { action, mechanism: support.mechanism });
    }
    backend.run(action, force).map_err(|error| classify(error, action))
}

/// Turn the mechanism's error into the answer a face can act on.
#[must_use]
pub fn classify(error: io::Error, action: PowerAction) -> PowerError {
    let message = error.to_string();
    if error.kind() == io::ErrorKind::Unsupported || message.contains("feature not implemented yet") {
        // `system_shutdown` reports its own unimplemented arms as `Other` + this sentence
        // (`system_shutdown-4.1.0/src/lib.rs:42`), with no mechanism name attached, so the field says
        // where the answer came from rather than pretending the support table produced it.
        return PowerError::NotSupported { action, mechanism: "backend-reported" };
    }
    // macOS answers an Automation refusal as a plain `Other` error carrying AppleScript's stderr, whose
    // only signatures are the -1743 code and this sentence. Matching both so a phrasing change in a
    // future macOS does not turn a grant problem back into a generic failure.
    if message.contains("-1743") || message.contains("Not authorized to send Apple events") {
        return PowerError::Denied { action, message };
    }
    PowerError::Failed { action, message }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// Records what routing decided, and answers with a canned error when the test wants one.
    struct Recorder {
        calls: Cell<usize>,
        last_action: std::cell::RefCell<Option<PowerAction>>,
        last_force: Cell<bool>,
        fail_with: Option<io::Error>,
    }

    impl Recorder {
        fn ok() -> Self {
            Self {
                calls: Cell::new(0),
                last_action: std::cell::RefCell::new(None),
                last_force: Cell::new(false),
                fail_with: None,
            }
        }

        fn failing(message: &str) -> Self {
            Self { fail_with: Some(io::Error::other(message)), ..Self::ok() }
        }
    }

    impl PowerBackend for Recorder {
        fn run(&self, action: PowerAction, force: bool) -> io::Result<()> {
            self.calls.set(self.calls.get() + 1);
            *self.last_action.borrow_mut() = Some(action);
            self.last_force.set(force);
            match &self.fail_with {
                Some(error) => Err(io::Error::new(error.kind(), error.to_string())),
                None => Ok(()),
            }
        }
    }

    #[test]
    fn every_action_is_answered_somewhere_and_the_tables_differ_where_they_must() {
        let windows = support_for(Platform::Windows);
        let macos = support_for(Platform::MacOS);
        let linux = support_for(Platform::Linux);
        for action in ALL_ACTIONS {
            assert!(
                windows.allows(action) && linux.allows(action),
                "{action:?} must be reachable on the release gate and on freedesktop"
            );
        }
        assert!(macos.allows(PowerAction::Sleep), "macOS sleeps through System Events");
        assert!(!macos.allows(PowerAction::Hibernate), "macOS hibernate is not_implemented!() upstream");
        assert_ne!(macos.supported_actions(), linux.supported_actions());
        assert_eq!(windows.supported_actions().len(), ALL_ACTIONS.len());
    }

    #[test]
    fn an_action_the_platform_lacks_is_refused_before_the_mechanism_runs() {
        let recorder = Recorder::ok();
        let error = request_on(&recorder, support_for(Platform::MacOS), PowerAction::Hibernate, false)
            .expect_err("macOS has no hibernate");
        assert!(matches!(error, PowerError::NotSupported { action: PowerAction::Hibernate, .. }), "{error}");
        assert!(error.to_string().contains("osascript-system-events"), "{error}");
        // The whole point of the gate: nothing reached the backend, so nothing could change state.
        assert_eq!(recorder.calls.get(), 0, "a refused action must not touch the mechanism");
    }

    #[test]
    fn an_allowed_action_reaches_the_mechanism_with_the_force_flag_it_asked_for() {
        for force in [false, true] {
            let recorder = Recorder::ok();
            request_on(&recorder, support_for(Platform::Windows), PowerAction::Reboot, force).unwrap();
            assert_eq!(recorder.calls.get(), 1, "force={force} must run exactly once");
            assert_eq!(*recorder.last_action.borrow(), Some(PowerAction::Reboot));
            assert_eq!(recorder.last_force.get(), force, "the force flag is the caller's, not the gate's");
        }
    }

    #[test]
    fn an_automation_refusal_is_a_distinct_answer_from_a_generic_failure() {
        // Verbatim shape of what `osascript` writes when the Automation grant is missing.
        let denial = "24:52: execution error: \"System Events\" got an error: Not authorized to send \
             Apple events to System Events. (-1743)";
        let classified = classify(io::Error::other(denial), PowerAction::Sleep);
        assert!(matches!(classified, PowerError::Denied { action: PowerAction::Sleep, .. }), "{classified}");
        assert!(classified.to_string().contains("-1743"), "{classified}");

        let recorder = Recorder::failing(denial);
        let error = request_on(&recorder, support_for(Platform::MacOS), PowerAction::Sleep, false)
            .expect_err("the grant is missing");
        assert!(matches!(error, PowerError::Denied { .. }), "{error}");
        assert_eq!(recorder.calls.get(), 1, "the backend did run, and the refusal came back from it");

        // A phrasing change that keeps only the numeric code still reads as a denial, not a failure.
        assert!(matches!(
            classify(io::Error::other("(-1743)"), PowerAction::Logout),
            PowerError::Denied { .. }
        ));
    }

    #[test]
    fn the_upstream_not_implemented_error_still_reads_as_unsupported() {
        let classified = classify(
            io::Error::other("feature not implemented yet"),
            PowerAction::Hibernate,
        );
        assert!(
            matches!(classified, PowerError::NotSupported { action: PowerAction::Hibernate, .. }),
            "{classified}"
        );
        assert!(matches!(
            classify(io::Error::new(io::ErrorKind::Unsupported, "nope"), PowerAction::Sleep),
            PowerError::NotSupported { .. }
        ));
    }

    #[test]
    fn a_real_failure_keeps_its_own_words() {
        let classified = classify(io::Error::other("logind refused: auth required"), PowerAction::Shutdown);
        match classified {
            PowerError::Failed { action, message } => {
                assert_eq!(action, PowerAction::Shutdown);
                assert!(message.contains("auth required"), "{message}");
            }
            other => panic!("expected Failed, got {other}"),
        }
    }

    #[test]
    fn the_running_machine_has_a_named_mechanism() {
        let support = support();
        assert!(!support.mechanism.is_empty());
        if cfg!(target_os = "macos") {
            assert_eq!(support.mechanism, "osascript-system-events");
            assert!(support.permission_note.contains("Automation"), "macOS must disclose the grant");
        } else {
            assert!(support.permission_note.is_empty(), "only macOS has this prompt");
        }
    }
}
