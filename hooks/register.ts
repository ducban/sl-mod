import type { EngineInterface, Register } from 'claude-code'

// A status line in the band above the prompt.
//
// Why a mod and not a `statusLine` command: the command it replaces costs ~57 ms
// a render here, nearly all of it Node starting up, and then it reads 127 MB of
// transcripts to total the tokens. A mod is loaded once, so the draw is a
// function call.
//
// The shape that keeps it that way: nothing expensive happens while drawing.
// `session.measure` PUSHES usage here whenever a figure moves, git and the
// project version are refreshed on a timer, and the `ui.render` hooks only read
// what those left behind.

// --- Tokyo Night Moon, the palette the old status line was already using -----
const BLUE = '#82aaff'
const PINK = '#fca7ea'
const GREEN = '#c3e88d'
const CYAN = '#86e1fc'
const FG = '#c0caf5'
const AMBER = '#ffc777'
const RED = '#ff757f'
const MUTED = '#414868'

// Background steps, darkest first. Each segment takes the next one, which is
// what gives a row its depth.
const BG = ['#2f334d', '#1e2030', '#222436', '#414868'] as const
const bg = (i: number) => BG[i % BG.length] as string

// --- Glyphs ------------------------------------------------------------------
// Every one written as a `\u{...}` escape. Written as characters they were lost
// in a file write once already, and the symptom was quiet: every icon became an
// empty string, and the powerline separator drew nothing at all for four
// commits.
//
// Measured with `fc-list :charset=<cp>`, because a glyph JetBrains Mono does not
// carry is drawn by whichever fallback font fontconfig reaches, at that font's
// metrics -- which is why some of these sit a shade smaller than the row.
//
//   in JetBrains Mono    E0B0 2302 2713 25CF 21E1 25B2 25BC 00B7 25A0 25A1 2588 2591 2593
//   from a fallback      F07B F1B2 E725 (Nerd Font) and 25B0 25B1 25AE 25AF
const ICON = {
  folder: '\u{F07B}', // nf-fa-folder
  model: '\u{F1B2}', // nf-fa-cube
  branch: '\u{E725}', // nf-dev-git_branch
  version: '\u{2302}', // house
  dirty: '\u{25CF}', // uncommitted changes
  ahead: '\u{21E1}', // ahead of upstream
  clean: '\u{2713}', // nothing to commit
  sep: '\u{E0B0}', // the powerline separator between two cells
  dot: '\u{00B7}',
  up: '\u{25B2}',
  down: '\u{25BC}',
}

// --- Gauges ------------------------------------------------------------------
// Five segments of 20%, rounded UP: 19% has to show one segment, not none. A
// quota must never read lower than it is. Only a true zero is empty.
const FILLED = '\u{25B0}'
const EMPTY = '\u{25B1}'
const bar = (percent: number) => {
  const on = percent <= 0 ? 0 : Math.min(5, Math.ceil(percent / 20))

  return FILLED.repeat(on) + EMPTY.repeat(5 - on)
}

// Colour follows the reading, not the segment: green until it is worth a look,
// red once it is nearly gone.
const barColor = (percent: number) => (percent >= 85 ? RED : percent >= 60 ? AMBER : GREEN)

// Effort uses a different glyph family from the quota bars on purpose. One is
// the level you chose, the other is how much you have spent.
const EFFORT_FILLED = '\u{25AE}'
const EFFORT_EMPTY = '\u{25AF}'
const EFFORT_STEPS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
const EFFORT_LETTER: Record<string, string> = {
  low: 'L',
  medium: 'M',
  high: 'H',
  xhigh: 'X',
  max: '\u{2726}',
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

// `$.session.model()` answers the id, `claude-opus-5`. The display name lives in
// the status line payload, which a mod never sees, so the names are here.
// Anything unmapped is derived rather than printed raw, so a model added after
// this was written still reads as a name.
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

  return version ? `${family.charAt(0).toUpperCase() + family.slice(1)} ${version}` : family
}

