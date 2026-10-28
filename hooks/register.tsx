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

// A name and, for a plugin's `plugin:skill`, its short name after the colon, lowercased.
function nameForms(command: CommandInfo) {
  const name = command.name.toLowerCase()

  return [name, name.slice(name.lastIndexOf(':') + 1)]
}

const startsWith = (command: CommandInfo, query: string) =>
  nameForms(command).some(form => form.startsWith(query))

// Commands and skills matching `query`, one per name: names (or short names) starting with it first,
// then names containing it.
function matchCommands(commands: CommandInfo[], query: string) {
  const seen = new Set<string>()
  const starts: CommandInfo[] = []
  const contains: CommandInfo[] = []
  for (const one of commands) {
    if (seen.has(one.name) || !one.name.toLowerCase().includes(query)) {
      continue
    }
    seen.add(one.name)
    ;(startsWith(one, query) ? starts : contains).push(one)
  }

  return [...starts, ...contains]
}

// The draft with its trailing `/word` replaced by `/name ` (a lone one with no blank space before).
function replaceToken(value: string, name: string) {
  const at = slashToken(value)

  return at ? `${value.slice(0, at.start).trimStart()}/${name} ` : value
}

// The query of a draft that is only a partial `/name`, which Enter completes as in the chat. A
// `/word` later in a prompt (a path, a fraction) or a bare `/` is saved as typed.
function lonePartial(value: string) {
  const at = slashToken(value)

  return at && at.query.length > 0 && value.slice(0, at.start).trim() === '' ? at.query : null
}

// The command Enter takes among the `matches` of a lone partial `query`: the first when its name or
// short name starts with the query, none when a name is typed whole.
function enterTarget(query: string, matches: CommandInfo[]) {
  const [first] = matches
  const isWhole = matches.some(one => nameForms(one).includes(query))

  return first && !isWhole && startsWith(first, query) ? first : null
}

// What a suggestion shows after its name: its plugin, or where it comes from; nothing for a built-in.
const sourceTag = (command: CommandInfo) =>
  command.plugin ?? (command.source === 'builtin' ? '' : command.source)

// Sessions whose command list is kept at once; the oldest goes first.
const MAX_CACHED_SESSIONS = 4

// Each session's command list, read once each time a `/word` starts and dropped when it ends; a
// listing that fails is dropped too, so the next keystroke asks again.
const commandsBySession = new Map<string, Promise<CommandInfo[]>>()

function commands($: EngineInterface, sessionId: string) {
  let list = commandsBySession.get(sessionId)
  if (!list) {
    const listed: Promise<CommandInfo[]> = $.command.list().catch(() => {
      if (commandsBySession.get(sessionId) === listed) {
        commandsBySession.delete(sessionId)
      }

      return []
    })
    list = listed
    commandsBySession.set(sessionId, list)
    for (const old of commandsBySession.keys()) {
      if (commandsBySession.size <= MAX_CACHED_SESSIONS) {
        break
      }
      commandsBySession.delete(old)
    }
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
  const highlighted = token && lonePartial(text) ? enterTarget(token.query, matches) : null

  // The field takes the keys back, so the person goes on typing the command's arguments; where the
  // band does not hold the keys the ring stays put.
  const complete = async (name: string) => {
    await update($, draft, value => replaceToken(value, name))
    await $.ui.focus({ requestId: bandId, key: 'draft' }).catch(() => undefined)
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
    const before = await read($, draft)
    const query = id ? null : lonePartial(value)
    const command =
      query && enterTarget(query, matchCommands(await commands($, session.requestId), query))
    if (command) {
      // Text typed while the list was read wins over the completion.
      await update($, draft, current =>
        current === before || current === value ? replaceToken(value, command.name) : current,
      )

      return
    }
    if (id) {
      await update($, items, all => all.map(one => (one.id === id ? { ...one, text: value } : one)))
      await update($, editingId, () => null)
    } else {
      counter += 1
      const item: MemoItem = { id: `${await $.clock.now()}-${counter}`, text: value }
      await update($, items, all => [...all, item])
    }
    await update($, draft, () => '')
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
                submitLabel={editing ? '✓' : '+'}
                onInput={(value: string) => update($, draft, () => value)}
                onSubmit={(value: string) => save(value)}
              />
              {suggestions.length > 0 && (
                <Box flexDirection="column" paddingLeft={1}>
                  {suggestions.map(command => (
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
                        {sourceTag(command) && <Text dimColor> ({sourceTag(command)})</Text>}
                        {command.description && <Text dimColor> · {command.description}</Text>}
                      </Text>
                    </Button>
                  ))}
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
