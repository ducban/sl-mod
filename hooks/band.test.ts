import type { On, SessionUsage, SessionUsageArgs } from 'claude-code'
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
const stand = (
  on: On,
  now?: number,
  usage?: SessionUsage | ((args: SessionUsageArgs) => SessionUsage),
  hasVersionFile = true,
  // Every `$.ui.open` the mod makes, in order, for the tabs test. A second
  // `on('ui.open')` in the test body fails the whole module load with
  // `on("ui.open") registered twice`, so the recorder has to live in here.
  opens?: { id: string; focus: boolean }[],
  // What `$.store` holds when the session starts: another session's shared
  // usage reading, for the tests that must not reach the network.
  store?: Readonly<Record<string, unknown>>,
) => {
  // mock answers clock, store and env from memory; `on` is how it registers.
  // Registered exactly once per test: a second mock.clock(on) fails the module
  // load with `on("clock.now") registered twice`.
  mock.clock(on, now === undefined ? undefined : { now })
  mock.store(on, store)
  on('session.cwd', () => ({ value: '/home/bannd/Workspace/Projects/personal_works/sl-mod' }))
  on('session.model', () => ({ value: 'claude-opus-5' }))
  on('session.usage', (_, e) => ({
    value: (typeof usage === 'function' ? usage(e) : usage) ?? {
      startedAt: 0,
      context: { tokens: 660000, window: 1000000, percent: 66 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 8, resetsAt: '2026-10-06T09:30:00.000Z' },
        { kind: 'seven_day', percentUsed: 36, resetsAt: '2026-10-09T23:00:00.000Z' },
      ],
      cost: { usd: 1 },
    },
  }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  // The bottom of the config chain: a set goes through as asked.
  on('config.set', ($, e) => ({ value: e.value }))
  // refreshVersion walks a chain of files and falls through to a git tag. Only
  // the plugin manifest answers, so the version cell reads the mod's own
  // version -- which is what it does in this repo.
  // Matched by suffix: the engine may resolve the relative path before the
  // event is raised, so an equality check on the spelling the mod passed is not
  // safe.
  on('fs.exists', ($, e) => ({ value: hasVersionFile && e.path.endsWith('plugin.json') }))
  // `fs.read` answers the text itself, not an object wrapping it.
  on('fs.read', () => ({ value: '{"name":"sl-mod","version":"0.1.0"}' }))
  on('ui.open', ($, e) => {
    opens?.push({ id: e.id, focus: e.focus === true })

    return { value: { isPlaced: true } }
  })
  // Dispatched on the command, because the mod runs two different ones and they
  // answer differently here: a clean branch in the --porcelain=v2 shape
  // refreshGit parses, and a repo with no tags -- `git describe` exiting 1,
  // which is what both of these repos actually do.
  on('process.run', ($, e) => {
    const isStatus = e.argv[1] === 'status'

    return {
      value: {
        exitCode: isStatus ? 0 : 128,
        stdout: isStatus ? '# branch.head main\n# branch.ab +0 -0\n' : '',
        stderr: isStatus ? '' : 'fatal: No names found, cannot describe anything.',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
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

test('effort is picked outright, so the band cannot report a level nobody set', async ($, on) => {
  stand(on)

  // No turn has run and no classic hook has fired, so nothing has reported an
  // effort and the model cell carries none.
  const band = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /\((L|M|H|X|✦)\)/ })).toBeUndefined()

  // The choices run session, low, medium, high, xhigh, max. Two presses from
  // `session` land on medium -- NOT on high, which is where a relative nudge
  // landed when it guessed `medium` for a baseline it had never been told.
  const pane = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...SETTINGS })
  await pane.press({ key: 'item-effort' })
  await pane.press({ key: 'item-effort' })

  expect(await band.find({ type: 'Text', text: /\(M\)/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /\(H\)/ })).toBeUndefined()

  // And round the end of the list is `session` again: no opinion, nothing drawn.
  for (let i = 0; i < 4; i += 1) await pane.press({ key: 'item-effort' })
  expect(await band.find({ type: 'Text', text: /\((L|M|H|X|✦)\)/ })).toBeUndefined()

  await pane.unmount()
  await band.unmount()
})

test('a classic hook reports the effort turn.step never carried', async ($, on) => {
  stand(on)
  // turn.step's `effort` is absent for a request that names none, which is what
  // this session does, so the cell stayed blank until someone pressed a key.
  // The classic hooks carry `effort.level` after any silent downgrade.
  on('classic.Stop', () => ({}))

  await $.classic.Stop({ effort: { level: 'medium' }, stop_hook_active: false })

  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /\(M\)/ })).toBeDefined()

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

// A window scoped to a model is labelled with the model, lowercased.
const SCOPED = 'fable'

