import { atom, memberOf, read, update } from 'claude-code'
import type { CommandInfo, EngineInterface, Register } from 'claude-code'

import type { MemoItem } from '../types'

const DOUBLE_PRESS_MS = 450

const itemsFamily = atom({ plugin: 'prompt-memo', key: 'items' } as const, [])
const draftFamily = atom({ plugin: 'prompt-memo', key: 'draft' } as const, '')
const editingIdFamily = atom({ plugin: 'prompt-memo', key: 'editingId' } as const, null)
const selectedFamily = atom({ plugin: 'prompt-memo', key: 'selected' } as const, [])
const isCollapsedFamily = atom({ plugin: 'prompt-memo', key: 'isCollapsed' } as const, false)
const expandedFamily = atom({ plugin: 'prompt-memo', key: 'expanded' } as const, [])

// Columns an item row keeps for its marker, number and the four actions beside the text.
const ROW_CHROME_COLUMNS = 43

// The first line of a prompt, cut to `width` columns with an ellipsis when anything is left out.
function preview(text: string, width: number) {
  const [first = ''] = text.split('\n')
  const isCut = first.length > width || text.includes('\n')

  return isCut ? `${first.slice(0, Math.max(1, width - 1))}…` : first
}

// Rows the slash typeahead under the field shows at most.
const MAX_SUGGESTIONS = 8

// The `/word` being typed at the end of the draft, as the chat's typeahead reads it.
function slashToken(text: string) {
  const match = /(^|\s)\/([^\s/]*)$/.exec(text)

  return match ? { start: match.index + match[1]!.length, query: match[2]!.toLowerCase() } : null
}

// Whether a command is a plugin's `plugin:name`, which carries its plugin in its name.
const isPluginNamed = (command: CommandInfo) =>
  command.source === 'plugin' && command.name.includes(':')

// A plugin command or skill's short names, lowercased: after the plugin's colon and, for a nested
// `plugin:dir:name`, its last part too. None for any other command, so a user's `dir:command` or an
// MCP prompt is matched by its full name alone.
function shortNames(command: CommandInfo) {
  const name = command.name.toLowerCase()
  if (!isPluginNamed(command)) {
    return []
  }

  return [...new Set([name.slice(name.indexOf(':') + 1), name.slice(name.lastIndexOf(':') + 1)])]
}

// How well a command matches `query`, best first: its name (0) or short name (1) equal to it, its
// name (2) or short name (3) starting with it, its name containing it (4); null when it does not.
function rankOf(command: CommandInfo, query: string) {
  const name = command.name.toLowerCase()
  const shorts = shortNames(command)
  const rank = [
    name === query,
    shorts.includes(query),
    name.startsWith(query),
    shorts.some(short => short.startsWith(query)),
    name.includes(query),
  ].indexOf(true)

  return rank < 0 ? null : rank
}

// Commands and skills matching `query`, best rank first, one per name whatever its case: the first
// listed of a name stands for it, matching or not.
function matchCommands(commands: CommandInfo[], query: string) {
  const seen = new Set<string>()
  const ranked: { command: CommandInfo; rank: number }[] = []
  for (const command of commands) {
    const name = command.name.toLowerCase()
    if (seen.has(name)) {
      continue
    }
    seen.add(name)
    const rank = rankOf(command, query)
    if (rank !== null) {
      ranked.push({ command, rank })
    }
  }

  // A stable sort: equal ranks keep the typeahead's order.
  return ranked.sort((a, b) => a.rank - b.rank).map(one => one.command)
}

// Whether the `/word` at `start` is all the draft holds, blank space before it aside.
const isLone = (value: string, start: number) => value.slice(0, start).trim() === ''

// The draft with its trailing `/word` replaced by `/name `; a lone one also loses the blank space
// before it, while text before a later one is kept as typed.
function replaceToken(value: string, name: string) {
  const at = slashToken(value)
  if (!at) {
    return value
  }

  return `${isLone(value, at.start) ? '' : value.slice(0, at.start)}/${name} `
}

// The query of a draft that is only a partial `/name`, which Enter completes as in the chat. A
// `/word` later in a prompt (a path, a fraction) or a bare `/` is saved as typed.
function lonePartial(value: string, at = slashToken(value)) {
  return at && at.query.length > 0 && isLone(value, at.start) ? at.query : null
}

