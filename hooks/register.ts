import type { EngineInterface, Register } from 'claude-code'

// A status line in the band above the prompt.
//
// Why a mod and not a `statusLine` command: the command it replaces,
// `claude-powerline`, costs ~57 ms a render here, nearly all of it Node
// starting up, and then it reads 127 MB of transcripts to total the tokens.
// A mod is loaded once, so the draw is a function call.
//
// The shape that keeps it that way: nothing expensive happens while drawing.
// `session.measure` PUSHES usage here whenever a figure moves, git is refreshed
// on a timer, and the `ui.render` hook only reads what those left behind.

// --- Tokyo Night Moon, the palette the old status line was already using -----
// Read off its ANSI output rather than guessed, so the two look like one thing.
const BLUE = '#82aaff'
const PINK = '#fca7ea'
const GREEN = '#c3e88d'
const CYAN = '#86e1fc'
const FG = '#c0caf5'
const AMBER = '#ffc777' // not in the old output; added for the warning band
const RED = '#ff757f' // likewise
const MUTED = '#414868' // a background step of theirs, reused as a dim foreground

// Background steps, darkest first. Each segment takes the next one, which is
// what gives the row its depth.
const BG = ['#2f334d', '#1e2030', '#222436', '#414868'] as const
// Indexing wraps, so a row of any length keeps stepping through the shades.
const bg = (i: number) => BG[i % BG.length] as string

// --- Gauges ------------------------------------------------------------------
// Five segments of 20%, rounded UP: 19% has to show one segment, not none. A
// quota must never read lower than it is. Only a true zero is empty.
const FILLED = '▰'
const EMPTY = '▱'
const bar = (percent: number) => {
  const on = percent <= 0 ? 0 : Math.min(5, Math.ceil(percent / 20))
  return FILLED.repeat(on) + EMPTY.repeat(5 - on)
}

// Colour follows the reading, not the segment: green until it is worth a look,
// red once it is nearly gone.
const barColor = (percent: number) => (percent >= 85 ? RED : percent >= 60 ? AMBER : GREEN)

