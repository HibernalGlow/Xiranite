//! The focus ring, with the exact arithmetic the legacy session uses.
//!
//! Copied from `packages/cli-runtime/src/tui/session.ts` (`moveFocus`) rather than re-derived: a TUI port that
//! "wraps differently" is felt immediately by anyone who used the old screen, and the difference is invisible
//! to any check that only looks at the current build. The rules that matter and are asserted below:
//!
//! - no controls at all → the focus does not move;
//! - nothing focused (or a focus id that is no longer offered) → `Forward` lands on the first control,
//!   `Backward` on the last one;
//! - otherwise the index wraps modulo the count in both directions.

/// The ring direction `session.moveFocus(controlIds, ±1)` takes as its second argument.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Forward,
    Backward,
}

impl Direction {
    /// The signed step, kept public because a node's `tui.rs` may map its own keys onto it.
    #[must_use]
    pub const fn step(self) -> i32 {
        match self {
            Self::Forward => 1,
            Self::Backward => -1,
        }
    }
}

/// The control id the ring holds after one step.
#[must_use]
pub fn move_focus(control_ids: &[&str], focused: Option<&str>, direction: Direction) -> Option<String> {
    if control_ids.is_empty() {
        return focused.map(str::to_owned);
    }
    // `indexOf` answers -1 for both "nothing focused" and "the focused id is gone", and the legacy code treats
    // them the same way, so a stale id re-enters the ring from an end rather than from the middle.
    let current = focused.and_then(|id| control_ids.iter().position(|candidate| *candidate == id)).map(|index| index as i32);
    let next = match current {
        None => match direction {
            Direction::Forward => 0,
            Direction::Backward => control_ids.len() as i32 - 1,
        },
        Some(index) => (index + direction.step() + control_ids.len() as i32) % control_ids.len() as i32,
    };
    control_ids.get(next as usize).map(|id| (*id).to_owned())
}

#[cfg(test)]
mod tests {
    use super::{Direction, move_focus};

    #[test]
    fn an_empty_ring_does_not_move_anywhere() {
        assert_eq!(move_focus(&[], Some("paths"), Direction::Forward), Some("paths".to_owned()));
        assert_eq!(move_focus(&[], None, Direction::Backward), None);
    }

    #[test]
    fn the_first_step_enters_the_ring_at_an_end() {
        let controls = ["paths", "mode", "dryRun"];
        assert_eq!(move_focus(&controls, None, Direction::Forward).as_deref(), Some("paths"));
        assert_eq!(move_focus(&controls, None, Direction::Backward).as_deref(), Some("dryRun"));
    }

    #[test]
    fn the_ring_wraps_in_both_directions() {
        let controls = ["paths", "mode", "dryRun"];
        assert_eq!(move_focus(&controls, Some("dryRun"), Direction::Forward).as_deref(), Some("paths"));
        assert_eq!(move_focus(&controls, Some("paths"), Direction::Backward).as_deref(), Some("dryRun"));
        assert_eq!(move_focus(&controls, Some("mode"), Direction::Forward).as_deref(), Some("dryRun"));
        assert_eq!(move_focus(&controls, Some("mode"), Direction::Backward).as_deref(), Some("paths"));
    }

    #[test]
    fn a_focus_id_the_screen_no_longer_offers_restarts_from_an_end() {
        let controls = ["paths", "mode"];
        assert_eq!(move_focus(&controls, Some("ghost"), Direction::Forward).as_deref(), Some("paths"));
        assert_eq!(move_focus(&controls, Some("ghost"), Direction::Backward).as_deref(), Some("mode"));
    }

    #[test]
    fn a_single_control_stays_put() {
        assert_eq!(move_focus(&["paths"], Some("paths"), Direction::Forward).as_deref(), Some("paths"));
        assert_eq!(move_focus(&["paths"], Some("paths"), Direction::Backward).as_deref(), Some("paths"));
    }
}