// The command Enter takes among the ranked `matches` of a lone partial `query`: the first when it
// ranks 1 to 3 in rankOf, so not when its full name is typed whole (saved as typed, rank 0) or when
// it only contains the query (rank 4).
function enterTarget(query: string, matches: CommandInfo[]) {
  const [first] = matches
  const rank = first ? rankOf(first, query) : null

  return rank !== null && rank >= 1 && rank <= 3 ? first! : null
}

// What a suggestion shows after its name: nothing for a built-in or a `plugin:skill` that names its
// plugin already, else its plugin or where it comes from.
function sourceTag(command: CommandInfo) {
  if (command.source === 'builtin' || isPluginNamed(command)) {
    return ''
  }

  return command.plugin ?? command.source
}

// A description's first line with text, for a suggestion row that stays one line.
const firstLine = (text: string) =>
  text
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .find(line => line !== '') ?? ''

// Sessions whose command list is kept at once; the oldest goes first.
const MAX_CACHED_SESSIONS = 4

// Each session's command list, read when the draft gets a trailing `/word` and dropped by a draw
// whose draft has none, so one `/word` replacing another keeps it; a listing that fails is dropped
// too, so the next keystroke asks again.
const commandsBySession = new Map<string, Promise<CommandInfo[]>>()

function commands($: EngineInterface, sessionId: string) {
  const cached = commandsBySession.get(sessionId)
  if (cached) {
    // Set again so the least recently used session is the one dropped below.
    commandsBySession.delete(sessionId)
    commandsBySession.set(sessionId, cached)

    return cached
  }
  // Started inside a promise so a call that throws at once is caught like one that rejects.
  const list: Promise<CommandInfo[]> = Promise.resolve()
    .then(() => $.command.list())
    .catch(() => {
      if (commandsBySession.get(sessionId) === list) {
        commandsBySession.delete(sessionId)
      }

      return []
    })
  commandsBySession.set(sessionId, list)
  const [oldest] = commandsBySession.keys()
  if (commandsBySession.size > MAX_CACHED_SESSIONS && oldest !== undefined) {
    commandsBySession.delete(oldest)
  }

  return list
}

let lastPress: { id: string; at: number } | null = null
let counter = 0

