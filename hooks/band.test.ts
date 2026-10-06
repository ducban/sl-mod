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

// --- the usage endpoint, and the three ways it can have nothing to say -------
// No running session shows these clearly: a bar that is absent looks the same
// whether the data was missing or the code was wrong.

const BOOK = '\u{F02D}' // the per-model window's icon

const reply = () =>
  JSON.stringify({
    limits: [
      { kind: 'session', group: 'session', percent: 9, scope: null },
      { kind: 'weekly_all', group: 'weekly', percent: 39, scope: null },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 26,
        scope: { model: { id: null, display_name: 'Fable' } },
      },
    ],
  })

const endpoint = (
  on: On,
  opts: { auth?: boolean; body?: string; status?: number; headers?: Record<string, string> },
) => {
  let calls = 0
  on('session.authorize', () =>
    opts.auth === false ? { value: null } : { value: { handle: 'h', kind: 'bearer' as const } },
  )
  on('http.fetch', () => {
    calls += 1

    return {
      value: {
        status: opts.status ?? 200,
        ok: (opts.status ?? 200) < 400,
        headers: opts.headers ?? {},
        text: opts.body ?? '',
      },
    }
  })

  return { calls: () => calls }
}

test('with no credential to spend, the live windows stay and nothing is invented', async ($, on) => {
  stand(on)
  endpoint(on, { auth: false })

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /36%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(BOOK) })).toBeUndefined()

  await ui.unmount()
})

test('a fresh reading adds the per-model week', async ($, on) => {
  stand(on, Date.parse('2026-10-06T12:00:00Z'))
  endpoint(on, { body: reply() })

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: new RegExp(`${BOOK}.*26%`) })).toBeDefined()
  // The endpoint's own figure wins over the engine's for the week, so the row
  // comes from one reading rather than two that disagree.
  expect(await ui.find({ type: 'Text', text: /39%/ })).toBeDefined()

  await ui.unmount()
})

test('a 401 keeps the live windows rather than blanking the row', async ($, on) => {
  stand(on)
  endpoint(on, { status: 401, body: '{"error":"unauthorized"}' })

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /36%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: new RegExp(BOOK) })).toBeUndefined()

  await ui.unmount()
})

test('a 429 stops the polling instead of hammering a limited endpoint', async ($, on) => {
  stand(on, Date.parse('2026-10-06T12:00:00Z'))
  const seen = endpoint(on, {
    status: 429,
    headers: { 'retry-after': '600' },
    body: '{"error":"rate_limited"}',
  })

  // One refresh on the way in.
  await $.classic.SessionStart({ source: 'startup' })
  expect(seen.calls()).toBe(1)

  // A second refresh inside the window must not reach the network at all.
  await $.classic.SessionStart({ source: 'clear' })
  expect(seen.calls()).toBe(1)

  // And the band still shows the engine's live windows meanwhile.
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /36%/ })).toBeDefined()
  await ui.unmount()
})
