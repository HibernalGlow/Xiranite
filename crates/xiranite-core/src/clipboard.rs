//! The system clipboard as a host capability.
//!
//! ## Why the host owns this
//!
//! Sixteen-plus nodes asked the machine the same question by spawning a shell:
//! `powershell.exe -Command Get-Clipboard -Raw` on Windows, `pbpaste` on macOS, `wl-paste`/`xclip`/
//! `xsel` on Linux — each with its own quoting and each swallowing failures into `""`. The registry
//! audit that produced the current grant table named those lines as the reason the nodes could not be
//! granted a `proc.exec` allowlist: an interpreter is not a program grant, so putting `powershell.exe`
//! on a node's allowlist hands the node a script runner (ADR-0074's `DangerGate` sits on the
//! registration point precisely to avoid that). Moving the question here removes the need for the
//! grant, the shell, and the per-node platform branch at once.
//!
//! ## Failure shapes this module refuses to produce
//!
//! A clipboard that cannot be opened answers [`ClipboardError::Unavailable`], never
//! `Ok(String::new())`. The shell paths answered `""` for "no display server", "nothing copied" and
//! "the helper crashed" alike, so a headless start was indistinguishable from a user who had copied
//! nothing. A clipboard that *is* reachable but holds no text answers [`ClipboardError::NoText`] — a
//! distinct shape, so a node can reproduce the old `""` behaviour on purpose instead of by accident.
//!
//! ## One handle per thread
//!
//! `arboard::Clipboard` is neither `Send` nor `Sync` (Wayland makes that a hard constraint), and a run
//! is driven by one pump thread for its whole life — the same fact `czkawka_operations` relies on for
//! its session table. So the handle lives in thread-local storage and is reused; a construction failure
//! is not cached, so a headless start followed by a display arriving is recoverable.

use std::cell::RefCell;

use arboard::{Clipboard, Error};

/// The largest clipboard text one call may carry.
///
/// `arboard` has no capped read, so the size is checked after the fact and the text refused rather than
/// handed over — a node that pipes a 2 GiB clipboard into a realm string has exceeded its byte budget,
/// and the budget should speak (`NodeRequirements`' byte half), not the allocator.
pub const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;

/// Why a clipboard call did not happen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClipboardError {
    /// This machine has no usable clipboard (no display server, unsupported session). Both directions
    /// answer this together, so a caller never sees "write works, read is broken".
    Unavailable { message: String },
    /// The clipboard is reachable but holds no text content — an image, or nothing at all. A node that
    /// wants the old shell behaviour maps this to `""` here, explicitly.
    NoText,
    /// Another process holds the clipboard. Retrying is the caller's business.
    Occupied,
    /// The text is over [`MAX_TEXT_BYTES`], counted in bytes rather than characters.
    TooLarge { bytes: usize, limit: usize },
    /// Anything else the backend said, verbatim.
    Failed { message: String },
}

impl std::fmt::Display for ClipboardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable { message } => write!(f, "no clipboard available: {message}"),
            Self::NoText => write!(f, "the clipboard holds no text content"),
            Self::Occupied => write!(f, "the clipboard is held by another process"),
            Self::TooLarge { bytes, limit } => {
                write!(f, "clipboard text is {bytes} bytes, over the {limit} byte ceiling")
            }
            Self::Failed { message } => f.write_str(message),
        }
    }
}

impl std::error::Error for ClipboardError {}

thread_local! {
    static CLIPBOARD: RefCell<Option<Clipboard>> = const { RefCell::new(None) };
}

/// Runs `f` against this thread's clipboard handle, opening it on first use.
fn with_clipboard<R>(
    f: impl FnOnce(&mut Clipboard) -> Result<R, Error>,
) -> Result<R, ClipboardError> {
    CLIPBOARD
        .try_with(|slot| {
            let mut borrowed = slot.borrow_mut();
            if borrowed.is_none() {
                *borrowed = Some(Clipboard::new().map_err(describe)?);
            }
            let handle = borrowed.as_mut().expect("just opened a handle above");
            f(handle).map_err(describe)
        })
        .map_err(|_gone| ClipboardError::Unavailable {
            message: "the clipboard handle belongs to a thread that has ended".to_string(),
        })?
}

