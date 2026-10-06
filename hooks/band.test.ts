import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The band has to draw on every surface it claims, and the rotate keys have to
// move effort without a turn having happened. Both are easy to break by hand and
// neither shows up as an error: a tree the engine refuses is replaced by the
// engine's own drawing, with one dim line in the transcript and nothing else.

// Not `as const`: MountTarget wants mutable props, and a readonly object is
// refused.
const BAND = {
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    bodyColumns: 120,
    maxRows: 4,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
}

const SURFACES = ['terminal', 'desktop'] as const

// Nothing sits beneath the plugin in a test, so the test is the engine: every
// call the mod makes has to be answered here or its hook is skipped. `mock`
// covers clock, store and env; the rest is spelled out.
const stand = (on: On, now?: number) => {
  // mock answers clock, store and env from memory; `on` is how it registers.
  // Registered exactly once per test: a second mock.clock(on) fails the module
  // load with `on("clock.now") registered twice`.
  mock.clock(on, now === undefined ? undefined : { now })
  mock.store(on)
  on('session.cwd', () => ({ value: '/home/bannd/Workspace/Projects/personal_works/sl-mod' }))
  on('session.model', () => ({ value: 'claude-opus-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 660000, window: 1000000, percent: 66 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 8, resetsAt: '2026-10-06T09:30:00.000Z' },
        { kind: 'seven_day', percentUsed: 36, resetsAt: '2026-10-06T23:00:00.000Z' },
      ],
      cost: { usd: 1 },
    },
  }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // A clean branch, in the --porcelain=v2 shape refreshGit parses.
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: '# branch.head main\n# branch.ab +0 -0\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  // The bottom of the render chain. It has to be what the engine resolves to at
  // a site it draws itself -- `{ type: 'engine', ref }`. Returning null is
  // refused with "returned something that is not a tree element", and then the
  // mod's own hook is skipped too, so the failure reads as the mod's.
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  // The bottom of the classic chain too, so the mod's own hook on it can run.
  on('classic.SessionStart', () => ({}))

  // `ui.invalidate` is deliberately NOT stubbed. Answering it from here swallows
  // the redraw, so a Button's press changes state and the test still reads the
  // tree from before it. The harness answers it properly; let it.
}

test('the band draws on every surface, not just the terminal', async ($, on) => {
  stand(on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'sl-mod', surface, ...BAND })

    // The model cell is the one thing always present: there is a model even
    // before any usage figure has been measured.
    expect(await ui.find({ type: 'Text', text: /Opus|Sonnet|Haiku|Fable/ })).toBeDefined()

    // All three controls, by the keys the hotkeys are bound to.
    for (const key of ['effort-down', 'effort-up', 'legend']) {
      expect(await ui.find({ key })).toBeDefined()
    }

    await ui.unmount()
  }
})

test('rotating effort marks the row, so the band shows what will be sent', async ($, on) => {
  stand(on)

  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })

  // Nothing has overridden anything yet, so no star.
  expect(await ui.find({ type: 'Text', text: /\*\)/ })).toBeUndefined()

  await ui.press({ key: 'effort-up' })

  // One press is enough: the star says this mod is steering, and the letter is
  // one of the five levels.
  expect(await ui.find({ type: 'Text', text: /\((L|M|H|X|✦)\*\)/ })).toBeDefined()

  await ui.unmount()
})

test('the band stands aside for a survey', async ($, on) => {
  stand(on)

  const ui = await $.ui.mount({
    plugin: 'sl-mod',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND.props, hasSurvey: true },
  })

  expect(await ui.find({ type: 'Text', text: /Opus|Sonnet|Haiku|Fable/ })).toBeUndefined()

  await ui.unmount()
})

// --- the ccuc-remote source, and the three ways it can have nothing to say ----
// These are the paths no running session will show clearly: a bar that is absent
// looks the same whether the data was missing or the code was wrong.

const HOME = '/home/test'
const ACCOUNT = JSON.stringify({ oauthAccount: { emailAddress: 'A@Example.com' } })
const BOOK = '\u{F02D}' // the per-model window's icon

// A reply shaped like the agreed contract, with the per-model week in it.
const reply = (lastOkAt: string) =>
  JSON.stringify({
    schema: 1,
    served_at: lastOkAt,
    as_of: lastOkAt,
    account: { label: 'a', email: 'a@example.com', uuid: 'u' },
    reported_by: 'linode',
    fetch: { status: 'ok', last_ok_at: lastOkAt, error: null },
    windows: [
      { kind: 'session', scope: null, percent: 8, resets_at: lastOkAt },
      { kind: 'weekly_all', scope: null, percent: 36, resets_at: lastOkAt },
      { kind: 'weekly_scoped', scope: 'Fable', percent: 25, resets_at: lastOkAt },
    ],
  })

const remoteStand = (on: On, opts: { token?: string; body?: string; status?: number }) => {
  mock.env(on, { HOME })
  on('fs.read', ($, e) => {
    if (e.path.endsWith('/.ccuc/read-token')) {
      return opts.token === undefined ? { deny: 'ENOENT' } : { value: opts.token }
    }
    if (e.path.endsWith('/.claude.json')) return { value: ACCOUNT }

    return { deny: 'ENOENT' }
  })
  on('http.fetch', () => ({
    value: {
      status: opts.status ?? 200,
      ok: (opts.status ?? 200) < 400,
      headers: {},
      text: opts.body ?? '',
    },
  }))
}

test('with no token the band falls back to the live windows, not to zeroes', async ($, on) => {
  stand(on)
  remoteStand(on, {})

  // The mount only draws; this is what fills the readings in.
  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })

  // The two live windows are there, and the per-model one is not invented.
  expect(await ui.find({ type: 'Text', text: /36%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(BOOK) })).toBeUndefined()

  await ui.unmount()
})

test('a fresh reply adds the per-model week', async ($, on) => {
  stand(on, Date.parse('2026-10-06T12:00:00Z'))
  remoteStand(on, { token: 't', body: reply('2026-10-06T11:59:00Z') })

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: new RegExp(`${BOOK}.*25%`) })).toBeDefined()

  await ui.unmount()
})

test('a reply older than the staleness bound is not drawn at all', async ($, on) => {
  stand(on, Date.parse('2026-10-06T12:00:00Z'))
  // 20 minutes old, past the 15-minute bound.
  remoteStand(on, { token: 't', body: reply('2026-10-06T11:40:00Z') })

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: new RegExp(BOOK) })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /36%/ })).toBeDefined()

  await ui.unmount()
})