// --- What can be on the band, and where -------------------------------------
// One entry per item, in the order they are drawn within a line. The hotkey is
// what presses that item's row in the settings pane: one digit or one lowercase
// letter, which is all a Button takes -- `$` was refused.
type ItemKey =
  | 'dir'
  | 'model'
  | 'git'
  | 'version'
  | 'context'
  | 'five_hour'
  | 'seven_day'
  | 'scoped'
  | 'spend'
  | 'other'
  | 'input'
  | 'output'
  | 'cache'
  | 'cost'

const ITEMS: { key: ItemKey; hotkey: string; name: string; about: string }[] = [
  { key: 'dir', hotkey: 'd', name: 'dir', about: 'the working directory, last segment only' },
  { key: 'model', hotkey: 'm', name: 'model', about: 'the model, with the effort it is sending' },
  { key: 'git', hotkey: 'g', name: 'git', about: 'branch, and whether it is clean' },
  { key: 'version', hotkey: 'v', name: 'version', about: "the open project's own version" },
  { key: 'context', hotkey: 'c', name: 'context', about: 'how full the context window is' },
  { key: 'five_hour', hotkey: '5', name: '5h', about: 'the five-hour window' },
  { key: 'seven_day', hotkey: '7', name: '7d', about: 'the seven-day window' },
  { key: 'scoped', hotkey: 'f', name: 'scoped', about: 'a window scoped to one model' },
  { key: 'spend', hotkey: 'p', name: 'spend', about: "a gateway's spend limit" },
  { key: 'other', hotkey: 'x', name: 'other', about: 'any other window, under its own name' },
  { key: 'input', hotkey: 'i', name: 'input', about: 'uncached input tokens this session' },
  { key: 'output', hotkey: 'o', name: 'output', about: 'output tokens this session' },
  { key: 'cache', hotkey: 'h', name: 'cache', about: 'cache hit rate -- drawn only under 70%' },
  { key: 'cost', hotkey: 'u', name: 'cost', about: 'what this session has cost, in USD' },
]

// 0 is off; 1 to 4 is which line it sits on. Four lines is the cap.
const MAX_LINES = 4
type Layout = Record<ItemKey, number>
const DEFAULT_LAYOUT: Layout = {
  dir: 1,
  model: 1,
  git: 1,
  version: 1,
  context: 2,
  five_hour: 2,
  seven_day: 2,
  scoped: 2,
  spend: 2,
  other: 2,
  input: 0,
  output: 0,
  cache: 2,
  cost: 0,
}
let layout: Layout = { ...DEFAULT_LAYOUT }

// Which item a rate-limit window belongs to, so one toggle covers every window
// of that sort. The engine says `five_hour` and `seven_day`; the usage endpoint
// says `session`, `weekly_all` and `weekly_scoped`. A window carrying a scope is
// labelled with the model it is scoped to.
type Window = { kind: string; percentUsed: number; scope?: string | null }
const itemForWindow = (w: Window): ItemKey => {
  if (w.scope) return 'scoped'
  if (w.kind === 'five_hour' || w.kind === 'session') return 'five_hour'
  if (w.kind === 'seven_day' || w.kind === 'weekly_all') return 'seven_day'
  if (w.kind === 'spend_limit') return 'spend'

  return 'other'
}
const labelForWindow = (w: Window) => {
  if (w.scope) return w.scope.toLowerCase()
  const item = itemForWindow(w)
  if (item === 'five_hour') return '5h'
  if (item === 'seven_day') return '7d'
  if (item === 'spend') return 'spend'

  return w.kind
}

// --- What the drawing reads --------------------------------------------------
// Module-level, so a redraw costs nothing. They go back to their defaults when
// the module reloads, and each is filled again by the hook that owns it.
type Effort = (typeof EFFORT_STEPS)[number]
let contextPercent: number | null = null
let windows: Window[] = []
let effort: string | undefined
let branch: string | null = null
let isDirty = false
let isAhead = false
let isHidden = false
let projectVersion: string | null = null

// The rotate keys and `/sl-effort` set this, and nothing else does. While it is
// null the `turn.step` hook passes every request through untouched, so the band
// reports the session's own effort rather than quietly steering it.
let effortOverride: Effort | null = null

// Token counts, summed over the session's priced responses. The engine hands a
// mod one money figure -- the session total -- and no split, so `input` and
// `output` here are token counts and not dollars. Turning them into dollars
// would mean a price table in this file, and a price table in a file is a number
// that goes wrong silently the day the prices change.
let tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
let costUsd: number | null = null

