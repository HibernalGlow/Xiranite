//! The one place this crate hands a `NodeHost` across the QuickJS boundary.
//!
//! ## Why a plain borrow does not do this job
//!
//! A host call has to be reachable from two places that outlive any borrow the compiler can name:
//! the JS callbacks installed on `globalThis.__xrh` (rquickjs keeps the closure inside the JS
//! function object, which lives as long as the *context*, not as long as the scope that created it),
//! and the engine's interrupt handler, which rquickjs requires to be `'static`.
//!
//! Capturing the real borrow was tried first and does not compile. Closures handed to
//! [`rquickjs::Function::new`] are bounded by the context's own late-bound lifetime, and
//! `Rc<RefCell<Option<&'a mut dyn NodeHost>>>` is *invariant* in `'a` (through `RefCell`), so `'a`
//! cannot be shortened to that lifetime — rustc answers "borrowed value does not live long enough,
//! argument requires that `host` is borrowed for `'static`". Raw pointer plus guard is the normal
//! shape for exactly this case, and it is confined to one method.
//!
//! ## The invariant
//!
//! [`HostSlot::install`] is the only writer, and it takes `&'host mut dyn NodeHost` by move: while
//! the returned guard is alive no other `&mut` to the host exists anywhere in the program, because
//! the guard holds it. [`HostSlot::with_host`] is the only reader and hands the reference to a
//! closure, so it dies at the end of each call and two can never overlap. The guard's `Drop` clears
//! the pointer, so anything that outlives the run reads "no host" instead of a dangling address.
//! JS is only entered from inside the run scope, so every callback that reaches the host does so
//! while the guard is alive.
//!
//! ## The one lifetime-bound erase, and why it is unavoidable
//!
//! The seam writes `host: &mut dyn NodeHost`, and in that position the trait object's lifetime bound
//! defaults to the *borrow's* region — `&'a mut (dyn NodeHost + 'a)`. A `'static`-bounded slot is
//! what the callbacks need, and the conversion cannot be a cast: `*mut T` and `&mut T` are both
//! invariant in `T`, so extending the bound is refused (rustc even points at
//! rust-lang/rust#141402 for exactly this). Shortening it — handing a callback a
//! `&mut (dyn NodeHost + 'static)` where the seam's own bound would be shorter — is refused for the
//! same reason.
//!
//! So the bound is erased once, in [`erase_bound`], by a layout-identical transmute: both types are
//! the same fat pointer to the same trait's vtable, differing only in a parameter that does not
//! exist at run time. Soundness rests on the guard above, not on the bound: the address is only
//! dereferenced while a live `Installed` keeps the original borrow alive, and the object it points at
//! is a value the caller owns for the duration of the run.
//!
//! If `crates/xiranite-node-registry/src/host_seam.rs` ever writes `host: &mut (dyn NodeHost +
//! 'static)` in `BuiltInNode::run` (which every host in this repository satisfies, since
//! `NativeNodeHost` is built from `Arc` state), this function becomes an ordinary coercion and the
//! transmute goes away. That is the change worth making upstream; it is recorded in the task report
//! rather than done here, because that file is not this crate's to edit.

use std::marker::PhantomData;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use xiranite_node_registry::NodeHost;

/// A host pointer readable from any clone of the slot.
#[derive(Clone, Default)]
pub(crate) struct HostSlot {
    /// `None` outside a run; the only non-`None` window is one [`HostSlot::install`] guard.
    host: Arc<Mutex<Option<*mut (dyn NodeHost + 'static)>>>,
}

/// Erases only the trait object's lifetime bound; see the module header.
///
/// # Safety
///
/// The two pointer types have the same size and layout by construction: same trait, same vtable, and
/// a lifetime parameter that the compiler erases. Nothing about the pointee changes.
#[must_use]
fn erase_bound<'a>(raw: *mut (dyn NodeHost + 'a)) -> *mut (dyn NodeHost + 'static) {
    // SAFETY: a lifetime-only difference, so `transmute` is a no-op reinterpretation of the same two
    // words. The invariant that makes the *result* usable is `HostSlot`'s guard, documented above.
    unsafe { std::mem::transmute::<*mut (dyn NodeHost + 'a), *mut (dyn NodeHost + 'static)>(raw) }
}

