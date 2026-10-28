import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'prompt-memo',
  component: 'AbovePrompt',
  props: { hasSurvey: false, bodyColumns: 80 },
} as const

const itemRows = async (ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string }[]> }) =>
  (await ui.findAll({ type: 'Button' })).filter(row => row.key?.startsWith('press-'))

test('add, multi-insert, double press and send', async ($, on) => {
  const clock = mock.clock(on)
  const filled: string[] = []
  const sent: string[] = []
  let sessionId = 'session-a'
  on('session.id', () => ({ value: sessionId }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    filled.length = 0
    sent.length = 0
    sessionId = `session-a-${surface}`
    const ui = await $.ui.mount({ ...BAND, surface })

    await ui.input({ key: 'draft', text: 'premier\nsur deux lignes' })
    await ui.input({ key: 'draft', text: 'second' })
    await ui.input({ key: 'draft', text: 'troisième' })
    const rows = await itemRows(ui)
    expect(rows).toHaveLength(3)
    const [one, two, three] = rows.map(row => row.key ?? '')

    // Single presses select; the selection inserts together.
    await ui.press({ key: one! })
    await clock.advance(1000)
    await ui.press({ key: two! })
    await clock.advance(1000)
    await ui.press({ key: 'insert-selected' })
    expect(filled).toEqual(['premier\nsur deux lignes\n\nsecond'])

    // A double press inserts the item and removes it.
    await ui.press({ key: three! })
    await clock.advance(100)
    await ui.press({ key: three! })
    expect(filled.at(-1)).toBe('troisième')
    expect(await itemRows(ui)).toHaveLength(2)

    // Edit rewrites in place.
    await ui.press({ key: one!.replace('press-', 'edit-') })
    await ui.input({ key: 'draft', text: 'premier modifié' })
    expect((await ui.find({ key: one! }))?.text).toMatch(/premier modifié/)

    // Send submits and removes; delete removes.
    await ui.press({ key: one!.replace('press-', 'send-') })
    expect(sent).toEqual(['premier modifié'])
    await ui.press({ key: two!.replace('press-', 'delete-') })
    expect(await itemRows(ui)).toHaveLength(0)

    // Collapse hides the field and the list.
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ key: 'draft' })).toBeUndefined()
    await ui.press({ key: 'toggle' })

    // Another session id (a /clear, a resume) has its own memo.
    await ui.input({ key: 'draft', text: `gardé ${surface}` })
    await ui.unmount()
    sessionId = `session-b-${surface}`
    const other = await $.ui.mount({ ...BAND, surface })
    expect(await itemRows(other)).toHaveLength(0)
    await other.unmount()
    sessionId = `session-a-${surface}`
    const back = await $.ui.mount({ ...BAND, surface })
    expect((await itemRows(back)).length).toBeGreaterThan(0)
    await back.unmount()
  }
})

test('a long prompt shows one line, unfolds whole and keeps its actions', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 'session-long' }))
  const long = `${'mot '.repeat(40)}fin\nseconde ligne`

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.input({ key: 'draft', text: long })
    const [row] = await itemRows(ui)
    const id = row!.key!.replace('press-', '')

    expect(row!.text).toMatch(/…$/)
    expect(row!.text).not.toMatch(/seconde ligne/)
    expect(await ui.find({ key: `send-${id}` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'seconde ligne' })).toBeUndefined()

    await ui.press({ key: `expand-${id}` })
    expect(await ui.find({ type: 'Text', text: /seconde ligne/ })).toBeDefined()
    expect(await ui.find({ key: `send-${id}` })).toBeDefined()

    await ui.press({ key: `expand-${id}` })
    expect(await ui.find({ type: 'Text', text: /seconde ligne/ })).toBeUndefined()

    await ui.press({ key: `delete-${id}` })
    await ui.unmount()
  }
})

test('a /word in the field lists matching commands and skills to complete', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 'session-slash' }))
  on('command.list', () => ({
    value: [
      { name: 'review', description: 'Review a pull request', source: 'builtin' },
      { name: 'review', description: 'Same name, another source', source: 'user' },
      { name: 'review-later', description: 'Later', source: 'user' },
      { name: 'code-review', description: 'Review the diff', source: 'plugin' },
      { name: 'resume', description: 'Resume a conversation', source: 'builtin' },
      { name: 'init', description: 'Write CLAUDE.md', source: 'builtin' },
    ],
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const rows = async () =>
      (await ui.findAll({ type: 'Button' }))
        .map(row => row.key ?? '')
        .filter(key => key.startsWith('complete-'))

    await ui.input({ key: 'draft', text: 'fais ceci puis /re', kind: 'change' })
    expect(await rows()).toEqual([
      'complete-review',
      'complete-review-later',
      'complete-resume',
      'complete-code-review',
    ])

    // A press replaces the /word and closes the list.
    await ui.press({ key: 'complete-resume' })
    expect((await ui.find({ key: 'draft' }))?.props?.value).toBe('fais ceci puis /resume ')
    expect(await rows()).toEqual([])

    // Enter on a partial name alone in the field takes the first match instead of adding it.
    await ui.input({ key: 'draft', text: '/in' })
    expect(await itemRows(ui)).toHaveLength(0)
    expect((await ui.find({ key: 'draft' }))?.props?.value).toBe('/init ')

    // Leading blank space still counts as a lone partial name.
    await ui.input({ key: 'draft', text: '  /in' })
    expect((await ui.find({ key: 'draft' }))?.props?.value).toBe('  /init ')

    // Enter on a whole command adds it to the memo, even when longer names start with it.
    await ui.input({ key: 'draft', text: '/review' })
    expect(await itemRows(ui)).toHaveLength(1)

    // A /word later in a prompt (a path), a bare / and a word no name starts with are saved as typed.
    await ui.input({ key: 'draft', text: 'lis le fichier /re' })
    await ui.input({ key: 'draft', text: '/' })
    await ui.input({ key: 'draft', text: '/view' })
    expect(await itemRows(ui)).toHaveLength(4)

    for (const row of await itemRows(ui)) {
      await ui.press({ key: row.key!.replace('press-', 'delete-') })
    }
    await ui.unmount()
  }
})

test('the memo still draws when the command list fails', async ($, on) => {
  mock.clock(on)
  on('session.id', () => ({ value: 'session-no-commands' }))
  on('command.list', () => {
    throw new Error('no listing here')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.input({ key: 'draft', text: '/re', kind: 'change' })
    expect(await ui.find({ key: 'toggle' })).toBeDefined()
    await ui.input({ key: 'draft', text: '/re' })
    expect(await itemRows(ui)).toHaveLength(1)
    await ui.press({ key: (await itemRows(ui))[0]!.key!.replace('press-', 'delete-') })
    await ui.unmount()
  }
})
