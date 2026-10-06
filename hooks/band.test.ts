import type { On, SessionUsage } from 'claude-code'
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

// The controls moved out of the band and into the dim line under the prompt.
const HINT = {
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
}

const SETTINGS = {
  component: 'Pane' as const,
  requestId: 'sl-settings',
  props: {
    title: 'sl settings',
    isFocused: true,
    bodyColumns: 100,
    placement: 'inline' as const,
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
}

const SURFACES = ['terminal', 'desktop'] as const

// Nothing sits beneath the plugin in a test, so the test is the engine: every
// call the mod makes has to be answered here or its hook is skipped. `mock`
// covers clock, store and env; the rest is spelled out.
const stand = (on: On, now?: number, usage?: SessionUsage) => {
  // mock answers clock, store and env from memory; `on` is how it registers.
  // Registered exactly once per test: a second mock.clock(on) fails the module
  // load with `on("clock.now") registered twice`.
  mock.clock(on, now === undefined ? undefined : { now })
  mock.store(on)
  on('session.cwd', () => ({ value: '/home/bannd/Workspace/Projects/personal_works/sl-mod' }))
  on('session.model', () => ({ value: 'claude-opus-5' }))
  on('session.usage', () => ({
    value: usage ?? {
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
  // refreshVersion walks a chain of files and falls through to a git tag. Only
  // the plugin manifest answers, so the version cell reads the mod's own
  // version -- which is what it does in this repo.
  // Matched by suffix: the engine may resolve the relative path before the
  // event is raised, so an equality check on the spelling the mod passed is not
  // safe.
  on('fs.exists', ($, e) => ({ value: e.path.endsWith('plugin.json') }))
  // `fs.read` answers the text itself, not an object wrapping it.
  on('fs.read', () => ({ value: '{"name":"sl-mod","version":"0.1.0"}' }))
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

  // The bottom of the measurement chain, so a test can push a figure. It has to
  // echo the event: a result without `changed` is refused and the mod's own hook
  // is skipped with it.
  on('session.measure', ($, e) => ({ ...e }))

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

    await ui.unmount()
  }
})

test('the controls draw under the prompt, on every surface', async ($, on) => {
  stand(on)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'sl-mod', surface, ...HINT })

    expect(await ui.find({ type: 'Text', text: /effort:/ })).toBeDefined()
    for (const key of ['effort-up', 'effort-down']) {
      expect(await ui.find({ key })).toBeDefined()
    }

    await ui.unmount()
  }
})

test('while a turn runs the engine keeps its own hint line', async ($, on) => {
  stand(on)

  // `esc to interrupt` lives in that line and is worth more than two buttons.
  // A tree here replaces the line rather than adding to it, so the only way to
  // leave it alone is not to draw.
  const ui = await $.ui.mount({
    plugin: 'sl-mod',
    surface: 'terminal',
    component: 'PromptHint',
    props: { ...HINT.props, isWorking: true, hint: 'esc to interrupt' },
  })

  expect(await ui.find({ type: 'Text', text: /effort:/ })).toBeUndefined()

  await ui.unmount()
})

test('rotating effort marks the row, so the band shows what will be sent', async ($, on) => {
  stand(on)

  // No turn has run, so `turn.step` has never reported an effort and the model
  // cell carries none: a level is drawn only once there is one to draw.
  const band = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /\((L|M|H|X|✦)\)/ })).toBeUndefined()

  // The button that moves it is under the prompt now, and the band has to
  // redraw off a press that landed on another render site entirely.
  const hint = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...HINT })
  await hint.press({ key: 'effort-up' })

  expect(await band.find({ type: 'Text', text: /\((L|M|H|X|✦)\)/ })).toBeDefined()

  await hint.unmount()
  await band.unmount()
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

// A window scoped to a model is labelled with the model, lowercased.
const SCOPED = 'fable'

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
  expect(await ui.find({ type: 'Text', text: new RegExp(SCOPED) })).toBeUndefined()

  await ui.unmount()
})

test('a fresh reading adds the per-model week', async ($, on) => {
  stand(on, Date.parse('2026-10-06T12:00:00Z'))
  endpoint(on, { body: reply() })

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: new RegExp(`${SCOPED}.*26%`) })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: new RegExp(SCOPED) })).toBeUndefined()

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

// --- the layout, and the settings pane that writes it ------------------------

test('the version cell reads the open project, not the engine', async ($, on) => {
  stand(on)

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })

  // 0.1.0 is the mod's own manifest, which is what this repo declares. Not
  // 2.1.289: claude-powerline's version segment shows the engine's version, and
  // that is the one thing this cell is deliberately not.
  expect(await ui.find({ type: 'Text', text: /0\.1\.0/ })).toBeDefined()

  await ui.unmount()
})

test('switching an item off in the settings pane takes it off the band', async ($, on) => {
  stand(on)

  await $.classic.SessionStart({ source: 'startup' })
  const band = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /0\.1\.0/ })).toBeDefined()

  // version starts on line 1, so four presses walk it 2, 3, 4, off.
  const pane = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...SETTINGS })
  for (let i = 0; i < 4; i += 1) await pane.press({ key: 'item-version' })

  expect(await band.find({ type: 'Text', text: /0\.1\.0/ })).toBeUndefined()

  // One more press wraps it back onto line 1. The cycle is the whole interface
  // -- one key per item, no cursor -- so a wrap that does not come round is the
  // way out of the pane disappearing.
  await pane.press({ key: 'item-version' })
  expect(await band.find({ type: 'Text', text: /0\.1\.0/ })).toBeDefined()

  await pane.unmount()
  await band.unmount()
})

test('the cache cell says nothing while the cache is healthy', async ($, on) => {
  // 95% read from cache. A cell here would be a permanent 95% that costs width
  // and tells nobody anything; the number only speaks when it falls. The usage
  // stand-in is passed to `stand` rather than registered here: a second
  // on('session.usage') fails the module load outright.
  stand(on, undefined, {
    startedAt: 0,
    context: {
      tokens: 660000,
      window: 1000000,
      percent: 66,
      breakdown: {
        apiUsage: {
          input_tokens: 5000,
          output_tokens: 1200,
          cache_read_input_tokens: 95000,
          cache_creation_input_tokens: 0,
        },
      },
    },
    rateLimits: [],
    cost: { usd: 1 },
    // Cast rather than filled in: a real breakdown carries twelve more fields
    // and the mod reads exactly one of them. Writing the other twelve would be
    // inventing a fixture nobody checks.
  } as unknown as SessionUsage)

  await $.session.measure({
    context: { tokens: 660000, window: 1000000, percent: 66 },
    rateLimits: [],
    cost: { usd: 1 },
    changed: ['cost'],
  })

  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /ch \d+%/ })).toBeUndefined()

  await ui.unmount()
})
