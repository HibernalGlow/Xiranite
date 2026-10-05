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
//! ## `ok` on macOS means the request was handed over, not that the machine stopped
//!
//! Measured here on the current host: one live `Sleep` through this path did put the machine to sleep —
//! `pmset -g log` recorded `Entering Sleep state due to 'Software Sleep pid=174'` one second before a
//! keyboard wake, and pid 174 is `loginwindow`, which is the session agent the Apple Event goes through.
//! `shut down`, `restart` and `log out` in the same run all answered `Ok(())` while the machine kept
//! running and no session-end was recorded anywhere. So the answer is a receipt for the *request*, and no
//! amount of reading it can confirm the action. That asymmetry is why [`DryRunBackend`] exists instead of
//! "just try it and see": it is the only way to exercise this routing on a machine that has to stay up.
//!
//! ## `force` is a second axis, and it is not available everywhere
//!
//! [`ForceRoute`] and [`force_route_for`] are that axis. They exist because the upstream crate is not
//! uniform: Windows forces three of the five actions with `EWX_FORCE`, macOS only logout, Linux only the
//! sysrq reboot — and macOS' `force_reboot` is the *Linux* `/proc` write, which is why an unguarded
//! `force: true` on a Mac reported `No such file or directory (os error 2)` as if the machine were broken.
//! A face that renders one "force" row for every platform is offering a control that does nothing.
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

/// What asking for `force` means for one action on one platform.
///
/// This is a separate axis from [`PowerSupport::allows`] because upstream really does have three answers:
/// `system_shutdown` 4.1.0 gives Windows `EWX_FORCE` for shutdown/reboot/logout (`src/windows.rs:134,144,154`),
/// gives macOS a forced logout through `loginwindow` but answers `force_shutdown` with `not_implemented!()`
/// and `force_reboot` with the **Linux** `/proc/sysrq-trigger` write (`src/macos.rs:39,50`), and on Linux
/// leaves only the sysrq reboot (`src/linux.rs:180,285,357`). A face that renders one "force" checkbox for
/// all three platforms is offering a control that either fails or does nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ForceRoute {
    /// The platform has its own forced arm, so `force: true` is a different request, not a decoration.
    Distinct,
    /// No forced arm exists because the action has nothing to force (`sleep`, `hibernate`): the same call
    /// runs either way, so the flag must not be reported as if it were honoured.
    SameCall,
    /// A forced version of this action cannot work here. [`request_on`] refuses on this arm instead of
    /// reaching a mechanism that would answer `No such file or directory (os error 2)`.
    Unavailable,
}

impl ForceRoute {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Distinct => "distinct",
            Self::SameCall => "same-call",
            Self::Unavailable => "unavailable",
        }
    }
}

/// What one platform can do, and how it does it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PowerSupport {
    pub sleep: bool,
    pub hibernate: bool,
    pub shutdown: bool,
    pub reboot: bool,
    pub logout: bool,
    /// Which table this is, so [`PowerSupport::force_route`] can be a method instead of a second lookup
    /// the caller has to derive from the platform itself.
    pub platform: Platform,
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

    /// What `force: true` would do to this action here.
    #[must_use]
    pub const fn force_route(&self, action: PowerAction) -> ForceRoute {
        force_route_for(self.platform, action)
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
            platform,
            mechanism: "win32-shutdown-and-power-apis",
            permission_note: "",
        },
        Platform::MacOS => PowerSupport {
            sleep: true,
            hibernate: false,
            shutdown: true,
            reboot: true,
            logout: true,
            platform,
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
            platform,
            mechanism: "logind-dbus-with-shutdown-command-fallback",
            permission_note: "",
        },
    }
}

