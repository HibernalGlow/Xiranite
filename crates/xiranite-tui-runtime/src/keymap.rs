//! What a key means on a node screen, taken from the legacy OpenTUI app rather than invented.
//!
//! The chain order below mirrors `packages/cli-runtime/src/tui/opentui/app.tsx`: escape exits, then tab moves
//! the focus ring, then the section-tab strip, then `q` quits when nothing is being typed and nothing is
//! running, then enter/space activates. The order is the behaviour — a port that handles `q` before the editor
//! zone would quit while the user is typing a path.
//!
//! Two measured facts from the 0.30 stack (see `docs/tui-rust-widget-strategy.md` §3.1) are encoded here rather
//! than left to each node: Windows delivers `Release` and `Repeat` events for one physical press, so anything
//! but `Press` is ignored here, and `crossterm` has no double-click event, which is why no action below assumes
//! one.

use crate::focus::Direction;

/// The physical key, narrowed to what the screen binds. A node's `tui.rs` may extend the mapping, but the
/// meanings below are shared and must not be redefined per node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyCode {
    Tab,
    Escape,
    Enter,
    Space,
    Backspace,
    Delete,
    Up,
    Down,
    Left,
    Right,
    Char(char),
}

/// The event phase. Only `Press` acts: Windows sends `Repeat` and `Release` for one physical key, which would
/// otherwise fire an action two or three times.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyState {
    Press,
    Repeat,
    Release,
}

/// One key event, with the two modifiers the legacy screen reads (`shift` for reverse tab, `ctrl` for quits).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyEvent {
    pub code: KeyCode,
    pub state: KeyState,
    pub shift: bool,
    pub ctrl: bool,
}

impl KeyEvent {
    #[must_use]
    pub fn press(code: KeyCode) -> Self {
        Self { code, state: KeyState::Press, shift: false, ctrl: false }
    }
}

/// Where the keyboard focus sits, because the same key means different things there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Zone {
    /// The control ring (fields, buttons, tabs).
    Controls,
    /// The section-tab strip inside the workbench.
    SectionTabs,
    /// A text editor: its keys belong to the editor and never reach the global chain.
    Editor,
}

/// The screen state the binding rules need.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Screen {
    pub zone: Zone,
    /// `session.phase === "running"` in the legacy app: quitting mid-run is not allowed.
    pub running: bool,
    /// How many sections the strip holds; one section means the arrows have nothing to cycle.
    pub sections: usize,
}

impl Screen {
    #[must_use]
    pub const fn controls(sections: usize) -> Self {
        Self { zone: Zone::Controls, running: false, sections }
    }
}

/// The action a node's `tui.rs` must carry out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    FocusNext,
    FocusPrev,
    SectionPrev,
    SectionNext,
    /// enter or space on the focused control.
    Activate,
    /// escape: leave the screen, or dismiss a confirmation first when one is open.
    Escape,
    /// `q`, and only when nothing is being typed and nothing runs.
    Quit,
    /// An editor keystroke: `delta` moves the caret/selection, `insert` appends, `delete` removes.
    Edit { delta: i8 },
    EditBackspace,
    EditDelete,
    EditInsert(char),
    /// Nothing bound: the key is swallowed on purpose so a node cannot guess a global meaning for it.
    Ignored,
}

/// The single entry point every face should use for a key event.
#[must_use]
pub fn action_for(event: &KeyEvent, screen: &Screen) -> Action {
    if event.state != KeyState::Press {
        return Action::Ignored;
    }

    match screen.zone {
        // The legacy text field consumes its own keys first (`app.tsx:368-383`): up/right advance, down/left
        // retreat, backspace and delete remove, and any other printable character appends.
        Zone::Editor => match event.code {
            KeyCode::Up | KeyCode::Right => Action::Edit { delta: 1 },
            KeyCode::Down | KeyCode::Left => Action::Edit { delta: -1 },
            KeyCode::Backspace => Action::EditBackspace,
            KeyCode::Delete => Action::EditDelete,
            KeyCode::Char(character) => Action::EditInsert(character),
            // Escape leaves the editor without quitting the screen, which is the one global key it still takes.
            KeyCode::Escape => Action::Escape,
            _ => Action::Ignored,
        },
        Zone::SectionTabs if screen.sections > 1 => match event.code {
            KeyCode::Left | KeyCode::Up => Action::SectionPrev,
            KeyCode::Right | KeyCode::Down => Action::SectionNext,
            _ => global(event, screen),
        },
        Zone::SectionTabs | Zone::Controls => global(event, screen),
    }
}

/// The chain outside the editor, in the legacy order.
fn global(event: &KeyEvent, screen: &Screen) -> Action {
    if event.code == KeyCode::Escape {
        return Action::Escape;
    }
    if event.code == KeyCode::Tab {
        return if event.shift { Action::FocusPrev } else { Action::FocusNext };
    }
    if screen.zone == Zone::SectionTabs {
        return Action::Ignored;
    }
    // `q` is the idle quit: never while typing, never while an operation runs.
    if event.code == KeyCode::Char('q') && !event.ctrl && !screen.running {
        return Action::Quit;
    }
    if matches!(event.code, KeyCode::Enter | KeyCode::Space) && screen.zone == Zone::Controls {
        return Action::Activate;
    }
    Action::Ignored
}