impl HostSlot {
    #[must_use]
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Publishes `host` for the duration of the returned guard.
    pub(crate) fn install<'host>(&self, host: &'host mut dyn NodeHost) -> Installed<'host> {
        let raw: *mut (dyn NodeHost + 'static) = erase_bound(host);
        *self.lock() = Some(raw);
        Installed {
            slot: self.clone(),
            _borrow: PhantomData,
        }
    }

    /// Runs `f` against the host, or returns `None` when no run scope currently holds it.
    ///
    /// # Safety
    ///
    /// This is the crate's only `unsafe` deref, and the argument is the invariant in the module
    /// header: the address was written by [`Self::install`] from a live `&'host mut dyn NodeHost`
    /// that the matching [`Installed`] guard keeps borrowed for its whole existence and nulls on
    /// drop, so while `is_installed()` holds the address is a valid, uniquely owned host. The
    /// reference is confined to `f`, which is what makes overlapping borrows impossible rather than
    /// merely unlikely.
    pub(crate) fn with_host<R>(&self, f: impl FnOnce(&mut (dyn NodeHost + 'static)) -> R) -> Option<R> {
        let raw = *self.lock();
        // No run scope owns a host right now, so the call is a refusal rather than a dangling read.
        let raw = raw?;
        // SAFETY: see the method doc; `raw` is the address of the host a live guard borrowed.
        Some(unsafe { f(&mut *raw) })
    }

    /// Whether a run scope currently owns the pointer. Test-facing: `with_host` already answers
    /// `None` when it does not, so production code has nothing to check separately.
    #[cfg(test)]
    #[must_use]
    pub(crate) fn is_installed(&self) -> bool {
        self.lock().is_some()
    }

    fn lock(&self) -> MutexGuard<'_, Option<*mut (dyn NodeHost + 'static)>> {
        // A poisoned lock means a node callback panicked mid-run. The pointer is the whole
        // invariant and it is still correct, so recovering the data keeps one bad node from taking
        // the host process down with a `unwrap()` panic.
        self.host.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The borrow that keeps a [`HostSlot`] installed.
#[must_use = "dropping the guard immediately uninstalls the host, so no run could reach it"]
pub(crate) struct Installed<'host> {
    slot: HostSlot,
    _borrow: PhantomData<&'host mut dyn NodeHost>,
}

impl Installed<'_> {
    /// The slot to hand to the JS callbacks, the interrupt handler and the pump loop.
    #[must_use]
    pub(crate) fn slot(&self) -> &HostSlot {
        &self.slot
    }
}

impl Drop for Installed<'_> {
    fn drop(&mut self) {
        *self.slot.lock() = None;
    }
}

#[cfg(test)]
mod tests {
    use super::HostSlot;
    use crate::test_host::CountingHost;
    use xiranite_node_registry::NodeHost;

    #[test]
    fn the_slot_answers_only_while_a_guard_owns_the_host() {
        let slot = HostSlot::new();
        assert!(!slot.is_installed(), "a fresh slot must not claim a host");
        assert!(
            slot.with_host(|host| host.now()).is_none(),
            "reading an uninstalled slot must be a refusal, not a panic"
        );

        let mut host = CountingHost::new();
        {
            let installed = slot.install(&mut host as &mut dyn NodeHost);
            assert!(installed.slot().is_installed(), "positive control: install wrote nothing");
            assert!(installed.slot().with_host(|host| host.now().is_ok()).unwrap_or(false));
        }
        // The assertion above is what makes the two below mean something: without it, `is_none()`
        // would also pass had `install` never published anything at all.
        assert!(!slot.is_installed(), "the guard must clear the pointer on drop");
        assert!(slot.with_host(|host| host.now()).is_none());
    }
}