const reply = () =>
  JSON.stringify({
    limits: [
      { kind: 'session', group: 'session', percent: 9, scope: null, resets_at: '2026-10-06T13:45:00.000Z' },
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
  // And the reset with it: 12:00 against the endpoint's 13:45, not the engine's
  // 09:30, so the countdown and the percent come from the same reading.
  expect(await ui.find({ type: 'Text', text: /\u{21BB}1h45m/u })).toBeDefined()

  await ui.unmount()
})

test('the 5h cell counts down to its reset, and the reset key takes it off', async ($, on) => {
  // 07:16 against a window that resets at 09:30: two hours and fourteen minutes.
  stand(on, Date.parse('2026-10-06T07:16:00Z'))
  endpoint(on, { auth: false })

  await $.classic.SessionStart({ source: 'startup' })
  const band = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  // The reset is its own Text, in its own colour, so it is found on its own.
  expect(await band.find({ type: 'Text', text: /5h .* 8%/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /\u{21BB}2h14m/u })).toBeDefined()
  // 07:16 is an even minute, so the week shows its countdown: 3d 15h 44m to
  // the 9th at 23:00, in days and hours.
  expect(await band.find({ type: 'Text', text: /\u{21BB}3d15h/u })).toBeDefined()

  const pane = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...SETTINGS })
  await pane.press({ key: 'item-reset' })
  expect(await band.find({ type: 'Text', text: /\u{21BB}/u })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /5h .* 8%/ })).toBeDefined()

  await pane.unmount()
  await band.unmount()
})

test('a line the terminal has no room for drops its bars, and keeps its figures', async ($, on) => {
  stand(on, Date.parse('2026-10-06T07:16:00Z'))
  endpoint(on, { auth: false })

  await $.classic.SessionStart({ source: 'startup' })
  // Line two in full is some 50 cells; 40 is not enough.
  const narrow = await $.ui.mount({
    plugin: 'sl-mod',
    surface: 'terminal',
    ...BAND,
    props: { ...BAND.props, bodyColumns: 40 },
  })
  expect(await narrow.find({ type: 'Text', text: /5h 8%/ })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: /5h \u{25B0}/u })).toBeUndefined()
  expect(await narrow.find({ type: 'Text', text: /\u{21BB}2h14m/u })).toBeDefined()
  // Line one fits in 40 and keeps its shape: the folder cell is still there.
  expect(await narrow.find({ type: 'Text', text: /sl-mod/ })).toBeDefined()
  await narrow.unmount()

  const wide = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  expect(await wide.find({ type: 'Text', text: /5h \u{25B0}/u })).toBeDefined()
  await wide.unmount()
})

test('switching to a light theme redraws the band in the Day palette', async ($, on) => {
  stand(on)
  endpoint(on, { auth: false })

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  // The harness answers `config.list` itself, with no theme row, so the band
  // starts on Moon: the first cell of a row takes the darkest step.
  const first = () => ui.find({ type: 'Text', text: /\u{25B0}/u })
  expect((await first())?.props.backgroundColor).toBe('#3b4261')

  // Changing the theme the way /config does raises `config.set`, which is
  // what the mod listens for.
  const set = await $.config.set({
    key: 'theme',
    value: 'light',
    previous: 'dark',
    provider: { plugin: '', tier: 'user' },
    origin: { kind: 'composer' },
  })
  expect(set.deny).toBeUndefined()
  expect((await first())?.props.backgroundColor).toBe('#c4c8da')

  await ui.unmount()
})

test('a reset that has passed reads now, never a negative number', async ($, on) => {
  stand(on, Date.parse('2026-10-06T09:31:00Z'))
  endpoint(on, { auth: false })

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /\u{21BB}now/u })).toBeDefined()
  // 09:31 is an odd minute, so the week shows the date instead. Spelled in
  // the machine's own zone, so only the shape is checked.
  expect(await ui.find({ type: 'Text', text: /\u{21BB}Oct \d{1,2} \d{1,2}:\d\d[ap]m/u })).toBeDefined()

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

// Every session on the box shares one `$.store`, so a reading one session
// fetched is the machine's reading. These three pin that: a fresh one is
// adopted without a call, a backoff one session took holds for the others, and
// a stale one is fetched again. Seeded through `stand`'s last argument.
const SHARED = (at: number, nextAllowedAt = 0) => ({
  usage: {
    windows: [
      { kind: 'session', percentUsed: 9, scope: null },
      { kind: 'weekly_all', percentUsed: 39, scope: null },
      { kind: 'weekly_scoped', percentUsed: 26, scope: 'Fable' },
    ],
    fetchedAt: at,
    nextAllowedAt,
  },
})

test('a reading another session fetched inside the poll period is adopted, not fetched again', async ($, on) => {
  const T = Date.parse('2026-10-06T12:00:00Z')
  stand(on, T, undefined, true, undefined, SHARED(T - 30_000))
  const seen = endpoint(on, { body: reply() })

  await $.classic.SessionStart({ source: 'startup' })
  expect(seen.calls()).toBe(0)

  // And it is drawn as this session's own would be: the per-model week is there.
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: new RegExp(`${SCOPED}.*26%`) })).toBeDefined()
  // The shared reading is in the old shape, with no reset, so the resets come
  // from the engine's own windows: 09:30 has passed at 12:00, and the week is
  // 3d 11h off on an even minute.
  expect(await ui.find({ type: 'Text', text: /\u{21BB}now/u })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\u{21BB}3d11h/u })).toBeDefined()

  await ui.unmount()
})

