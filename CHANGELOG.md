# Changelog

Versions follow the `version` field of `.claude-plugin/plugin.json`. An existing installation gets a new version with `claude plugin update prompt-memo`.

## 0.3.1

### Fixed
- The suggestion list no longer draws over the memo's prompts, which made both unreadable. It now sits between the prompts and the field, right above the field's line, and the memo grows while it is open.
- The field keeps the focus while the list opens and closes.

## 0.3.0

### Changed
- Command and skill suggestions open just above the field's line, over the memo's header and prompts, like the chat's own list. The memo only grows by the rows it lacks when it has too few.

## 0.2.0

### Added
- Typing `/` in the memo's field lists the available commands and skills (the same list as the chat), filtered as you type: click to complete; Enter completes the start of a name alone in the field (the `+` button turns into `→`).
- Plugin commands and skills can also be found by their short name (`/code-review` → `/engineering:code-review`).

### Fixed
- After a completion, the next keystroke goes to the end of the text instead of the middle of the completed word.

## 0.1.0

- First version: a per-session prompt memo above the chat input (add, send, insert, edit, delete, multiple selection, folded long prompts).