/// The text on the clipboard, or [`ClipboardError::NoText`] when it holds something that is not text.
pub fn read_text() -> Result<String, ClipboardError> {
    let text = with_clipboard(Clipboard::get_text)?;
    let bytes = text.len();
    if bytes > MAX_TEXT_BYTES {
        return Err(ClipboardError::TooLarge { bytes, limit: MAX_TEXT_BYTES });
    }
    Ok(text)
}

/// Replace the clipboard text.
pub fn write_text(text: &str) -> Result<(), ClipboardError> {
    let bytes = text.len();
    if bytes > MAX_TEXT_BYTES {
        return Err(ClipboardError::TooLarge { bytes, limit: MAX_TEXT_BYTES });
    }
    with_clipboard(|clipboard| clipboard.set_text(text.to_string()))
}

fn describe(error: Error) -> ClipboardError {
    match error {
        Error::ContentNotAvailable => ClipboardError::NoText,
        Error::ClipboardNotSupported => ClipboardError::Unavailable {
            message: "this platform session has no clipboard".to_string(),
        },
        Error::ClipboardOccupied => ClipboardError::Occupied,
        other => ClipboardError::Failed { message: format!("{other}") },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Puts a value on the clipboard and puts the previous one back, even if the body panics.
    ///
    /// This test suite writes to the user's real clipboard because there is no other way to prove the
    /// backend works; without the restore it would leave a probe string behind on every run.
    struct Guard {
        previous: Option<String>,
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() {
                // A failing restore is not worth a second panic on top of the first.
                let _ = write_text(&previous);
            }
        }
    }

    #[test]
    fn the_two_directions_agree_about_whether_a_clipboard_exists() {
        let sentinel = format!("xiranite-clipboard-probe-{}", std::process::id());
        // Read first: the value to put back has to be captured before anything is written. If the
        // clipboard held a non-text item this answers `NoText`, so there is nothing to restore — the
        // probe replaces it, which is the same visible effect as the `pbpaste` path it stands in for.
        let previous = read_text().ok();
        match write_text(&sentinel) {
            Ok(()) => {
                let _guard = Guard { previous };
                assert_eq!(read_text().expect("write worked, so read must too"), sentinel);
            }
            Err(ClipboardError::Unavailable { .. }) => {
                assert!(
                    matches!(read_text(), Err(ClipboardError::Unavailable { .. })),
                    "write says there is no clipboard, so read must not claim one"
                );
            }
            Err(other) => panic!("unexpected write failure: {other}"),
        }
    }

    #[test]
    fn an_unreachable_clipboard_is_not_the_same_answer_as_one_holding_no_text() {
        let no_text = describe(Error::ContentNotAvailable);
        let absent = describe(Error::ClipboardNotSupported);
        assert_eq!(no_text, ClipboardError::NoText);
        assert_ne!(no_text, absent);
        assert!(absent.to_string().contains("no clipboard available"), "{absent}");
        assert!(no_text.to_string().contains("no text content"), "{no_text}");
    }

    #[test]
    fn oversized_text_is_refused_before_it_reaches_a_realm() {
        let error = ClipboardError::TooLarge { bytes: MAX_TEXT_BYTES + 1, limit: MAX_TEXT_BYTES };
        assert!(error.to_string().contains("4194304"), "{error}");

        // The guard is the real function's, so build a document just over the ceiling and let it check.
        // Allocating 4 MiB once in a unit test is cheaper than trusting a constant nobody called.
        let huge = "x".repeat(MAX_TEXT_BYTES + 1);
        match write_text(&huge) {
            Err(ClipboardError::TooLarge { bytes, limit }) => {
                assert_eq!(bytes, MAX_TEXT_BYTES + 1);
                assert_eq!(limit, MAX_TEXT_BYTES);
            }
            other => panic!("oversized write must be refused, got {other:?}"),
        }
    }

    #[test]
    fn the_backend_shapes_that_a_caller_has_to_act_on_are_not_flattened() {
        assert_eq!(describe(Error::ClipboardOccupied), ClipboardError::Occupied);
        assert!(matches!(
            describe(Error::ClipboardNotSupported),
            ClipboardError::Unavailable { .. }
        ));
        let failed = describe(Error::Unknown { description: "wayland not running".into() });
        assert!(failed.to_string().contains("wayland not running"), "{failed}");
    }
}