// Cache hit is a number that reads 98-100% nearly always, and when it drops the
// money is already spent. So it is not drawn until it is worth acting on.
const CACHE_ALERT_BELOW = 70
const cacheHit = () => {
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite
  if (prompt === 0) return null

  return Math.round((tokens.cacheRead / prompt) * 100)
}

const tk = (n: number) =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(1)}k`
        : String(n)

const LEGEND = 'sl-legend'
const SETTINGS = 'sl-settings'

// --- Where the windows come from --------------------------------------------
// The engine hands a mod two windows, `five_hour` and `seven_day`. The per-model
// week -- "Current week (Fable)" in /usage -- reaches neither a mod nor the
// status line payload, because the engine filters it out of both.
//
// `$.session.authorize()` gets round that without a credential ever reaching
// here. It answers an opaque handle for the session's own Anthropic token, and
// `$.http.fetch(url, { auth: handle })` spends it against a first-party host.
// The mod never reads .credentials.json and never refreshes anything, so the
// token rotation that can kill a Claude Code session is not in play.
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
// on each machine with Claude Code open. So a 429 has to mean stop, not try
// again in three minutes.
let nextAllowedAt = 0
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
      // Retry-After is seconds or an HTTP date; take seconds and sanity-bound
      // it, since a header asking for a week would silence the row until a
      // restart.
      const asked = Number(res.headers['retry-after'] ?? res.headers['Retry-After'])
      const wait =
        Number.isFinite(asked) && asked > 0 ? Math.min(asked * 1000, MAX_BACKOFF_MS) : DEFAULT_BACKOFF_MS
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

  const fetched = limits.flatMap(entry => {
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
    windows: fetched,
    at: fetched.length > 0 ? now : null,
    note: fetched.length > 0 ? '' : 'the body carried no windows',
  }
}

// --- The open project's version ---------------------------------------------
// Whatever the repo in the cwd declares, in the order a repo is most likely to
// declare it. Nothing found means the cell is not drawn: `⌂ ?` says less than
// no cell at all.
//
// A version read from a git tag gets `+N` when HEAD has moved past it, because
// then the thing running is not the thing the tag names. A version read from a
// file gets no mark: claude-powerline's `✓` is its GIT-CLEAN symbol, not a
// version one, and the git cell two along already draws that.
const VERSION_FILES: { path: string; read: (text: string) => string | null }[] = [
  { path: 'package.json', read: t => (JSON.parse(t) as { version?: string }).version ?? null },
  {
    path: '.claude-plugin/plugin.json',
    read: t => (JSON.parse(t) as { version?: string }).version ?? null,
  },
  { path: 'pyproject.toml', read: t => t.match(/^\s*version\s*=\s*["']([^"']+)["']/m)?.[1] ?? null },
  { path: 'Cargo.toml', read: t => t.match(/^\s*version\s*=\s*["']([^"']+)["']/m)?.[1] ?? null },
]

async function refreshVersion($: EngineInterface) {
  for (const source of VERSION_FILES) {
    try {
      if (!(await $.fs.exists(source.path))) continue
      const found = source.read(await $.fs.read(source.path))
      if (found) {
        projectVersion = found

        return
      }
    } catch {
      // A malformed or unreadable file is not an error worth a cell; try the
      // next source.
    }
  }

  const tag = await $.process.run(['git', 'describe', '--tags', '--abbrev=0'], { timeoutMs: 3000 })
  if (tag.exitCode !== 0) {
    projectVersion = null

    return
  }
  const name = tag.stdout.trim()
  const since = await $.process.run(['git', 'rev-list', '--count', `${name}..HEAD`], {
    timeoutMs: 3000,
  })
  const ahead = since.exitCode === 0 ? Number(since.stdout.trim()) : 0
  projectVersion = ahead > 0 ? `${name}+${ahead}` : name
}

async function refreshGit($: EngineInterface) {
  // `--porcelain=v2 --branch` answers all three questions in one call: the
  // branch name, whether anything is modified, and how far ahead of upstream.
  const { exitCode, stdout } = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], {
    timeoutMs: 3000,
  })
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

// The four token counts of the last response, which is the only place a mod can
// read them: `context.breakdown.apiUsage`, and the breakdown is computed only
// when asked for. `summary` estimates locally and sends no request.
//
// Called from `session.measure` and only when `cost` moved, which is the
// engine's own word for "a priced response landed". Sampling on a timer instead
// would miss responses and undercount; sampling on every measurement would
// double-count the same response.
const wantsTokens = () =>
  layout.input > 0 || layout.output > 0 || layout.cache > 0

async function sampleTokens($: EngineInterface) {
  if (!wantsTokens()) return
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const api = usage.context.breakdown?.apiUsage
    if (!api) return
    tokens = {
      input: tokens.input + api.input_tokens,
      output: tokens.output + api.output_tokens,
      cacheRead: tokens.cacheRead + api.cache_read_input_tokens,
      cacheWrite: tokens.cacheWrite + api.cache_creation_input_tokens,
    }
  } catch {
    // A breakdown the engine declines to compute is not worth failing a hook
    // the whole band draws from.
  }
}

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

// One press moves an item on: 1, 2, 3, 4, off, 1. One key per item and no
// cursor to keep track of, which is the whole reason the pane is shaped this
// way.
async function cycleItem($: EngineInterface, key: ItemKey) {
  layout = { ...layout, [key]: (layout[key] + 1) % (MAX_LINES + 1) }
  await $.store.set('layout', layout)
  $.ui.invalidate('ui.render')
}

async function resetLayout($: EngineInterface) {
  layout = { ...DEFAULT_LAYOUT }
  await $.store.set('layout', layout)
  $.ui.invalidate('ui.render')
}

// --- Turning state into cells ------------------------------------------------
// Pure data: a colour and a string, no elements. Both the band and the settings
// pane's preview build from this, so the preview cannot describe a row the band
// is not drawing.
type Part = { fg: string; text: string }
type Ctx = { folder: string; model: string; windows: Window[] }

function partsFor(key: ItemKey, ctx: Ctx): Part[] {
  if (key === 'dir') return [{ fg: BLUE, text: `${ICON.folder}  ${ctx.folder}` }]

  if (key === 'model') {
    // Draw the override when there is one, so the row shows what will be sent
    // rather than what was last seen.
    const eff = effortBar(effortOverride ?? effort)
    const name = modelName(ctx.model)

    return [
      {
        fg: PINK,
        text: eff ? `${ICON.model}  ${name} ${eff.bar} (${eff.letter})` : `${ICON.model}  ${name}`,
      },
    ]
  }

  if (key === 'git') {
    if (branch === null) return []

    return [
      {
        fg: isDirty ? AMBER : isAhead ? CYAN : GREEN,
        text: `${ICON.branch}  ${branch} ${isDirty ? ICON.dirty : isAhead ? ICON.ahead : ICON.clean}`,
      },
    ]
  }

  if (key === 'version') {
    if (projectVersion === null) return []

    return [{ fg: FG, text: `${ICON.version} ${projectVersion}` }]
  }

  if (key === 'context') {
    if (contextPercent === null) return []

    return [
      {
        fg: barColor(contextPercent),
        text: `ct ${bar(contextPercent)} ${contextPercent}%`,
      },
    ]
  }

  if (key === 'input') {
    if (tokens.input === 0) return []

    return [{ fg: FG, text: `i ${tk(tokens.input)}` }]
  }

  if (key === 'output') {
    if (tokens.output === 0) return []

    return [{ fg: FG, text: `o ${tk(tokens.output)}` }]
  }

  if (key === 'cache') {
    const hit = cacheHit()
    // Silent while it is healthy. A permanent cell for a number that reads 99%
    // is spent width, and the drop is the only moment it says anything.
    if (hit === null || hit >= CACHE_ALERT_BELOW) return []

    return [{ fg: RED, text: `ch ${hit}%` }]
  }

  if (key === 'cost') {
    if (costUsd === null) return []

    return [{ fg: FG, text: `$ ${costUsd.toFixed(2)}` }]
  }

  // Everything left is a rate-limit window, and there may be several of a kind.
  return ctx.windows
    .filter(w => itemForWindow(w) === key)
    .map(w => ({
      fg: barColor(w.percentUsed),
      text: `${labelForWindow(w)} ${bar(w.percentUsed)} ${Math.round(w.percentUsed)}%`,
    }))
}

// The band, line by line. An item whose data is missing draws nothing even when
// it is switched on -- an empty bar reads as "nothing spent yet", which is the
// kind of green-because-it-was-attempted reading this repo keeps finding. A line
// with nothing on it is dropped rather than left as a gap.
function buildLines(ctx: Ctx): Part[][] {
  const lines: Part[][] = Array.from({ length: MAX_LINES }, () => [])
  for (const item of ITEMS) {
    const n = layout[item.key]
    if (n < 1 || n > MAX_LINES) continue
    lines[n - 1]?.push(...partsFor(item.key, ctx))
  }

  return lines.filter(line => line.length > 0)
}

// Which reading to draw. The remote one is preferred because it is the only one
// carrying the per-model week, but only while it is fresh: past the staleness
// bound the engine's two live windows are used instead.
function shownWindows(now: number): Window[] {
  const age = reading.at === null ? null : now - reading.at
  const fresh = reading.windows.length > 0 && age !== null && age < STALE_MS

  return fresh ? reading.windows : windows
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const [name, description] of [
      ['sl', 'Show or hide the status line band'],
      ['sl-help', 'Open the status line legend'],
      ['sl-settings', 'Choose what the status line shows, and on which line'],
      ['sl-effort', 'Set reasoning effort: low, medium, high, xhigh, max, or off'],
      ['sl-debug', 'Print the raw session usage the status line reads'],
    ] as const) {
      await $.command.register({ name, description })
    }

    // Hiding the band and the layout are both preferences, so they outlive the
    // session. `$.store` is shared by every session on the machine, which is
    // what is wanted: the band is either the shape you want above your prompt
    // or it is not.
    isHidden = (await $.store.get('isHidden')) === true
    const saved = await $.store.get('layout')
    if (saved && typeof saved === 'object') {
      // Merged over the defaults, never used as-is: a layout stored before an
      // item existed would leave that item undefined, and `undefined < 1` is
      // false, so it would draw on line NaN.
      const asRecord = saved as Record<string, unknown>
      const merged = { ...DEFAULT_LAYOUT }
      for (const item of ITEMS) {
        const n = asRecord[item.key]
        if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_LINES) {
          merged[item.key] = n
        }
      }
      layout = merged
    }

    // The first readings, before any measurement has been pushed.
    const usage = await $.session.usage()
    contextPercent = usage.context.percent ?? null
    windows = usage.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed }))
    costUsd = usage.cost?.usd ?? null

    await refreshGit($)
    await refreshVersion($)
    // Git is the one figure nothing pushes, so it is what gets polled -- off the
    // draw path, where its cost does not show. The version rides the same timer
    // but far more slowly: it changes when someone edits package.json.
    $.clock.every(5000, () => void refreshGit($))
    $.clock.every(60_000, () => void refreshVersion($))

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
    costUsd = usage.cost?.usd ?? null
    await refreshGit($)
    await refreshVersion($)
    await refreshUsage($)

    return next(e)
  })

  // Pushed, not polled: this fires when a figure actually moves.
  on('session.measure', async ($, e, next) => {
    contextPercent = e.context.percent ?? contextPercent
    windows = e.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed }))
    costUsd = e.cost?.usd ?? costUsd
    // `cost` in `changed` is the engine saying a priced response landed, which
    // is exactly once per response: the dedup signal the token counts need.
    if (e.changed.includes('cost')) await sampleTokens($)

    return next(e)
  })

  // The only place effort can be read. `$.env.get('CLAUDE_EFFORT')` is
  // `undefined` in here -- the engine exports that variable to hook commands and
  // to Bash, not to a hooks module, which cost an afternoon to find out. So it
  // is unknown until the first model request of the session, and what shows
  // afterwards is the effort actually sent, after any silent downgrade.
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
    await $.ui.open({ id: LEGEND, title: 'sl help', focus: true, closeOnEscape: true })

    return {}
  })

  on('command.run', { command: 'sl-settings' }, async $ => {
    await $.ui.open({ id: SETTINGS, title: 'sl settings', focus: true, closeOnEscape: true })

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
        `effort override: ${effortOverride ?? 'none'}`,
        `git: branch=${branch} dirty=${isDirty} ahead=${isAhead}`,
        `project version: ${projectVersion ?? 'none found'}`,
        `tokens: ${JSON.stringify(tokens)} cacheHit=${cacheHit() ?? 'n/a'}%`,
        `layout: ${ITEMS.map(i => `${i.name}=${layout[i.key] || 'off'}`).join(' ')}`,
        `usage endpoint: ${reading.windows.length} window(s)`,
        ...reading.windows.map(w => `  ${w.kind}${w.scope ? ` (${w.scope})` : ''} ${w.percentUsed}%`),
        `  note=${reading.note || 'ok'}`,
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A survey owns the band while it is up; stand aside rather than fight it.
    if (e.props.hasSurvey || isHidden) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const cwd = await $.session.cwd()
    const model = await $.session.model()
    const now = await $.clock.now()

    // While Claude works the spinner is what matters, so the row steps back.
    const dim = e.props.isWorking

    const lines = buildLines({
      folder: cwd.replace(/\/+$/, '').split('/').pop() || '/',
      model,
      windows: shownWindows(now),
    })
    if (lines.length === 0) return next(e)

    // One powerline row. Each cell takes the next cell's background as its
    // separator's foreground, so the two melt into one another; the last
    // separator has nothing after it and takes none, or it draws a stub of
    // colour hanging off the end of the row.
    //
    // No `key` on these. `Text` does not take one, and a prop an element does
    // not take makes the engine throw the whole tree away and draw its own band
    // instead -- silently, apart from one dim line in the transcript. tsc caught
    // it; the running session would not have.
    const row = (parts: Part[]) =>
      parts.flatMap((part, i) => {
        const here = bg(i)
        const after = i === parts.length - 1 ? undefined : bg(i + 1)

        return [
          Text({ backgroundColor: here, color: part.fg, dimColor: dim, children: [` ${part.text} `] }),
          Text({ backgroundColor: after, color: here, dimColor: dim, children: [ICON.sep] }),
        ]
      })

    return Box({
      flexDirection: 'column',
      children: lines.map(line => Box({ flexDirection: 'row', children: row(line) })),
    })
  })

  // The controls, under the prompt.
  //
  // What was tried and did not work: a column tree here does not give two rows.
  // The site is one row, and a tree carrying both the controls and the engine's
  // `hint` string came out as one wrapped line with the engine's own text broken
  // across it. So this draws the controls alone, and only while the session is
  // idle -- while a turn runs, the hook passes and the engine keeps its line,
  // because `esc to interrupt` is worth more than two buttons.
  //
  // The hotkeys are registered and not drawn. They do not fire from the composer
  // -- the types say a bare digit presses a BAND Button and only a band Button,
  // and that is what happens -- so printing `4:` in front of a label would be
  // advertising a key that does nothing. `/sl-help` and `/sl-settings` are the
  // keyboard route, and they open as two tabs of one pane.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (isHidden || e.props.isWorking) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    return Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ color: MUTED, children: ['effort:'] }),
        Button({
          key: 'effort-up',
          label: ICON.up,
          hotkey: '5',
          dimColor: true,
          onPress: () => rotateEffort($, 1),
        }),
        Button({
          key: 'effort-down',
          label: ICON.down,
          hotkey: '4',
          dimColor: true,
          onPress: () => rotateEffort($, -1),
        }),
      ],
    })
  })

  // The settings pane. One key per item, and a press moves that item on:
  // 1, 2, 3, 4, off, 1. No cursor to keep track of.
  on('ui.render', { component: 'Pane', requestId: SETTINGS }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const cwd = await $.session.cwd()
    const model = await $.session.model()
    const now = await $.clock.now()
    const ctx: Ctx = {
      folder: cwd.replace(/\/+$/, '').split('/').pop() || '/',
      model,
      windows: shownWindows(now),
    }

    const itemRow = (item: (typeof ITEMS)[number]) => {
      const n = layout[item.key]
      const parts = partsFor(item.key, ctx)
      const preview = parts.length > 0 ? parts.map(p => p.text).join('  ') : '(nothing to show yet)'

      return Box({
        flexDirection: 'row',
        columnGap: 1,
        children: [
          Button({
            key: `item-${item.key}`,
            label: item.name.padEnd(9),
            hotkey: item.hotkey,
            plain: true,
            onPress: () => void cycleItem($, item.key),
          }),
          Text({
            color: n > 0 ? BLUE : MUTED,
            children: [n > 0 ? `line ${n}` : 'off   '],
          }),
          Text({ color: parts.length > 0 ? FG : MUTED, wrap: 'truncate-end', children: [preview] }),
        ],
      })
    }

    const lines = buildLines(ctx)

    return Box({
      flexDirection: 'column',
      children: [
        Text({ color: MUTED, wrap: 'wrap', children: ['A key moves its item on: 1, 2, 3, 4, off.'] }),
        Text({ children: [' '] }),
        ...ITEMS.map(itemRow),
        Text({ children: [' '] }),
        Text({ color: BLUE, bold: true, children: ['As the band will draw it'] }),
        ...(lines.length === 0
          ? [Text({ color: MUTED, children: ['nothing switched on'] })]
          : lines.map((line, i) =>
              Text({ color: FG, wrap: 'truncate-end', children: [`${i + 1}  ${line.map(p => p.text).join('  ')}`] }),
            )),
        Text({ children: [' '] }),
        Box({
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Button({
              key: 'reset',
              label: 'defaults',
              hotkey: 'r',
              plain: true,
              onPress: () => void resetLayout($),
            }),
            Text({ color: MUTED, children: [`${ICON.dot} esc closes ${ICON.dot} /sl-help for the legend`] }),
          ],
        }),
      ],
    })
  })

  // The legend. A pane rather than a toast: a toast is gone in four seconds and
  // this is a page to read. It is drawn from the same values the band uses, so
  // it cannot describe a row the band is not showing.
  on('ui.render', { component: 'Pane', requestId: LEGEND }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const line = (left: string, right: string) =>
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
        Text({ color: BLUE, bold: true, children: ['What can be on the band'] }),
        ...ITEMS.map(item =>
          line(`${item.name} (${item.hotkey})`, `${item.about} ${ICON.dot} ${layout[item.key] > 0 ? `line ${layout[item.key]}` : 'off'}`),
        ),
        gap,
        Text({ color: BLUE, bold: true, children: ['Reading a gauge'] }),
        line(`${bar(10)}  1-20%`, 'five segments of 20%, rounded UP'),
        line(`${bar(30)}  21-40%`, 'so 19% shows one segment, never none'),
        line(`${bar(90)}  81-100%`, 'a quota must not read lower than it is'),
        line('colour', 'green under 60%, amber from 60, red from 85'),
        line('ch', `cache hit, drawn only under ${CACHE_ALERT_BELOW}% -- above that it has nothing to say`),
        gap,
        Text({ color: BLUE, bold: true, children: ['Row one'] }),
        line(`${ICON.clean} ${ICON.dirty} ${ICON.ahead}`, 'clean, uncommitted changes, ahead of upstream'),
        line(
          `${EFFORT_FILLED.repeat(2)}${EFFORT_EMPTY.repeat(3)} (M)`,
          'a different glyph from the gauges on purpose: the level you picked, not what you spent',
        ),
        line(`L M H X ${EFFORT_LETTER.max}`, 'low, medium, high, xhigh, max'),
        gap,
        Text({ color: BLUE, bold: true, children: ['Keys and commands'] }),
        line(`effort: ${ICON.up} ${ICON.down}`, 'under the prompt, clicked -- the keys do not fire there'),
        line('/sl', 'hide or show the band'),
        line('/sl-settings', 'choose what shows, and on which line'),
        line('/sl-effort <level>', 'set it outright, or `off` to stop overriding'),
        line('/sl-debug', 'print what the engine reports'),
        line('Esc', 'close this pane'),
        gap,
        Text({
          color: MUTED,
          wrap: 'wrap',
          children: [
            'Effort is blank until the first model request: the engine does not hand a mod the session setting, only what each request carries.',
          ],
        }),
        Text({
          color: MUTED,
          wrap: 'wrap',
          children: [
            'input and output are token counts, not dollars. The engine hands a mod one money figure -- the session total -- and no split between the two, and a price table in a mod is a number that goes wrong silently.',
          ],
        }),
      ],
    })
  })
}
