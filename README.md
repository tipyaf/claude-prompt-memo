# prompt-memo

A Claude Code mod that keeps, for each session, a list of prompts to run later. The memo is always shown just above the chat input.

The memo's on-screen labels are in French; this README quotes them as they appear.

## How it works

- **Add**: type or paste a prompt (several lines are fine) in the memo's field, then press Enter or `+`.
- **Commands and skills**: as in the chat, typing `/` in the memo's field opens the list of available commands and skills right above the field's line, below the memo's prompts, filtered as you type (the memo grows while the list is open). Click a row to complete it.
  - When the field holds only the start of a name (`/rev`), Enter takes the highlighted suggestion (the field's `+` button turns into `→`), in this order: a plugin command's or skill's short name typed in full (`/code-review` becomes `/engineering:code-review`; for `plugin:folder:name`, both `folder:name` and `name` are short names), then a full name starting that way, then a short name starting that way.
  - A full name typed in full, a `/word` that only appears in the middle of a name, or a `/word` later in the text (a path, for example) is added as typed.
  - Only the `/word` at the end of the text is completed: the field does not report the cursor position.
  - While an item is being edited (`✎`), no suggestions show: Enter saves the text as it is.
- **Item actions**:
  - `↑ envoyer` sends the prompt to the chat and removes it from the memo;
  - `↵ insérer` pastes it into the chat input, at the cursor;
  - `✎` puts it back in the field to edit it (`✓` to save, `Annuler` to cancel);
  - `✕` deletes it.
- **Click** an item to select it (○ / ●). With a selection, the header offers **Insérer** (insert) and **Envoyer** (send) for several prompts at once, separated by a blank line.
- **Double-click** an item to insert it into the chat and remove it from the memo.
- **Long prompts** show on one line, cut with `…`, so the actions stay visible. `▸` / `▾` unfolds or folds the full text.
- **Collapse / expand** the whole memo with `▾ Mémo` in the header.

Each session has its own memo: a new session or a `/clear` starts from an empty list. The memo is kept while the app runs, not across a restart.

## Installation

At the prompt of a Claude Code session in a terminal:

```
/plugin install prompt-memo --marketplace tipyaf/claude-prompt-memo
```

Answer `y` to add the marketplace, then choose the installation scope.

From a shell:

```bash
claude plugin install prompt-memo --marketplace tipyaf/claude-prompt-memo
```

## Updating

```bash
claude plugin update prompt-memo
```

Then run `/reload-plugins` in the session, or start a new session. What each version brings is in the [CHANGELOG](CHANGELOG.md).

## Development

```bash
claude --plugin-dir /path/to/claude-prompt-memo
claude plugin validate .
claude plugin test .
```