/// [`support_for`] with the force axis filled in, which is the one that differs per action rather than
/// per platform, so it is written once here instead of as five more booleans on the table.
#[must_use]
pub const fn force_route_for(platform: Platform, action: PowerAction) -> ForceRoute {
    // Upstream has no forced sleep or hibernate on any platform — `sleep()`/`hibernate()` take no flag —
    // so `force` on those two is the same call, and a face must not present it as a stronger action.
    if matches!(action, PowerAction::Sleep | PowerAction::Hibernate) {
        return ForceRoute::SameCall;
    }
    match platform {
        // `EWX_SHUTDOWN|EWX_REBOOT|EWX_LOGOFF` each gain `EWX_FORCE` (`src/windows.rs:134,144,154`).
        Platform::Windows => ForceRoute::Distinct,
        // Forced logout is `loginwindow «event aevtrlgo»`; forced shutdown is `not_implemented!()` and
        // forced reboot is the crate's Linux sysrq write compiled for macOS (`src/macos.rs:39,50,66`).
        Platform::MacOS => {
            if matches!(action, PowerAction::Logout) {
                ForceRoute::Distinct
            } else {
                ForceRoute::Unavailable
            }
        }
        // Only the sysrq reboot is real; forced shutdown and forced logout are `not_implemented!()`
        // (`src/linux.rs:180,285,357`). The sysrq write still needs root at run time, and that refusal
        // arrives as [`PowerError::Failed`] with the kernel's own words.
        Platform::Linux => {
            if matches!(action, PowerAction::Reboot) {
                ForceRoute::Distinct
            } else {
                ForceRoute::Unavailable
            }
        }
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
    /// The action exists here but a forced version of it does not — so the face greys the checkbox out
    /// rather than the action.
    ForceUnsupported { action: PowerAction, mechanism: &'static str },
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
            Self::ForceUnsupported { action, mechanism } => write!(
                f,
                "the {mechanism:?} power backend has no forced version of {}; the action itself may \
                 still run without force",
                action.as_str()
            ),
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

/// The backend a dry run runs against: it accepts whatever the gates already accepted and changes nothing.
///
/// Deliberately a backend rather than an early `return` in the caller, so a simulated request travels the
/// same gate, routing and classification as a live one and only the mechanism differs. That is what makes
/// the answer worth showing a user: `ok` here means "this machine would take this action", which is the
/// only claim about a power action this crate can honestly verify on a machine it must not power off.
pub struct DryRunBackend;

impl PowerBackend for DryRunBackend {
    fn run(&self, _action: PowerAction, _force: bool) -> io::Result<()> {
        Ok(())
    }
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
    if force && support.force_route(action) == ForceRoute::Unavailable {
        // Without this the caller reaches a mechanism that cannot exist here and gets the kernel's opinion
        // of a missing file instead of the table's opinion of the platform: macOS' `force_reboot` writes
        // `/proc/sysrq-trigger`, which is the Linux arm compiled for the wrong machine.
        return Err(PowerError::ForceUnsupported { action, mechanism: support.mechanism });
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

    /// The whole force matrix, stated in one place so a future platform cannot silently inherit Windows.
    #[test]
    fn the_force_axis_is_stated_for_every_platform_and_action() {
        for platform in [Platform::Windows, Platform::MacOS, Platform::Linux] {
            for action in ALL_ACTIONS {
                let route = force_route_for(platform, action);
                if matches!(action, PowerAction::Sleep | PowerAction::Hibernate) {
                    assert_eq!(route, ForceRoute::SameCall, "{platform:?} {action:?} has no forced arm upstream");
                }
            }
        }
        // Each platform's set of forceable actions is its own, read off the upstream source: Windows has
        // three, macOS and Linux two and one, and the two non-Windows sets are not the same pair.
        let distinct = |platform: Platform| {
            ALL_ACTIONS
                .into_iter()
                .filter(|action| force_route_for(platform, *action) == ForceRoute::Distinct)
                .map(PowerAction::as_str)
                .collect::<Vec<_>>()
        };
        assert_eq!(distinct(Platform::Windows), ["shutdown", "reboot", "logout"]);
        assert_eq!(distinct(Platform::MacOS), ["logout"]);
        assert_eq!(distinct(Platform::Linux), ["reboot"]);
    }

    #[test]
    fn a_forced_action_the_platform_cannot_do_is_refused_before_the_mechanism_runs() {
        // macOS is the case that produced a real wrong answer: `force_reboot` there is upstream's Linux
        // sysrq write, so without this gate the caller saw an os error instead of the table's opinion.
        let recorder = Recorder::ok();
        let error = request_on(&recorder, support_for(Platform::MacOS), PowerAction::Reboot, true)
            .expect_err("macOS has no forced reboot");
        assert!(matches!(error, PowerError::ForceUnsupported { action: PowerAction::Reboot, .. }), "{error}");
        assert!(error.to_string().contains("without force"), "the refusal must say the action itself is fine: {error}");
        assert_eq!(recorder.calls.get(), 0, "a refused force must not run the unforced arm either");

        // The same action without the flag is a different answer, so this is a gate on `force` alone.
        request_on(&recorder, support_for(Platform::MacOS), PowerAction::Reboot, false).unwrap();
        assert_eq!(recorder.calls.get(), 1);
        // And macOS does have one forced action, so the gate is not a blanket refusal of the flag.
        request_on(&recorder, support_for(Platform::MacOS), PowerAction::Logout, true).unwrap();
        assert!(recorder.last_force.get(), "the flag travels to the arm that has one");
    }

    /// A dry run travels the same gates as a live request and differs in exactly one place: the mechanism.
    #[test]
    fn a_dry_run_answers_the_gates_without_reaching_a_mechanism() {
        let support = support();
        for action in ALL_ACTIONS {
            let outcome = request_on(&DryRunBackend, support, action, false);
            if support.allows(action) {
                assert!(outcome.is_ok(), "{action:?} is supported here and must simulate: {outcome:?}");
            } else {
                assert!(
                    matches!(outcome, Err(PowerError::NotSupported { .. })),
                    "{action:?} is missing here, so a simulation must refuse too: {outcome:?}"
                );
            }
        }
        // The control that makes the loop above a measurement rather than a formality: a backend that
        // answers like a real mechanism would, run live, does not produce this answer.
        let failing = Recorder::failing("the mechanism said no");
        let Some(action) = support.supported_actions().first().copied() else { return };
        request_on(&DryRunBackend, support, action, false).expect("dry run ignores the mechanism");
        let live = request_on(&failing, support, action, false).expect_err("the recorder fails");
        assert!(matches!(live, PowerError::Failed { .. }), "{live}");
        assert_eq!(failing.calls.get(), 1, "only the live call reached a backend");
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