test('a 429 one session took holds every session off the endpoint until the backoff ends', async ($, on) => {
  const T = Date.parse('2026-10-06T12:00:00Z')
  // Stale reading, so only the shared backoff can be what stops the call.
  stand(on, T, undefined, true, undefined, SHARED(T - 10 * 60_000, T + 5 * 60_000))
  const seen = endpoint(on, { body: reply() })

  await $.classic.SessionStart({ source: 'startup' })
  expect(seen.calls()).toBe(0)
})

test('a shared reading older than the poll period is fetched again', async ($, on) => {
  const T = Date.parse('2026-10-06T12:00:00Z')
  stand(on, T, undefined, true, undefined, SHARED(T - 4 * 60_000))
  const seen = endpoint(on, { body: reply() })

  await $.classic.SessionStart({ source: 'startup' })
  expect(seen.calls()).toBe(1)
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

test('a repo with no version does not take the git cell down with it', async ($, on) => {
  // The version probe used to run `git describe` unguarded, between the git
  // refresh and the timers, inside a GATING hook -- `claude plugin validate`
  // warned about that in as many words and it was ignored. A repo with no tags
  // was enough to leave session.start without its poll and without next(e).
  // Nothing on disk declares a version, so the probe falls all the way through
  // to `git describe`. Passed to `stand`: a second on('fs.exists') here fails
  // the module load outright.
  stand(on, undefined, undefined, false)

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })

  expect(await ui.find({ type: 'Text', text: /main/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0\.1\.0/ })).toBeUndefined()

  await ui.unmount()
})

test('a compaction drops the context gauge instead of pinning the old number', async ($, on) => {
  // `session.measure` does not fire for a compaction: Ban watched a session
  // compact and the `ct` gauge sit at 38%. That number was true when it was
  // taken, which is the worst kind of wrong -- it reads as current.
  //
  // Two hooks cover it. `session.compact` takes the figure straight off the
  // compaction's own result (`tokensAfter`), which is the better source but
  // cannot be raised here: the harness has no transcript, so `e.messages` is not
  // a list and every hook in the chain is skipped for passing it on. What is
  // tested is the backstop, `classic.PostCompact`.
  //
  // The reading is shaped as the engine shapes it right after a compaction:
  // `context` is `{ window }` with no `percent` -- the field is dropped, not
  // held stale -- and the fill exists only in the breakdown, when asked for.
  // On 2026-10-19 a backstop that read `percent` alone found nothing and left
  // the band at 20% while /context said 9%.
  let percent: number | null = 66
  let estimate: number | null = null
  const reading = (args: SessionUsageArgs): SessionUsage => ({
    startedAt: 0,
    context: {
      window: 1_000_000,
      ...(percent === null ? {} : { tokens: percent * 10_000, percent }),
      ...(args?.breakdown && estimate !== null ? { breakdown: { percentage: estimate } } : {}),
    } as SessionUsage['context'],
    rateLimits: [],
    cost: { usd: 1 },
  })
  stand(on, undefined, reading)
  on('classic.PostCompact', () => ({}))

  await $.classic.SessionStart({ source: 'startup' })
  const ui = await $.ui.mount({ plugin: 'sl-mod', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /ct .* 66%/ })).toBeDefined()

  // The real shape: no `percent`, a breakdown that says 9.
  percent = null
  estimate = 9
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: 'summary' })
  expect(await ui.find({ type: 'Text', text: /ct .* 9%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /66%/ })).toBeUndefined()

  // No breakdown either: nothing to take, and nothing to crash on.
  estimate = null
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: 'summary' })
  expect(await ui.find({ type: 'Text', text: /ct .* 9%/ })).toBeDefined()

  // The guard on the plain reading: a `percent` that is present here has not
  // caught up and is the pre-compaction figure, so only one that moved DOWN is
  // taken.
  percent = 80
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary' })
  expect(await ui.find({ type: 'Text', text: /ct .* 9%/ })).toBeDefined()

  percent = 5
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'summary' })
  expect(await ui.find({ type: 'Text', text: /ct .* 5%/ })).toBeDefined()

  await ui.unmount()
})

// The tabs are the engine's: it draws no title for a lone pane and a tab strip
// as soon as a second is open. So what the mod owes is opening both, and
// raising the one asked for -- which `focus: true` does, and which is why the
// order matters.
test('a /sl-* command opens both panes, so the engine draws them as tabs', async ($, on) => {
  const opens: { id: string; focus: boolean }[] = []
  stand(on, undefined, undefined, true, opens)

  // On `$` inside a test, `command.run` is the event call, not the plugin-side
  // shorthand: it wants the whole input, the two the engine would stamp
  // included.
  const run = (command: string) =>
    $.command.run({
      command,
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 120 },
    })

  await run('sl-help')
  expect(opens).toEqual([
    { id: 'sl-settings', focus: false },
    { id: 'sl-legend', focus: true },
  ])

  opens.length = 0
  await run('sl-settings')
  expect(opens).toEqual([
    { id: 'sl-legend', focus: false },
    { id: 'sl-settings', focus: true },
  ])
})