/// The ring direction for an action, so a node does not re-derive `±1` from an enum variant name.
#[must_use]
pub const fn focus_direction(action: &Action) -> Option<Direction> {
    match action {
        Action::FocusNext => Some(Direction::Forward),
        Action::FocusPrev => Some(Direction::Backward),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{Action, KeyCode, KeyEvent, KeyState, Screen, Zone, action_for, focus_direction};
    use crate::focus::Direction;

    fn typed(code: KeyCode) -> KeyEvent {
        KeyEvent::press(code)
    }

    fn shifted(code: KeyCode) -> KeyEvent {
        KeyEvent { code, state: KeyState::Press, shift: true, ctrl: false }
    }

    #[test]
    fn only_a_press_activates_anything() {
        for state in [KeyState::Repeat, KeyState::Release] {
            let event = KeyEvent { code: KeyCode::Enter, state, shift: false, ctrl: false };
            assert_eq!(action_for(&event, &Screen::controls(2)), Action::Ignored, "{state:?} must not fire twice on Windows");
        }
        assert_eq!(action_for(&typed(KeyCode::Enter), &Screen::controls(2)), Action::Activate);
    }

    #[test]
    fn the_global_chain_keeps_the_legacy_order() {
        let screen = Screen::controls(2);
        // escape wins over everything, including a press that is also a tab stop.
        assert_eq!(action_for(&typed(KeyCode::Escape), &screen), Action::Escape);
        assert_eq!(action_for(&typed(KeyCode::Tab), &screen), Action::FocusNext);
        assert_eq!(action_for(&shifted(KeyCode::Tab), &screen), Action::FocusPrev);
        assert_eq!(action_for(&typed(KeyCode::Char('q')), &screen), Action::Quit);
        assert_eq!(action_for(&typed(KeyCode::Enter), &screen), Action::Activate);
        assert_eq!(action_for(&typed(KeyCode::Space), &screen), Action::Activate);
        // An unbound key is swallowed rather than reinterpreted.
        assert_eq!(action_for(&typed(KeyCode::Down), &screen), Action::Ignored);
    }

    #[test]
    fn q_does_not_quit_while_typing_or_running() {
        let editing = Screen { zone: Zone::Editor, running: false, sections: 1 };
        assert_ne!(action_for(&typed(KeyCode::Char('q')), &editing), Action::Quit, "typing q must insert q");
        let running = Screen { running: true, ..Screen::controls(1) };
        assert_eq!(action_for(&typed(KeyCode::Char('q')), &running), Action::Ignored);
    }

    #[test]
    fn the_section_strip_cycles_only_when_there_is_anything_to_cycle() {
        let two = Screen { zone: Zone::SectionTabs, running: false, sections: 2 };
        assert_eq!(action_for(&typed(KeyCode::Left), &two), Action::SectionPrev);
        assert_eq!(action_for(&typed(KeyCode::Up), &two), Action::SectionPrev);
        assert_eq!(action_for(&typed(KeyCode::Right), &two), Action::SectionNext);
        assert_eq!(action_for(&typed(KeyCode::Down), &two), Action::SectionNext);

        let one = Screen { zone: Zone::SectionTabs, running: false, sections: 1 };
        assert_eq!(action_for(&typed(KeyCode::Right), &one), Action::Ignored, "one section cannot cycle");
        // tab still moves the focus ring from the strip, because the strip is part of the ring.
        assert_eq!(action_for(&typed(KeyCode::Tab), &one), Action::FocusNext);
    }

    #[test]
    fn the_editor_keeps_its_own_keys() {
        let editor = Screen { zone: Zone::Editor, running: true, sections: 3 };
        assert_eq!(action_for(&typed(KeyCode::Up), &editor), Action::Edit { delta: 1 });
        assert_eq!(action_for(&typed(KeyCode::Right), &editor), Action::Edit { delta: 1 });
        assert_eq!(action_for(&typed(KeyCode::Down), &editor), Action::Edit { delta: -1 });
        assert_eq!(action_for(&typed(KeyCode::Left), &editor), Action::Edit { delta: -1 });
        assert_eq!(action_for(&typed(KeyCode::Backspace), &editor), Action::EditBackspace);
        assert_eq!(action_for(&typed(KeyCode::Delete), &editor), Action::EditDelete);
        assert_eq!(action_for(&typed(KeyCode::Char('x')), &editor), Action::EditInsert('x'));
        // The editor is the one zone that keeps escape, and it never quits from there.
        assert_eq!(action_for(&typed(KeyCode::Escape), &editor), Action::Escape);
        assert_eq!(action_for(&typed(KeyCode::Enter), &editor), Action::Ignored);
    }

    #[test]
    fn the_ring_actions_map_to_the_shared_directions() {
        assert_eq!(focus_direction(&Action::FocusNext), Some(Direction::Forward));
        assert_eq!(focus_direction(&Action::FocusPrev), Some(Direction::Backward));
        assert_eq!(focus_direction(&Action::Quit), None);
    }
}