async function draw(
  $: EngineInterface,
  e: Parameters<EngineInterface['ui']['resolve']>[0],
  columns: number,
  bandId: string,
) {
  // One memo per session id: a /clear or a resume in the same process starts on an empty one.
  const session = { requestId: await $.session.id() }
  const items = memberOf(itemsFamily, session)
  const draft = memberOf(draftFamily, session)
  const editingId = memberOf(editingIdFamily, session)
  const selected = memberOf(selectedFamily, session)
  const isCollapsed = memberOf(isCollapsedFamily, session)
  const expanded = memberOf(expandedFamily, session)
  const table = $.ui.resolve(e)
  const { Box, Text, Button } = table
  // Mobile draws no text field yet: the list stays usable there, adding needs another surface.
  const Input = 'Input' in table ? table.Input : undefined
  const list = await read($, items)
  const text = await read($, draft)
  const editing = await read($, editingId)
  const picked = (await read($, selected)).filter(id => list.some(one => one.id === id))
  const collapsed = await read($, isCollapsed)
  const opened = await read($, expanded)
  const textWidth = Math.max(12, columns - ROW_CHROME_COLUMNS)
  const isLong = (item: MemoItem) => preview(item.text, textWidth) !== item.text
  // Only a surface that draws the field reads the list or drops it, so mobile leaves it alone. An
  // edit in progress shows no suggestions: Enter there saves the text as it is.
  const token = collapsed || !Input || editing ? null : slashToken(text)
  if (Input && !token) {
    commandsBySession.delete(session.requestId)
  }
  const matches = token ? matchCommands(await commands($, session.requestId), token.query) : []
  const suggestions = matches.slice(0, MAX_SUGGESTIONS)
  const highlighted = token && lonePartial(text, token) ? enterTarget(token.query, matches) : null

  // The field takes the keys back, so the person goes on typing the command's arguments; where the
  // band does not hold the keys the ring stays put.
  const complete = async (name: string) => {
    await update($, draft, value => replaceToken(value, name))
    await Promise.resolve()
      .then(() => $.ui.focus({ requestId: bandId, key: 'draft' }))
      .catch(() => undefined)
  }

  const remove = (ids: string[]) =>
    Promise.all([
      update($, items, all => all.filter(one => !ids.includes(one.id))),
      update($, selected, all => all.filter(id => !ids.includes(id))),
      update($, editingId, id => (id && ids.includes(id) ? null : id)),
      update($, expanded, all => all.filter(id => !ids.includes(id))),
    ])

  const insert = async (texts: string[]) => {
    const { text: current } = await $.prompt.read()
    const joined = texts.join('\n\n')
    const sep = current.length > 0 && !current.endsWith('\n') ? '\n\n' : ''
    await $.prompt.fill({ text: sep + joined, mode: 'insert' })
  }

  const send = async (texts: string[], ids: string[]) => {
    await remove(ids)
    void $.prompt.submit({ text: texts.join('\n\n') })
  }

  const save = async (value: string) => {
    if (value.trim().length === 0) {
      return
    }
    const id = await read($, editingId)
    const query = id ? null : lonePartial(value)
    // The draft as Enter found it, when the list is read before acting on it.
    let before: string | undefined
    if (query) {
      before = await read($, draft)
      const listed = await commands($, session.requestId)
      const command = enterTarget(query, matchCommands(listed, query))
      if (command) {
        // Text typed while the list was read wins over the completion.
        await update($, draft, current =>
          current === before || current === value ? replaceToken(value, command.name) : current,
        )

        return
      }
    }
    if (id) {
      await update($, items, all => all.map(one => (one.id === id ? { ...one, text: value } : one)))
      await update($, editingId, () => null)
    } else {
      counter += 1
      const item: MemoItem = { id: `${await $.clock.now()}-${counter}`, text: value }
      await update($, items, all => [...all, item])
    }
    // Text typed while the list was read stays in the field.
    await update($, draft, current =>
      before === undefined || current === before || current === value ? '' : current,
    )
  }

  const pressItem = async (item: MemoItem) => {
    const now = await $.clock.now()
    const isDouble = lastPress?.id === item.id && now - lastPress.at < DOUBLE_PRESS_MS
    if (isDouble) {
      lastPress = null
      await insert([item.text])
      await remove([item.id])

      return
    }
    lastPress = { id: item.id, at: now }
    await update($, selected, all =>
      all.includes(item.id) ? all.filter(id => id !== item.id) : [...all, item.id],
    )
  }

  const pickedItems = list.filter(one => picked.includes(one.id))
  const count = `${list.length} prompt${list.length > 1 ? 's' : ''}`

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="promptBorder"
      borderDimColor
      paddingX={1}
    >
      <Box justifyContent="space-between" alignItems="center">
        <Box gap={1}>
          <Button
            key="toggle"
            plain
            label={`${collapsed ? '▸' : '▾'} Mémo`}
            onPress={() => update($, isCollapsed, value => !value)}
          />
          <Text dimColor>· {count}</Text>
        </Box>
        {!collapsed && pickedItems.length > 0 && (
          <Box gap={1} alignItems="center">
            <Text color="suggestion">{pickedItems.length} sélectionné(s)</Text>
            <Button
              key="insert-selected"
              variant="primary"
              label="Insérer"
              onPress={() => insert(pickedItems.map(one => one.text))}
            />
            <Button
              key="send-selected"
              label="Envoyer"
              onPress={() =>
                send(
                  pickedItems.map(one => one.text),
                  pickedItems.map(one => one.id),
                )
              }
            />
            <Button
              key="clear-selected"
              plain
              dimColor
              label="✕"
              onPress={() => update($, selected, () => [])}
            />
          </Box>
        )}
        {!collapsed && pickedItems.length === 0 && list.length > 0 && (
          <Text dimColor>clic : sélectionner · double-clic : insérer et retirer</Text>
        )}
      </Box>

      {!collapsed && (
        <Box flexDirection="column" marginTop={1}>
          {list.length === 0 && (
            <Text dimColor italic>
              Aucun prompt en mémoire. Écris ou colle-en un ci-dessous.
            </Text>
          )}
          {list.map((item, index) => {
            const isPicked = picked.includes(item.id)
            const isEditing = editing === item.id
            const isOpen = opened.includes(item.id)
            const color = isEditing ? 'warning' : isPicked ? 'suggestion' : 'inactive'

            return (
              <Box
                key={`item-${item.id}`}
                flexDirection="column"
                hover={{ backgroundColor: 'subtle' }}
              >
                <Box gap={1} alignItems="flex-start">
                  <Text color={color}>▍</Text>
                  {isLong(item) ? (
                    <Button
                      key={`expand-${item.id}`}
                      plain
                      dimColor
                      label={isOpen ? '▾' : '▸'}
                      onPress={() =>
                        update($, expanded, all =>
                          all.includes(item.id)
                            ? all.filter(id => id !== item.id)
                            : [...all, item.id],
                        )
                      }
                    />
                  ) : (
                    <Text> </Text>
                  )}
                  <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                    <Button key={`press-${item.id}`} plain onPress={() => pressItem(item)}>
                      <Text color={isPicked ? 'suggestion' : 'inactive'}>
                        {isPicked ? '●' : '○'}
                      </Text>{' '}
                      <Text dimColor>{index + 1}.</Text>{' '}
                      {isOpen ? (
                        <Text dimColor italic>
                          texte complet ci-dessous
                        </Text>
                      ) : (
                        <Text color={isEditing ? 'warning' : undefined} wrap="truncate-end">
                          {preview(item.text, textWidth)}
                        </Text>
                      )}
                    </Button>
                  </Box>
                  <Box gap={1} flexShrink={0}>
                    <Button
                      key={`send-${item.id}`}
                      plain
                      dimColor
                      label="↑ envoyer"
                      onPress={() => send([item.text], [item.id])}
                    />
                    <Button
                      key={`insert-${item.id}`}
                      plain
                      dimColor
                      label="↵ insérer"
                      onPress={() => insert([item.text])}
                    />
                    <Button
                      key={`edit-${item.id}`}
                      plain
                      dimColor
                      label="✎"
                      onPress={async () => {
                        await update($, editingId, () => item.id)
                        await update($, draft, () => item.text)
                      }}
                    />
                    <Button
                      key={`delete-${item.id}`}
                      plain
                      dimColor
                      hover={{ color: 'error' }}
                      label="✕"
                      onPress={() => remove([item.id])}
                    />
                  </Box>
                </Box>
                {isOpen && (
                  <Box paddingLeft={4} paddingRight={1}>
                    <Text color={isEditing ? 'warning' : undefined} wrap="wrap">
                      {item.text}
                    </Text>
                  </Box>
                )}
              </Box>
            )
          })}

          {Input ? (
            <Box flexDirection="column">
              {editing && <Text color="warning">Modification du prompt en cours</Text>}
              <Input
                key="draft"
                rows={3}
                placeholder="Nouveau prompt… (collage accepté, Entrée pour ajouter)"
                value={text}
                submitLabel={editing ? '✓' : highlighted ? '⇥' : '+'}
                onInput={(value: string) => update($, draft, () => value)}
                onSubmit={(value: string) => save(value)}
              />
              {suggestions.length > 0 && (
                <Box flexDirection="column" paddingLeft={1}>
                  {suggestions.map(command => {
                    const tag = sourceTag(command)
                    const description = firstLine(command.description)

                    return (
                      <Button
                        key={`complete-${command.name}`}
                        plain
                        onPress={() => complete(command.name)}
                      >
                        <Text
                          color={command === highlighted ? 'suggestion' : undefined}
                          wrap="truncate-end"
                        >
                          /{command.name}
                          {tag ? <Text dimColor> ({tag})</Text> : null}
                          {description ? <Text dimColor> · {description}</Text> : null}
                        </Text>
                      </Button>
                    )
                  })}
                </Box>
              )}
              {editing && (
                <Box justifyContent="flex-end">
                  <Button
                    key="cancel-edit"
                    label="Annuler"
                    onPress={async () => {
                      await update($, editingId, () => null)
                      await update($, draft, () => '')
                    }}
                  />
                </Box>
              )}
            </Box>
          ) : (
            <Text dimColor>Ajout possible depuis le terminal ou le desktop.</Text>
          )}
        </Box>
      )}
    </Box>
  )
}

export const register: Register = on => {
  // Always drawn above the prompt; it steps aside only while a survey asks there.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    return draw($, e, e.props.bodyColumns, e.requestId)
  })
}