// Effort uses a different glyph family from the quota bars on purpose. One is
// the level you chose, the other is how much you have spent, and they should
// not read as the same kind of thing.
const EFFORT_FILLED = '▮'
const EFFORT_EMPTY = '▯'
const EFFORT_STEPS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const EFFORT_LETTER: Record<string, string> = {
  low: 'L',
  medium: 'M',
  high: 'H',
  xhigh: 'X',
  max: '✦',
}
// `$.session.model()` answers the id, `claude-opus-5`. The display name lives
// in the status line payload, which a mod never sees, so the names are here.
// Anything unmapped is derived rather than printed raw: drop `claude-`, drop a
// trailing date, title-case the family and join the version with a dot, so a
// model added after this was written still reads as a name.
const MODEL_NAME: Record<string, string> = {
  'claude-opus-5': 'Opus 5',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-fable-5-1': 'Fable 5.1',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}
const modelName = (id: string) => {
  const known = MODEL_NAME[id]
  if (known) return known
  const parts = id.replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-')
  const family = parts.shift() ?? id
  const version = parts.join('.')
  const titled = family.charAt(0).toUpperCase() + family.slice(1)
  return version ? `${titled} ${version}` : titled
}

const effortBar = (level: string | undefined) => {
  if (!level) return null
  const step = EFFORT_STEPS.indexOf(level as (typeof EFFORT_STEPS)[number]) + 1
  if (step === 0) return { bar: EFFORT_EMPTY.repeat(5), letter: '?' }
  return {
    bar: EFFORT_FILLED.repeat(step) + EFFORT_EMPTY.repeat(5 - step),
    letter: EFFORT_LETTER[level] ?? '?',
  }
}

// A window's icon, by the kind the engine reports. Unknown kinds still draw --
// the row is built by walking whatever comes back, never by asking for two
// windows by name. The documented kinds are `five_hour`, `seven_day` and
// `spend_limit`; the 2.1.289 binary carries nine, and `/usage` shows a
// per-model week that neither this API nor the status line payload passes on.
// So a hardcoded pair would silently drop whatever is added next.
// Written as escapes, not as the characters themselves: the glyphs were lost
// in transit the first time and every icon came out as an empty string.
//
// NERD is false for a box that has no Nerd Font. The fallback set is plain
// Unicode, and the same glyphs the old status line was already drawing here, so
// it is known to render. This box does have Nerd Fonts -- 2126 of them -- and
// JetBrains Mono reaches them through fontconfig, which is how `\u{2731}` and
// `\u{2387}` show today although JetBrains Mono carries neither.
// Labels, not icons. Nerd Font glyphs here came out visibly smaller than the
// text beside them, and that cannot be fixed from a mod: JetBrains Mono carries
// none of them, so each one is drawn by whichever fallback font fontconfig
// reaches, at that font's metrics. Only a character JetBrains Mono has itself
// renders at the same size -- it has `◔ ■ □ █ ░ │ · ✓ ●` and not `▰ ▱ ▮ ▯`.
//
// Short words sidestep the whole question, and they say more than a glyph does.
const LABEL = {
  folder: 'dir',
  model: 'model',
  branch: 'git',
  context: 'ct',
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

// Two vocabularies for the same thing. The engine says `five_hour` and
// `seven_day`; the usage endpoint says `session`, `weekly_all` and
// `weekly_scoped`. A window carrying a scope is labelled with the model it is
// scoped to, so a per-model week reads as `fable` whatever its kind is called.
const labelFor = (kind: string, scope?: string | null) => {
  if (scope) return scope.toLowerCase()
  if (kind === 'five_hour' || kind === 'session') return LABEL.five_hour
  if (kind === 'seven_day' || kind === 'weekly_all') return LABEL.seven_day
  if (kind === 'spend_limit') return LABEL.spend_limit

  return kind
}

// --- What the drawing reads --------------------------------------------------
// Module-level, so a redraw costs nothing. They go back to their defaults when
// the module reloads, and each is filled again by the hook that owns it.
type Window = { kind: string; percentUsed: number; scope?: string | null }
type Effort = (typeof EFFORT_STEPS)[number]
let contextPercent: number | null = null
let windows: Window[] = []
let effort: string | undefined
let branch: string | null = null
let isDirty = false
let isAhead = false
let isHidden = false

// The rotate keys set this, and nothing else does. While it is null the
// `turn.step` hook passes every request through untouched, so the band starts
// out reporting the session's own effort rather than quietly steering it. Only
// once the user has pressed a key does this mod have an opinion -- which also
// means it cannot fight a change made through `/model` or the thinking toggle
// until asked to.
let effortOverride: Effort | null = null

const PANE = 'sl-legend'

// --- Where the windows come from --------------------------------------------
// The engine hands a mod two windows, `five_hour` and `seven_day`. The per-model
// week -- "Current week (Fable)" in /usage -- reaches neither a mod nor the
// status line payload, because the engine filters it out of both.
//
// `$.session.authorize()` gets round that without a credential ever reaching
// here. It answers an opaque handle for the session's own Anthropic token, and
// `$.http.fetch(url, { auth: handle })` spends it against a first-party host.
// The mod never reads .credentials.json and never refreshes anything, so the
// token rotation that can kill a Claude Code session is not in play: the engine
// owns the credential and keeps it fresh.
//
// Measured on this box: handle present, kind=bearer, HTTP 200, three windows
// including `weekly_scoped (Fable) 26%`.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const USAGE_BETA = 'oauth-2025-04-20'
const POLL_MS = 180_000
// Past this the reading isn't drawn and the engine's two live windows are used
// instead. Fewer bars is honest; a bar holding an hour-old number isn't.
const STALE_MS = 15 * 60_000

type Reading = {
  windows: Window[]
  at: number | null // when this came back, by $.clock.now()
  note: string // why there's nothing, in words, for /sl-debug
}
let reading: Reading = { windows: [], at: null, note: 'not fetched yet' }

// Anthropic rate-limits this endpoint, and this mod is not the only caller: ccuc
// polls the same account from three machines every five minutes, and a mod runs
// on each machine with Claude Code open. So a 429 has to mean stop, not try again
// in three minutes. Nothing is attempted before this time.
let nextAllowedAt = 0
// A 429 with no Retry-After, or one asking for something unreasonable.
const DEFAULT_BACKOFF_MS = 10 * 60_000
const MAX_BACKOFF_MS = 60 * 60_000

async function refreshUsage($: EngineInterface) {
  const now = await $.clock.now()
  if (now < nextAllowedAt) {
    reading = {
      ...reading,
      note: `backing off for ${Math.ceil((nextAllowedAt - now) / 1000)}s more`,
    }

    return
  }

  let auth
  try {
    auth = await $.session.authorize()
  } catch (err) {
    reading = { ...reading, note: `authorize threw: ${String(err).slice(0, 80)}` }

    return
  }
  // Null behind a gateway, on a third-party provider, or with nobody logged in.
  if (!auth) {
    reading = { ...reading, note: 'no first-party credential to spend' }

    return
  }

  let res
  try {
    res = await $.http.fetch(USAGE_URL, {
      auth: auth.handle,
      headers: { 'anthropic-beta': USAGE_BETA },
    })
  } catch (err) {
    reading = { ...reading, note: `unreachable: ${String(err).slice(0, 80)}` }

    return
  }
  if (!res.ok) {
    if (res.status === 429) {
      // Retry-After is seconds or an HTTP date; take seconds and sanity-bound it,
      // since a header asking for a week would silence the row until a restart.
      const asked = Number(res.headers['retry-after'] ?? res.headers['Retry-After'])
      const wait = Number.isFinite(asked) && asked > 0
        ? Math.min(asked * 1000, MAX_BACKOFF_MS)
        : DEFAULT_BACKOFF_MS
      nextAllowedAt = now + wait
      reading = { ...reading, note: `rate limited, waiting ${Math.round(wait / 1000)}s` }

      return
    }
    reading = { ...reading, note: `http ${res.status}` }

    return
  }

  let limits: unknown
  try {
    limits = (JSON.parse(res.text) as Record<string, unknown>).limits
  } catch {
    reading = { ...reading, note: 'response was not JSON' }

    return
  }
  if (!Array.isArray(limits)) {
    reading = { ...reading, note: 'no limits array in the body' }

    return
  }

  const windows = limits.flatMap(entry => {
    const one = entry as Record<string, any>
    const kind = typeof one.kind === 'string' ? one.kind : null
    const percent = typeof one.percent === 'number' ? one.percent : null
    if (kind === null || percent === null) return []

    return [{ kind, percentUsed: percent, scope: one.scope?.model?.display_name ?? null }]
  })

  // An empty array means the account has no window to report. Drawing zeroes
  // would be inventing them, so nothing is drawn.
  nextAllowedAt = 0
  reading = {
    windows,
    at: windows.length > 0 ? now : null,
    note: windows.length > 0 ? '' : 'the body carried no windows',
  }
}

// A digit is the only key that reaches a band Button while the band has no
// keyboard focus, and then only from an empty prompt -- every letter goes to the
// composer. So the rotate keys are digits, and 1-3 stay free for tabs.
//
// Declared up here, not inside `register`: `claude plugin validate` follows `$`
// only into a function declared at the top of the file, and refuses a closure it
// cannot trace. tsc was happy with it either way.
function rotateEffort($: EngineInterface, by: number) {
  const from = effortOverride ?? (effort as Effort | undefined) ?? 'medium'
  const at = EFFORT_STEPS.indexOf(from)
  const to = EFFORT_STEPS[Math.min(EFFORT_STEPS.length - 1, Math.max(0, at + by))]
  if (to) effortOverride = to
  $.ui.invalidate('ui.render')
}

async function refreshGit($: EngineInterface) {
  // `--porcelain=v2 --branch` answers all three questions in one call: the
  // branch name, whether anything is modified, and how far ahead of upstream.
  const { exitCode, stdout } = await $.process.run(
    ['git', 'status', '--porcelain=v2', '--branch'],
    { timeoutMs: 3000 },
  )
  if (exitCode !== 0) {
    branch = null
    return
  }
  const lines = stdout.split('\n')
  const head = lines.find(l => l.startsWith('# branch.head '))
  branch = head ? head.slice('# branch.head '.length).trim() : null
  if (branch === '(detached)') branch = null
  isDirty = lines.some(l => /^[12u?] /.test(l))
  const ab = lines.find(l => l.startsWith('# branch.ab '))
  isAhead = ab ? Number(ab.split(' ')[2] ?? '+0') > 0 : false
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of [
      ['sl', 'Show or hide the status line band'],
      ['sl-help', 'Open the status line legend'],
      ['sl-effort', 'Set reasoning effort: low, medium, high, xhigh, max, or off'],
      ['sl-debug', 'Print the raw session usage the status line reads'],
    ] as const) {
      await $.command.register({ name, description })
    }

    // Hiding the band is a preference, so it outlives the session. `$.store` is
    // shared by every session on the machine, which is what is wanted here: the
    // band is either something you want above your prompt or it is not.
    isHidden = (await $.store.get('isHidden')) === true

    // The first reading, before any measurement has been pushed.
    const usage = await $.session.usage()
    contextPercent = usage.context.percent ?? null
    windows = usage.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed }))

    await refreshGit($)
    // Git is the one figure nothing pushes, so it is the one thing polled --
    // off the draw path, where its cost does not show.
    $.clock.every(5000, () => void refreshGit($))

    // Off the draw path, always: a network call must never sit between a
    // keystroke and a frame.
    void refreshUsage($)
    $.clock.every(POLL_MS, () => void refreshUsage($))

    return next(e)
  })

  // `session.start` does not fire after /clear, /resume or /branch -- the guide
  // is explicit about it -- so the readings would quietly age from whenever the
  // session began. This picks them up again. It also happens to be the only
  // event a test can raise, which is how the fallback paths below are covered.
  on('classic.SessionStart', async ($, e, next) => {
    const usage = await $.session.usage()
    contextPercent = usage.context.percent ?? null
    windows = usage.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed }))
    await refreshGit($)
    await refreshUsage($)

    return next(e)
  })

  // Pushed, not polled: this fires when a figure actually moves.
  on('session.measure', async ($, e, next) => {
    contextPercent = e.context.percent ?? contextPercent
    windows = e.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed }))

    return next(e)
  })

  // The only place effort can be read. `$.env.get('CLAUDE_EFFORT')` is
  // `undefined` in here -- the engine exports that variable to hook commands
  // and to Bash, not to a hooks module, which cost an afternoon to find out.
  // So it is unknown until the first model request of the session, and what
  // shows afterwards is the effort actually sent, after any silent downgrade.
  on('turn.step', async function* ($, e, next) {
    if (typeof e.effort === 'string') effort = e.effort
    if (effortOverride !== null && effortOverride !== e.effort) {
      yield* next({ ...e, effort: effortOverride })

      return
    }
    yield* next(e)
  })

  on('command.run', { command: 'sl' }, async $ => {
    isHidden = !isHidden
    await $.store.set('isHidden', isHidden)
    $.ui.invalidate('ui.render')

    return { text: isHidden ? 'Status line hidden. `/sl` brings it back.' : 'Status line shown.' }
  })

  on('command.run', { command: 'sl-help' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Status line', focus: true, closeOnEscape: true })

    return {}
  })

  on('command.run', { command: 'sl-effort' }, async ($, e) => {
    const asked = (e.args ?? '').trim().toLowerCase()
    if (asked === 'off' || asked === 'reset') {
      effortOverride = null
      $.ui.invalidate('ui.render')

      return { text: 'Effort override cleared; the session decides again.' }
    }
    if (!EFFORT_STEPS.includes(asked as Effort)) {
      return { text: `Effort is one of ${EFFORT_STEPS.join(', ')}, or off to stop overriding.` }
    }
    effortOverride = asked as Effort
    $.ui.invalidate('ui.render')

    return { text: `Effort set to ${asked} for the requests this session sends from now on.` }
  })

  on('command.run', { command: 'sl-debug' }, async $ => {
    const [usage, model] = await Promise.all([$.session.usage(), $.session.model()])

    return {
      text: [
        `rateLimits: ${usage.rateLimits.length} entry(s)`,
        ...usage.rateLimits.map((w, i) => `  [${i}] ${JSON.stringify(w)}`),
        `context: ${JSON.stringify(usage.context)}`,
        `cost: ${JSON.stringify(usage.cost)}`,
        `model: ${model}`,
        `effort (from turn.step): ${effort ?? 'not seen yet'}`,
        `git: branch=${branch} dirty=${isDirty} ahead=${isAhead}`,
        `usage endpoint: ${reading.windows.length} window(s)`,
        ...reading.windows.map(w => `  ${w.kind}${w.scope ? ` (${w.scope})` : ''} ${w.percentUsed}%`),
        `  note=${reading.note || 'ok'}`,
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A survey owns the band while it is up; stand aside rather than fight it.
    if (e.props.hasSurvey || isHidden) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const cwd = await $.session.cwd()
    const folder = cwd.replace(/\/+$/, '').split('/').pop() || '/'
    const model = await $.session.model()

    // While Claude works the spinner is what matters, so the row steps back.
    const dim = e.props.isWorking

    // One powerline cell: its own background, and a separator carrying this
    // background as its foreground so it melts into the next cell.
    //
    // No `key` on these. `Text` does not take one, and a prop an element does
    // not take makes the engine throw the whole tree away and draw its own
    // band instead -- silently, apart from one dim line in the transcript. tsc
    // caught it; the running session would not have.
    const cell = (bg: string, nextBg: string, fg: string, text: string) => [
      Text({ backgroundColor: bg, color: fg, dimColor: dim, children: [` ${text} `] }),
      Text({ backgroundColor: nextBg, color: bg, dimColor: dim, children: [''] }),
    ]

    const identity = [
      ...cell(bg(0), bg(1), BLUE, `${LABEL.folder} ${folder}`),
      ...cell(
        bg(1),
        bg(2),
        PINK,
        (() => {
          // Draw the override when there is one, so the row shows what will be
          // sent rather than what was last seen. A `*` says the mod is steering.
          const shown = effortOverride ?? effort
          const eff = effortBar(shown)
          const name = modelName(model)
          const mark = effortOverride ? '*' : ''
          return eff
            ? `${LABEL.model} ${name} ${eff.bar} (${eff.letter}${mark})`
            : `${LABEL.model} ${name}`
        })(),
      ),
      ...(branch
        ? cell(
            bg(2),
            bg(3),
            isDirty ? AMBER : isAhead ? CYAN : GREEN,
            `${LABEL.branch} ${branch} ${isDirty ? '\u{25CF}' : isAhead ? '^' : '\u{2713}'}`,
          )
        : []),
      // The controls sit in a cell of their own, with a background, so they read
      // as part of the row rather than as dim text trailing off the end of it.
      // `plain: true` puts the key in front of the label -- `4: -` -- which is
      // the whole point of them being here: the keys only fire from an empty
      // prompt, so they have to be discoverable without being pressed.
      Box({
        backgroundColor: bg(3),
        flexDirection: 'row',
        columnGap: 2,
        paddingLeft: 1,
        paddingRight: 1,
        children: [
          Button({
            key: 'effort-down',
            label: 'less',
            hotkey: '4',
            plain: true,
            dimColor: dim,
            onPress: () => rotateEffort($, -1),
          }),
          Button({
            key: 'effort-up',
            label: 'more',
            hotkey: '5',
            plain: true,
            dimColor: dim,
            onPress: () => rotateEffort($, 1),
          }),
          Button({
            key: 'legend',
            label: 'help',
            hotkey: '0',
            plain: true,
            dimColor: dim,
            onPress: () =>
              void $.ui.open({ id: PANE, title: 'Status line', focus: true, closeOnEscape: true }),
          }),
        ],
      }),
    ]

    // Which reading to draw. The remote one is preferred because it is the only
    // one carrying the per-model week, but only while it is fresh: past the
    // staleness bound the engine's two live windows are used instead. Fewer bars
    // is honest, a bar holding a number from an hour ago is not.
    const now = await $.clock.now()
    const age = reading.at === null ? null : now - reading.at
    const fresh = reading.windows.length > 0 && age !== null && age < STALE_MS
    const shown = fresh ? reading.windows : windows

    // Every gauge means the same thing -- how much of an allowance is gone --
    // so they can sit in one row and be read at a glance.
    const gauges = [
      ...(contextPercent === null
        ? []
        : cell(
            bg(0),
            bg(1),
            barColor(contextPercent),
            `${LABEL.context} ${bar(contextPercent)} ${contextPercent}%`,
          )),
      ...shown.flatMap((w, i) =>
        cell(
          bg(i + 1),
          bg(i + 2),
          barColor(w.percentUsed),
          `${labelFor(w.kind, w.scope)} ${bar(w.percentUsed)} ${Math.round(w.percentUsed)}%`,
        ),
      ),
    ]

    if (identity.length === 0 && gauges.length === 0) return next(e)

    return Box({
      flexDirection: 'column',
      children: [
        Box({ flexDirection: 'row', children: identity }),
        Box({ flexDirection: 'row', children: gauges }),
      ],
    })
  })

  // The legend. A pane rather than a toast: a toast is gone in four seconds and
  // this is a page to read. Esc closes it, and it is drawn from the same values
  // the band uses, so it cannot describe a row the band is not showing.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const row = (left: string, right: string) =>
      Box({
        flexDirection: 'row',
        children: [
          Text({ color: FG, children: [left.padEnd(22)] }),
          Text({ color: MUTED, wrap: 'wrap', children: [right] }),
        ],
      })
    const gap = Text({ children: [' '] })

    return Box({
      flexDirection: 'column',
      children: [
        Text({ color: BLUE, bold: true, children: ['Row one -- what this session is'] }),
        row(`${LABEL.folder}`, 'the working directory, last segment only'),
        row(`${LABEL.model}`, 'the model, with the effort it is sending'),
        row(
          `${LABEL.branch}`,
          '\u{2713} clean, \u{25CF} uncommitted changes, ^ ahead of upstream',
        ),
        gap,
        Text({ color: BLUE, bold: true, children: ['Row two -- what it has spent'] }),
        row(`${LABEL.context}`, 'how full the context window is'),
        row(`${LABEL.five_hour}`, 'the five-hour window'),
        row(`${LABEL.seven_day}`, 'the seven-day window'),
        row('fable', 'a window scoped to one model, labelled with that model'),
        row('<kind>', 'any other window the engine reports, under its own name'),
        gap,
        Text({ color: BLUE, bold: true, children: ['Reading a gauge'] }),
        row('\u{25B0}\u{25B1}\u{25B1}\u{25B1}\u{25B1}  1-20%', 'five segments of 20%, rounded UP'),
        row('\u{25B0}\u{25B0}\u{25B1}\u{25B1}\u{25B1}  21-40%', 'so 19% shows one segment, never none'),
        row('\u{25B0}\u{25B0}\u{25B0}\u{25B0}\u{25B0}  81-100%', 'a quota must not read lower than it is'),
        row('colour', 'green under 60%, amber from 60, red from 85'),
        gap,
        Text({ color: BLUE, bold: true, children: ['Effort'] }),
        row(
          '\u{25AE}\u{25AE}\u{25AF}\u{25AF}\u{25AF} (M)',
          'a different glyph from the gauges on purpose: the level you picked, not what you spent',
        ),
        row('L M H X \u{2726}', 'low, medium, high, xhigh, max'),
        row('(H*)', 'the star means this mod is overriding it'),
        gap,
        Text({ color: BLUE, bold: true, children: ['Keys and commands'] }),
        row('4 less  5 more', 'effort down, effort up -- from an empty prompt only'),
        row('0 help', 'open this legend; the button is clickable too'),
        row('/sl', 'hide or show the band'),
        row('/sl-effort <level>', 'set it outright, or `off` to stop overriding'),
        row('/sl-debug', 'print what the engine reports'),
        row('Esc', 'close this pane'),
        gap,
        Text({
          color: MUTED,
          wrap: 'wrap',
          children: [
            'Effort is blank until the first model request: the engine does not hand a mod the session setting, only what each request carries.',
          ],
        }),
      ],
    })
  })
}
