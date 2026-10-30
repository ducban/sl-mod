import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

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

// --- Two palettes, and the person's theme picks one ---------------------------
// Tokyo Night Moon for a dark theme -- what the old status line was already
// using -- and Tokyo Night Day for a light one. The band paints its own
// backgrounds, so it reads on either; the palette is what keeps it from looking
// pasted on. `bg` is four background steps, darkest first (lightest first on
// Day): each cell takes the next one, which is what gives a row its depth.
//
// The Moon steps were a shade too close to the terminal's own background: on
// 2026-10-22 a reader could not make the cells out from the row behind them, so
// each step is now one notch up the palette, and `muted` is the palette's
// comment colour rather than its gutter.
type Palette = {
  blue: string
  pink: string
  green: string
  cyan: string
  fg: string
  amber: string
  red: string
  muted: string
  bg: readonly string[]
}
const MOON: Palette = {
  blue: '#82aaff',
  pink: '#fca7ea',
  green: '#c3e88d',
  cyan: '#86e1fc',
  fg: '#c0caf5',
  amber: '#ffc777',
  red: '#ff757f',
  muted: '#636da6',
  bg: ['#3b4261', '#2f334d', '#444a73', '#545c7e'],
}
const DAY: Palette = {
  blue: '#2e7de9',
  pink: '#9854f1',
  green: '#587539',
  cyan: '#007197',
  fg: '#3760bf',
  amber: '#8c6c3e',
  red: '#f52a65',
  muted: '#848cb5',
  bg: ['#c4c8da', '#d0d5e3', '#b6bfe2', '#a8aecb'],
}

// Module-level and reassigned, not read through an object, so the drawing code
// below names a colour the way it always did.
let BLUE = MOON.blue
let PINK = MOON.pink
let GREEN = MOON.green
let CYAN = MOON.cyan
let FG = MOON.fg
let AMBER = MOON.amber
let RED = MOON.red
let MUTED = MOON.muted
let BG = MOON.bg
const bg = (i: number) => BG[i % BG.length] as string

// The theme row's values are `dark`, `light`, and their `-daltonized` and
// `-ansi` variants; anything starting `light` takes Day.
function applyTheme(theme: unknown) {
  const p = typeof theme === 'string' && theme.startsWith('light') ? DAY : MOON
  BLUE = p.blue
  PINK = p.pink
  GREEN = p.green
  CYAN = p.cyan
  FG = p.fg
  AMBER = p.amber
  RED = p.red
  MUTED = p.muted
  BG = p.bg
}

// Read once at start and again on the `config.set` that changes it. A failure
// here keeps Moon, which is the band as it has always been drawn.
async function refreshTheme($: EngineInterface) {
  try {
    applyTheme((await $.config.list()).find(row => row.key === 'theme')?.value)
  } catch {
    // Moon stays.
  }
}

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
//   from a fallback      F07B F1B2 E725 (Nerd Font) and 25B0 25B1 25AE 25AF 21BB
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
  reset: '\u{21BB}', // before the countdown to a window's reset
  warn: '\u{26A0}', // before a held command
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
  | 'speed'
  | 'turn'

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
  { key: 'cache', hotkey: 'h', name: 'cache', about: 'the hour left on the prompt cache, and the hit rate once it is low' },
  { key: 'cost', hotkey: 'u', name: 'cost', about: 'what this session has cost, in USD' },
  { key: 'speed', hotkey: 's', name: 'speed', about: 'output tokens a second, over the last request' },
  { key: 'turn', hotkey: 'n', name: 'turn', about: 'what the last turn cost, and how long it ran' },
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
  speed: 0,
  turn: 0,
}
let layout: Layout = { ...DEFAULT_LAYOUT }

// Which item a rate-limit window belongs to, so one toggle covers every window
// of that sort. The engine says `five_hour` and `seven_day`; the usage endpoint
// says `session`, `weekly_all` and `weekly_scoped`. A window carrying a scope is
// labelled with the model it is scoped to.
// `resetsAt` is epoch milliseconds, or null when the reading did not say.
type Window = { kind: string; percentUsed: number; scope?: string | null; resetsAt?: number | null }
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

// The engine spells a reset as an ISO 8601 string and the usage endpoint as
// `resets_at`, RFC 3339 as well. The status line payload this mod replaced
// carried epoch seconds, so a number is taken too. Anything else is "did not
// say", and a window that did not say draws no countdown.
const parseReset = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const ms = Date.parse(v)

    return Number.isFinite(ms) ? ms : null
  }

  return null
}

const fromEngine = (ws: SessionRateLimit[]): Window[] =>
  ws.map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: parseReset(w.resetsAt) }))

// Time left as `3d15h`, `2h14m`, `48m`, or `now` once the moment has passed:
// the engine sends the next reset with the next reading, not at the stroke of
// the hour, and a negative number would be inventing a window nobody has
// reported. Minutes round UP for the same reason the bars do.
const countdown = (resetsAt: number, now: number) => {
  const minutes = Math.ceil((resetsAt - now) / 60_000)
  if (minutes <= 0) return 'now'
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return `${d}d${String(h).padStart(2, '0')}h`

  return h > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`
}

// A turn's length as `38s`, `2m05s`, `1h02m`.
const elapsed = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`

  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// `Oct 6 11:00pm`, in the terminal's own time zone. Local getters rather than
// toLocaleString, whose spelling depends on which ICU data the runtime shipped.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const calendar = (at: number) => {
  const d = new Date(at)
  const h = d.getHours()
  const hour = h % 12 === 0 ? 12 : h % 12

  return `${MONTHS[d.getMonth()]} ${d.getDate()} ${hour}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`
}

// --- What the drawing reads --------------------------------------------------
// Module-level, so a redraw costs nothing. They go back to their defaults when
// the module reloads, and each is filled again by the hook that owns it.
type Effort = (typeof EFFORT_STEPS)[number]
let contextPercent: number | null = null
// Kept so a compaction can recompute the percent from the token count it
// reports. Every reading of usage carries it, so it costs nothing to hold.
let contextWindow: number | null = null
// Which hook last wrote the gauge, and when, for /sl-debug. A gauge that holds
// an old number looks the same whether the engine stopped reporting or the band
// stopped listening, and on 2026-10-19 it took another session's /context to
// tell the two apart.
let contextSource = 'none'
let contextAt: number | null = null
// How many messages the main loop's last request carried. A request carrying
// fewer than half of them is the first one after a compaction (or a /clear):
// the transcript was rewritten under it. That makes `turn.step` a compaction
// signal of the mod's own, one nothing seats itself in front of, and one that
// fires on the first request after the compaction rather than on a tick.
// The halving test is Karan Bansal's, from cache-tax (see ACKNOWLEDGEMENTS.md).
let mainMessages = 0
let windows: Window[] = []
let effort: string | undefined
let branch: string | null = null
let isDirty = false
let isAhead = false
let isHidden = false
// The guard: off until switched on in /sl-settings, stored like the layout.
let guardOn = false
// The cold gate: off until switched on in /sl-settings, stored like the guard.
// Once the cache's hour has gone, the next prompt typed is dropped once with
// what re-warming costs in tokens, and the one after goes through. `coldAskedAt`
// is when it asked; a main-loop request clears it.
let coldGateOn = false
let coldAskedAt: number | null = null
// Under this many tokens the re-read is cents, and a gate on cents is a nag.
const COLD_GATE_FLOOR = 50_000
// The countdown after the 5h bar. A preference like the layout, so it is stored
// and shared by every session on the machine.
let showReset = true
let projectVersion: string | null = null
// Why each polled figure has nothing, in words. An empty cell looks identical
// whether the probe answered "no branch" or threw on its way to asking, and
// this repo has been caught out by that kind of silence more than once.
let gitNote = 'not probed yet'
let versionNote = 'not probed yet'

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

// The main loop's last request in output tokens a second, timed from its first
// chunk to its stop so the wait for the first token is left out; a request too
// short to time is not scored. And the last finished turn: the session total
// at its end less the total at its start -- the one money figure a mod gets --
// with the engine's own length. Both johnnyvizz's, from session-band (see
// ACKNOWLEDGEMENTS.md).
let speed: number | null = null
const SPEED_MIN_TOKENS = 20
const SPEED_MIN_MS = 1_000
let turnCostAtStart: number | null = null
let lastTurn: { usd: number | null; ms: number } | null = null

// The prompt cache lives an hour from the last request that touched it, and a
// request after that re-reads the whole transcript at the uncached price. The
// cell counts that hour down from the main loop's last request -- `turn.step`
// is where a request is seen -- and says `cold` once it has gone. Green, amber
// inside twenty minutes, red inside ten: here the colours are the gauge's,
// because running out IS the trouble. The countdown is johnnyvizz's, from
// session-band; the hour from the last request is Karan Bansal's, from
// cache-tax (see ACKNOWLEDGEMENTS.md). A session in usage overage drops to a
// five-minute cache, which nothing tells a mod; the cell then reads warm for
// longer than it is.
const CACHE_TTL_MS = 60 * 60_000
const CACHE_AMBER_MS = 20 * 60_000
const CACHE_RED_MS = 10 * 60_000
let cacheWarmAt: number | null = null

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

// The engine draws no title for a lone pane and a tab strip the moment a second
// one is open -- "one shown, the rest tabs" (PaneOpenArgs.title). So the tabs
// are not a widget to build: they are what two open panes already look like.
// Every /sl-* command that has a pane opens both and raises its own, which is
// why `show` is opened last: `focus: true` raises as well as focuses.
const PANES: { id: string; title: string }[] = [
  { id: LEGEND, title: 'sl help' },
  { id: SETTINGS, title: 'sl settings' },
]

async function openTabs($: EngineInterface, show: string) {
  for (const pane of PANES) {
    if (pane.id === show) continue
    await $.ui.open({ id: pane.id, title: pane.title, closeOnEscape: true })
  }
  const front = PANES.find(pane => pane.id === show)
  if (front) await $.ui.open({ ...front, focus: true, closeOnEscape: true })
}

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
// Where the current reading came from, for /sl-debug: this session's own
// fetch, or another session's through the shared store.
let readingSource = 'none'

// Anthropic rate-limits this endpoint, and this mod is not the only caller: ccuc
// polls the same account from three machines every five minutes, and a mod runs
// on each machine with Claude Code open. So a 429 has to mean stop, not try
// again in three minutes.
let nextAllowedAt = 0
const DEFAULT_BACKOFF_MS = 10 * 60_000
const MAX_BACKOFF_MS = 60 * 60_000

// One reading per machine, not per session. Every open session runs its own
// copy of this mod with its own POLL_MS timer, so N sessions made N calls per
// period against one token, plus one per session start -- and the endpoint's
// limit is per token: on 2026-10-11 four sessions plus ccuc on one Mac kept it
// at 429 for hours while the same account from another machine answered 200.
// $.store is one file per machine that every session shares, so the reading
// lives there: whoever finds it older than POLL_MS fetches and writes it back,
// everyone else adopts it. The 429 backoff is shared the same way, so one 429
// silences the machine, not one session. The get-then-set race the docs warn
// about is real but cheap here: timers in different sessions are out of phase,
// so at worst two sessions fetch inside one call's ~200 ms, not N.
//
// Both times are $.clock.now(), which the contract defines as milliseconds
// since the epoch, so one session's fetchedAt and nextAllowedAt read correctly
// in another. The tests run on the mock clock for the same reason.
type SharedUsage = { windows: Window[]; fetchedAt: number; nextAllowedAt: number }
const SHARED_KEY = 'usage'

async function refreshUsage($: EngineInterface) {
  const now = await $.clock.now()

  const shared = (await $.store.get(SHARED_KEY)) as SharedUsage | undefined
  if (shared && typeof shared.fetchedAt === 'number' && Array.isArray(shared.windows)) {
    const age = now - shared.fetchedAt
    if (age >= 0 && age < POLL_MS) {
      reading = {
        windows: shared.windows,
        at: shared.windows.length > 0 ? shared.fetchedAt : null,
        note: shared.windows.length > 0 ? '' : 'the body carried no windows',
      }
      readingSource = `shared, fetched ${Math.round(age / 1000)}s ago by another session`

      return
    }
    if (typeof shared.nextAllowedAt === 'number' && shared.nextAllowedAt > nextAllowedAt) {
      nextAllowedAt = shared.nextAllowedAt
    }
  }

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
      // Keep whatever reading the machine has; only the backoff moves.
      await $.store.set(SHARED_KEY, {
        windows: shared?.windows ?? reading.windows,
        fetchedAt: shared?.fetchedAt ?? 0,
        nextAllowedAt,
      } satisfies SharedUsage)

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

    return [
      {
        kind,
        percentUsed: percent,
        scope: one.scope?.model?.display_name ?? null,
        resetsAt: parseReset(one.resets_at),
      },
    ]
  })

  // An empty array means the account has no window to report. Drawing zeroes
  // would be inventing them, so nothing is drawn.
  nextAllowedAt = 0
  reading = {
    windows: fetched,
    at: fetched.length > 0 ? now : null,
    note: fetched.length > 0 ? '' : 'the body carried no windows',
  }
  readingSource = 'fetched by this session'
  await $.store.set(SHARED_KEY, { windows: fetched, fetchedAt: now, nextAllowedAt: 0 } satisfies SharedUsage)
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
        versionNote = `from ${source.path}`

        return
      }
    } catch {
      // A malformed or unreadable file is not an error worth a cell; try the
      // next source.
    }
  }

  // Guarded, all of it. These two were bare, and a throw here left `session.start`
  // without its timers and without `next(e)` -- so one repo with no tags could
  // take the git poll down with it and leave no trace but a dim transcript line.
  try {
    const tag = await $.process.run(['git', 'describe', '--tags', '--abbrev=0'], { timeoutMs: 3000 })
    if (tag.exitCode !== 0) {
      projectVersion = null
      versionNote = 'no version file, and no tag to describe'

      return
    }
    const name = tag.stdout.trim()
    const since = await $.process.run(['git', 'rev-list', '--count', `${name}..HEAD`], {
      timeoutMs: 3000,
    })
    const ahead = since.exitCode === 0 ? Number(since.stdout.trim()) : 0
    projectVersion = ahead > 0 ? `${name}+${ahead}` : name
    versionNote = `from git describe${ahead > 0 ? `, ${ahead} commit(s) past it` : ''}`
  } catch (err) {
    projectVersion = null
    versionNote = `git describe threw: ${String(err).slice(0, 80)}`
  }
}

async function refreshGit($: EngineInterface) {
  // `--porcelain=v2 --branch` answers all three questions in one call: the
  // branch name, whether anything is modified, and how far ahead of upstream.
  let exitCode: number
  let stdout: string
  try {
    const run = await $.process.run(['git', 'status', '--porcelain=v2', '--branch'], {
      timeoutMs: 3000,
    })
    exitCode = run.exitCode
    stdout = run.stdout
  } catch (err) {
    branch = null
    gitNote = `git status threw: ${String(err).slice(0, 80)}`

    return
  }
  if (exitCode !== 0) {
    branch = null
    gitNote = `git status exited ${exitCode}`

    return
  }
  const lines = stdout.split('\n')
  const head = lines.find(l => l.startsWith('# branch.head '))
  branch = head ? head.slice('# branch.head '.length).trim() : null
  if (branch === '(detached)') branch = null
  isDirty = lines.some(l => /^[12u?] /.test(l))
  const ab = lines.find(l => l.startsWith('# branch.ab '))
  isAhead = ab ? Number(ab.split(' ')[2] ?? '+0') > 0 : false
  gitNote = branch === null ? 'no branch.head line, or detached' : 'ok'
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

// The fill as /context reports it: estimated locally over the transcript, no
// request sent. It is the only figure that exists right after a compaction.
// `context.percent` is "the last response's input against the window", and the
// engine does not hold a stale one -- it drops the field, so `usage.context` is
// `{ window }` and nothing else until the next response lands. Ban's session on
// 2026-10-19: /context said 9%, the band said 20% from before the compaction,
// and the backstop had asked, been given no `percent`, and kept what it had.
//
// It measures against the compaction window (`rawMaxTokens`), which can be
// smaller than `window`, so it may read a point or two above `percent` for the
// same transcript. That is also what /context shows, which is the number Ban
// compares the band against.
async function breakdownPercent($: EngineInterface): Promise<number | null> {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const p = usage.context.breakdown?.percentage

    return typeof p === 'number' ? Math.round(p) : null
  } catch {
    return null
  }
}

async function setContext($: EngineInterface, percent: number, source: string) {
  contextPercent = percent
  contextSource = source
  contextAt = await $.clock.now()
}

// Effort is chosen outright, never nudged. Nudging needs a baseline, and the
// baseline was a guess: the engine does not hand a mod the session's effort
// until something reports it, so a relative press from an unknown start landed
// on `medium + 1 = high` and showed `(H)` for a session that was not on high.
// A list you pick from cannot be wrong about where it started.
//
// `null` is the first choice and means "no opinion": the band then reports
// whatever the session is doing, and `turn.step` passes every request through
// untouched.
//
// Declared up here, not inside `register`: `claude plugin validate` follows `$`
// only into a function declared at the top of the file, and refuses a closure it
// cannot trace. tsc was happy with it either way.
const EFFORT_CHOICES: (Effort | null)[] = [null, ...EFFORT_STEPS]

function cycleEffort($: EngineInterface) {
  const at = EFFORT_CHOICES.indexOf(effortOverride)
  effortOverride = EFFORT_CHOICES[(at + 1) % EFFORT_CHOICES.length] ?? null
  // Not stored. The layout is a preference that outlives the session; the
  // effort of the requests this session sends is not.
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

async function toggleReset($: EngineInterface) {
  showReset = !showReset
  await $.store.set('showReset', showReset)
  $.ui.invalidate('ui.render')
}

// The countdown is the one cell that moves while nothing else does: every other
// figure is pushed or polled, and the band redraws when one lands. So it gets a
// tick of its own, one a minute, which is the countdown's own resolution and
// what turns the week's cell over. A redraw is a function call; while the
// countdown is off there is nothing to move.
function tickCountdown($: EngineInterface) {
  if (showReset || (layout.cache > 0 && cacheWarmAt !== null)) $.ui.invalidate('ui.render')
}

// --- A compaction nothing told the band about --------------------------------
// Three hooks hear a compaction: `session.compact`, `classic.PostCompact`, and
// `session.measure` one response later. On a machine with managed settings, or
// a Team or Enterprise account, Claude Code 2.1.310 seats its bundled
// `cc-plugin-sec-default@builtin` outermost, and that module passes neither
// compaction event on: the engine logs `sl-mod: its session.compact hook was
// skipped. "cc-plugin-sec-default" runs first and sent the event on past it`,
// and the same for `classic.PostCompact`. vibe-island-on-arch, 2026-10-26:
// /compact took the transcript from 202k tokens to 15k and the band held 20%
// while /context said 6%. Neither hook of this mod's ever ran.
//
// A timer is the mod's own, and nothing seats itself in front of it. So the
// gauge checks its own premise every few seconds. The engine drops
// `context.percent` the moment a compaction lands and does not put it back
// until the next response, so a gauge that holds a number while the reading
// has none is exactly a gauge that missed a compaction -- and it takes the
// breakdown, as the hooks would have. The rest of the time the reading has a
// percent and the tick does nothing: one local call, no estimate, no redraw.
const RESYNC_MS = 10_000
async function resyncContext($: EngineInterface) {
  if (contextPercent === null) return
  try {
    const usage = await $.session.usage()
    if (typeof usage.context.percent === 'number') return

    const estimate = await breakdownPercent($)
    if (estimate === null || estimate === contextPercent) return
    await setContext($, estimate, 'tick breakdown')
    $.ui.invalidate('ui.render')
  } catch {
    // The reading is the engine's own and does not fail; if it ever does, the
    // gauge keeps what it has, which is what it did before this tick existed.
  }
}

// What the gauge does once something says a compaction has happened but not
// what it came down to. The breakdown is the live estimate and is taken as it
// comes. Failing that, the plain reading is taken only if it moved DOWN: it is
// the last response's figure, and the only way it is present here is if it has
// not caught up yet, in which case it is the pre-compaction one and writing it
// back would re-pin the stale number. `source` names the caller for /sl-debug.
async function afterCompaction($: EngineInterface, source: string) {
  const estimate = await breakdownPercent($)
  if (estimate !== null) {
    await setContext($, estimate, `${source} breakdown`)
    $.ui.invalidate('ui.render')

    return
  }

  const usage = await $.session.usage()
  const now = usage.context.percent ?? null
  if (now !== null && (contextPercent === null || now < contextPercent)) {
    await setContext($, now, `${source} percent`)
    contextWindow = usage.context.window ?? contextWindow
    $.ui.invalidate('ui.render')
  }
}

// --- The guard: a risky shell command waits for you ---------------------------
// `rm -rf`, `git reset --hard`, `git clean` and a force push each throw
// something away that git or the disk will not give back. When Claude asks Bash
// for one, the call is held, what it would destroy is measured and drawn in the
// band -- this mod owns the band, so there is nothing to fight for it -- and the
// command runs only on `1`. `2`, Esc, an interrupted turn, an error here, or ten
// minutes of silence all refuse it, and Claude is told why so it does not try
// again. The idea, and the shape of the hold, are Blast Radius's, by Claude
// Code DevRel at Anthropic (Apache-2.0); the code here is this repo's own. See
// ACKNOWLEDGEMENTS.md.
//
// It reads the command text and does not parse shell: `$(...)`, `eval`,
// `bash -c "..."`, `xargs rm`, `find -delete` and scripts that call rm are not
// caught. It is a net, not a permission system; a hard block belongs in the
// permission rules.
type Risk =
  | { kind: 'rm'; label: string; targets: string[]; dir: string | null }
  | { kind: 'git-reset'; label: string; dir: string | null }
  | { kind: 'git-clean'; label: string; args: string[]; dir: string | null }
  | { kind: 'git-push-force'; label: string; args: string[]; dir: string | null }
type Report = { summary: string; lines: string[]; more: number; note: string }
type Decision = 'run' | 'refuse' | 'interrupted' | 'timeout' | 'error'
type Held = { command: string; risk: Risk; report: Report | null; decision: Decision | null }
// The call being held, or null. One at a time: a second risky call waits.
let held: Held | null = null
const GUARD_HOLD_MS = 10 * 60_000
const GUARD_POLL = ['sleep', '0.25'] as const
const GUARD_LIST = 3

// Words the shell would see, quotes honoured. Enough to read flags and paths.
const shellWords = (text: string): string[] => {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '')

  return out
}

// Where a `cd` lands, relative to where the line was so far.
const joinDir = (dir: string | null, to: string | undefined) => {
  if (to === undefined || to === '~' || to.startsWith('/') || to.startsWith('~/')) return to ?? '~'

  return dir === null ? to : `${dir}/${to}`
}

// Words that sit in front of the real command and change nothing about it.
const WRAPPERS = new Set(['command', 'exec', 'env', 'nohup', 'time', 'then', 'do', 'else'])

// The first risky segment of a command line, or null. A `cd` earlier on the
// line moves where the next segment is measured.
function classifyCommand(command: string): Risk | null {
  let dir: string | null = null
  for (const raw of command.split(/&&|\|\||;|\||\n/)) {
    const words = shellWords(raw.trim().replace(/^[({\s]+/, '').replace(/[)}\s]+$/, ''))
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? '')) words.shift()
    if (words[0] === 'sudo') {
      words.shift()
      while (words.length > 0 && (words[0] ?? '').startsWith('-')) words.shift()
    }
    while (words.length > 0 && WRAPPERS.has(words[0] ?? '')) words.shift()
    const [first, ...args] = words
    if (first === undefined) continue
    const cmd = first.replace(/^\\/, '')

    if (cmd === 'cd') {
      dir = joinDir(dir, args[0])
      continue
    }

    if (cmd === 'rm' || cmd.endsWith('/rm')) {
      const flags = args.filter(a => a.startsWith('-') && a !== '-')
      const recursive = flags.some(f => f === '--recursive' || (/^-[^-]/.test(f) && /[rR]/.test(f)))
      const force = flags.some(f => f === '--force' || (/^-[^-]/.test(f) && f.includes('f')))
      if (recursive || force) {
        return { kind: 'rm', label: `rm ${flags.join(' ')}`.trim(), targets: args.filter(a => !flags.includes(a)), dir }
      }
    }

    if (cmd === 'git') {
      let at = 0
      let gitDir = dir
      while (at < args.length && (args[at] ?? '').startsWith('-')) {
        if (args[at] === '-C' || args[at] === '-c') {
          if (args[at] === '-C') gitDir = joinDir(gitDir, args[at + 1])
          at += 2
        } else {
          at += 1
        }
      }
      const sub = args[at]
      const rest = args.slice(at + 1)
      if (sub === 'reset' && rest.includes('--hard')) return { kind: 'git-reset', label: 'git reset --hard', dir: gitDir }
      if (sub === 'clean') return { kind: 'git-clean', label: 'git clean', args: rest, dir: gitDir }
      if (
        sub === 'push' &&
        rest.some(a => a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || a.startsWith('+'))
      ) {
        return { kind: 'git-push-force', label: 'git push --force', args: rest, dir: gitDir }
      }
    }
  }

  return null
}

// The folder a `cd` names, absolute, or null when it is not there. The name is
// an argument to bash, never part of its source, so nothing in it runs.
async function resolveDir($: EngineInterface, from: string, dir: string): Promise<string | null> {
  const script = 'd="$1"; case "$d" in "~") d="$HOME";; "~/"*) d="$HOME/${d#\\~/}";; esac; cd -- "$d" 2>/dev/null && pwd -P'
  const run = await $.process.run(['bash', '-c', script, 'sl-mod-guard', dir], { cwd: from, timeoutMs: 5000 })
  const out = run.stdout.trim()

  return run.exitCode === 0 && out !== '' ? out : null
}

// Paths are arguments to bash, never source. A glob is expanded by the shell
// itself, with nullglob so a miss is nothing rather than the pattern; a
// relative path gets ./ in front so find never reads a file name as an action.
const RM_SCRIPT = [
  'shopt -s nullglob dotglob',
  'found=()',
  'for p in "$@"; do',
  '  case "$p" in "~") p="$HOME";; "~/"*) p="$HOME/${p#\\~/}";; esac',
  '  case "$p" in *[\\*\\?\\[]*) for m in $p; do found+=("$m"); done;; *) if [ -e "$p" ] || [ -L "$p" ]; then found+=("$p"); fi;; esac',
  'done',
  'if [ "${#found[@]}" -eq 0 ]; then echo "0 0 0"; exit 0; fi',
  'for i in "${!found[@]}"; do case "${found[$i]}" in /*|./*|../*) ;; *) found[$i]="./${found[$i]}";; esac; done',
  'n=$(find "${found[@]}" -type f -o -type l 2>/dev/null | wc -l | tr -d " ")',
  'kb=$(du -skc "${found[@]}" 2>/dev/null | tail -n 1 | cut -f1)',
  'echo "$n $(( ${kb:-0} * 1024 )) ${#found[@]}"',
  `find "\${found[@]}" -type f -o -type l 2>/dev/null | head -n ${GUARD_LIST}`,
].join('\n')

const bytes = (n: number) => {
  if (!Number.isFinite(n) || n < 1024) return `${n || 0} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }

  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

// What the command would do, in a sentence and a short list. Never throws: a
// measurement that failed is said, not hidden, and the command is still held.
async function measureRisk($: EngineInterface, risk: Risk, cwd: string): Promise<Report> {
  try {
    if (risk.kind === 'rm') {
      if (risk.targets.length === 0) return { summary: 'rm with no paths', lines: [], more: 0, note: 'nothing to expand' }
      const run = await $.process.run(['bash', '-c', RM_SCRIPT, 'sl-mod-guard', ...risk.targets], { cwd, timeoutMs: 15000 })
      const [head = '0 0 0', ...names] = run.stdout.split('\n').filter(l => l !== '')
      const [files = 0, size = 0, found = 0] = head.split(' ').map(Number)
      if (found === 0) return { summary: `delete nothing: no file matches ${risk.targets.join(' ')}`, lines: [], more: 0, note: 'the paths are not there' }
      if (files === 0) return { summary: `delete ${plural(found, 'empty path')}`, lines: [], more: 0, note: risk.targets.join(' ') }

      return {
        summary: `delete ${plural(files, 'file')} ${ICON.dot} ${bytes(size)}`,
        lines: names.map(n => n.replace(/^\.\//, '')),
        more: Math.max(0, files - names.length),
        note: '',
      }
    }

    if (risk.kind === 'git-clean') {
      const flags: string[] = []
      const paths: string[] = []
      for (let i = 0; i < risk.args.length; i += 1) {
        const a = risk.args[i] ?? ''
        if (a === '--') {
          paths.push(...risk.args.slice(i + 1))
          break
        }
        if (a === '-e' || a === '--exclude') {
          flags.push(a, risk.args[i + 1] ?? '')
          i += 1
        } else if (a.startsWith('--exclude=') || /^-e./.test(a)) {
          flags.push(a)
        } else if (/^-[a-zA-Z]+$/.test(a)) {
          // -n is added below; -f, -i and -q would change the dry run.
          const kept = a.replace(/[finq]/g, '')
          if (kept !== '-') flags.push(kept)
        } else if (!a.startsWith('-')) {
          paths.push(a)
        }
      }
      const run = await $.process.run(['git', 'clean', '-n', ...flags, '--', ...paths], { cwd, timeoutMs: 15000 })
      if (run.exitCode !== 0) return { summary: 'git clean (could not dry-run it)', lines: [], more: 0, note: run.stderr.trim().slice(0, 160) }
      const gone = run.stdout.split('\n').filter(l => l.startsWith('Would remove ')).map(l => l.slice('Would remove '.length))

      return {
        summary: gone.length === 0 ? 'remove nothing: no untracked file matches' : `remove ${plural(gone.length, 'untracked path')}`,
        lines: gone.slice(0, GUARD_LIST),
        more: Math.max(0, gone.length - GUARD_LIST),
        note: gone.length === 0 ? '' : 'untracked files are not in git and cannot be recovered',
      }
    }

    if (risk.kind === 'git-push-force') {
      const positional = risk.args.filter(a => !a.startsWith('-'))
      const remote = positional[0] ?? 'origin'
      const spec = (positional[1] ?? '').replace(/^\+/, '')
      let [source, branch] = spec.includes(':') ? spec.split(':') : [spec, spec]
      branch = (branch ?? '').replace(/^refs\/heads\//, '')
      if (branch === '' || branch === 'HEAD') {
        const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 10000 })
        branch = head.stdout.trim()
        source = 'HEAD'
      }
      source = source || 'HEAD'
      const ref = `${remote}/${branch}`
      const known = await $.process.run(['git', 'rev-parse', '--verify', '--quiet', ref], { cwd, timeoutMs: 10000 })
      if (known.exitCode !== 0) {
        return { summary: `force-push to ${ref}`, lines: [], more: 0, note: `no local copy of ${ref}, so the dropped commits cannot be listed; git fetch first` }
      }
      const log = await $.process.run(['git', 'log', '--oneline', '--no-decorate', `${source}..${ref}`], { cwd, timeoutMs: 15000 })
      const dropped = log.stdout.split('\n').filter(l => l !== '')

      return {
        summary: dropped.length === 0 ? `force-push to ${ref}: drops no commits` : `force-push to ${ref}: drops ${plural(dropped.length, 'commit')}`,
        lines: dropped.slice(0, GUARD_LIST),
        more: Math.max(0, dropped.length - GUARD_LIST),
        note: dropped.length === 0 ? '' : `on ${ref} and not on ${source}, as of the last fetch`,
      }
    }

    // git reset --hard: staged and unstaged changes both go.
    const status = await $.process.run(['git', 'status', '--porcelain'], { cwd, timeoutMs: 15000 })
    if (status.exitCode !== 0) return { summary: `${risk.label} (not a git repo here?)`, lines: [], more: 0, note: status.stderr.trim().slice(0, 160) }
    const rows = status.stdout.split('\n').filter(l => l.length > 3 && !l.startsWith('??'))
    const stat = await $.process.run(['git', 'diff', '--shortstat', 'HEAD'], { cwd, timeoutMs: 15000 })

    return {
      summary: rows.length === 0 ? 'discard nothing: no uncommitted changes' : `discard uncommitted changes in ${plural(rows.length, 'file')}`,
      lines: rows.slice(0, GUARD_LIST).map(l => `${l.slice(0, 2)} ${l.slice(3)}`),
      more: Math.max(0, rows.length - GUARD_LIST),
      note: stat.stdout.trim() === '' ? '' : `${stat.stdout.trim()}; uncommitted changes cannot be recovered`,
    }
  } catch (error) {
    return { summary: `${risk.label} (could not measure it)`, lines: [], more: 0, note: String((error as Error)?.message ?? error).slice(0, 160) }
  }
}

const guardRefusal = (label: string, summary: string, why: string) =>
  `sl-mod guard held this command and did not run it: ${why}. It would have: ${summary}. Do not retry it unless the user asks you to.`

async function toggleGuard($: EngineInterface) {
  guardOn = !guardOn
  await $.store.set('guard', guardOn)
  $.ui.invalidate('ui.render')
}

async function toggleColdGate($: EngineInterface) {
  coldGateOn = !coldGateOn
  await $.store.set('coldGate', coldGateOn)
  $.ui.invalidate('ui.render')
}

// The reason a dropped prompt shows. The size is the last response's input --
// what the next request re-reads -- and absent before any response has landed.
const coldReason = (coldFor: string, size: number | undefined) =>
  `sl-mod cold gate: the prompt cache has been cold for ${coldFor}, so this request re-reads ${
    size === undefined ? 'the whole transcript' : `about ${tk(size)} tokens`
  } at the uncached price before it answers. Enter again sends it as it is; /clear starts a fresh window if this is a new task.`

// --- Turning state into cells ------------------------------------------------
// Pure data: a colour and a string, no elements. Both the band and the settings
// pane's preview build from this, so the preview cannot describe a row the band
// is not drawing.
// `tail` is a second run of text in the same cell, in its own colour: the reset
// after a bar, which must not borrow the bar's colour or it reads as part of the
// quota.
type Part = { fg: string; text: string; tail?: { fg: string; text: string } }
const plain = (p: Part) => (p.tail ? `${p.text} ${p.tail.text}` : p.text)
// `compact` drops the bars: `5h 8%` for `5h ▰▱▱▱▱ 8%`, the same figures in half
// the width, for a line the surface has no room for.
type Ctx = { folder: string; model: string; windows: Window[]; now: number; compact?: boolean }

// The two windows you wait out carry their reset after the percent, in the
// bar's colour. The five-hour one counts down, `↻2h14m`: you will still be here
// when it comes round. The week is days off, so its cell turns over each minute
// between the countdown, `↻3d15h`, and the date, `↻Oct 6 11:00pm` -- the one
// you would put in a calendar. Off by the `reset` key in /sl-settings, and
// absent -- not `↻?` -- when the reading did not say.
//
// Its colour follows how far off the reset is, as a share of the window's own
// length -- within the hour for 5h, within the day and a bit for 7d -- and it is
// never green, amber or red: those are the quota's colours, and a red countdown
// next to a green bar would read as a quota in trouble.
const WINDOW_MS: Partial<Record<ItemKey, number>> = {
  five_hour: 5 * 3_600_000,
  seven_day: 7 * 86_400_000,
}
const resetColor = (left: number, window: number) =>
  left <= window * 0.2 ? CYAN : left <= window * 0.6 ? BLUE : FG
const resetFor = (w: Window, now: number, compact = false): Part['tail'] => {
  if (!showReset || typeof w.resetsAt !== 'number') return undefined
  const item = itemForWindow(w)
  const window = WINDOW_MS[item]
  if (window === undefined) return undefined
  const fg = resetColor(w.resetsAt - now, window)
  if (item === 'five_hour') return { fg, text: `${ICON.reset}${countdown(w.resetsAt, now)}` }
  // Odd minutes show the date. The tick below fires once a minute, so each tick
  // lands on the other face. A compact line keeps to the countdown, the shorter
  // of the two.
  const date = !compact && Math.floor(now / 60_000) % 2 === 1

  return { fg, text: `${ICON.reset}${date ? calendar(w.resetsAt) : countdown(w.resetsAt, now)}` }
}

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
        text: ctx.compact ? `ct ${contextPercent}%` : `ct ${bar(contextPercent)} ${contextPercent}%`,
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
    const parts: Part[] = []
    // Nothing until the first request: before it there is no cache to time.
    if (cacheWarmAt !== null) {
      const expiresAt = cacheWarmAt + CACHE_TTL_MS
      const left = expiresAt - ctx.now
      if (left <= 0) {
        // While the gate has asked, the cell says what answers it.
        parts.push({ fg: RED, text: coldAskedAt !== null && !ctx.compact ? `cache cold ${ICON.dot} enter sends it` : 'cache cold' })
      } else {
        // The bar drains: five segments of the hour left, rounded up like the
        // quotas, so a minute left still shows one.
        const fg = left <= CACHE_RED_MS ? RED : left <= CACHE_AMBER_MS ? AMBER : GREEN
        const time = countdown(expiresAt, ctx.now)
        parts.push({
          fg,
          text: ctx.compact ? `cache ${time}` : `cache ${bar((left / CACHE_TTL_MS) * 100)} ${time}`,
        })
      }
    }
    const hit = cacheHit()
    // The hit rate stays silent while it is healthy. A permanent cell for a
    // number that reads 99% is spent width, and the drop is the only moment it
    // says anything.
    if (hit !== null && hit < CACHE_ALERT_BELOW) parts.push({ fg: RED, text: `ch ${hit}%` })

    return parts
  }

  if (key === 'cost') {
    if (costUsd === null) return []

    return [{ fg: FG, text: `$ ${costUsd.toFixed(2)}` }]
  }

  if (key === 'speed') {
    if (speed === null) return []

    return [{ fg: FG, text: `${speed} tok/s` }]
  }

  if (key === 'turn') {
    if (lastTurn === null) return []
    const cost = lastTurn.usd === null ? '' : `$ ${lastTurn.usd.toFixed(2)} `

    return [{ fg: FG, text: `turn ${cost}${elapsed(lastTurn.ms)}` }]
  }

  // Everything left is a rate-limit window, and there may be several of a kind.
  return ctx.windows
    .filter(w => itemForWindow(w) === key)
    .map(w => ({
      fg: barColor(w.percentUsed),
      text: ctx.compact
        ? `${labelForWindow(w)} ${Math.round(w.percentUsed)}%`
        : `${labelForWindow(w)} ${bar(w.percentUsed)} ${Math.round(w.percentUsed)}%`,
      tail: resetFor(w, ctx.now, ctx.compact),
    }))
}

// The band, line by line. An item whose data is missing draws nothing even when
// it is switched on -- an empty bar reads as "nothing spent yet", which is the
// kind of green-because-it-was-attempted reading this repo keeps finding. A line
// with nothing on it is dropped rather than left as a gap.
//
// `columns` is what the surface gives the band (`bodyColumns`). A line wider
// than that is built again without its bars -- `ct 14%  5h 8% ↻2h08m  7d 8% ↻5d20h`
// -- and a line that fits keeps them. Line by line, so one crowded line does not
// strip the others. The width counted is the width drawn: a space either side of
// the text, the tail with its own space, and the separator.
const cellWidth = (p: Part) => [...p.text].length + 2 + (p.tail ? [...p.tail.text].length + 1 : 0) + 1
const lineWidth = (line: Part[]) => line.reduce((n, p) => n + cellWidth(p), 0)
const lineFor = (n: number, ctx: Ctx): Part[] =>
  ITEMS.filter(item => layout[item.key] === n).flatMap(item => partsFor(item.key, ctx))

const ctxOf = (cwd: string, model: string, now: number): Ctx => ({
  folder: cwd.replace(/\/+$/, '').split('/').pop() || '/',
  model,
  windows: shownWindows(now),
  now,
})

function buildLines(ctx: Ctx, columns = Infinity): Part[][] {
  const lines: Part[][] = []
  for (let n = 1; n <= MAX_LINES; n += 1) {
    let line = lineFor(n, ctx)
    if (lineWidth(line) > columns) line = lineFor(n, { ...ctx, compact: true })
    if (line.length > 0) lines.push(line)
  }

  return lines
}

// For /sl-debug: where a window's reset comes from, or why there is none.
const resetDebug = (ws: Window[], now: number, item: ItemKey) => {
  const w = ws.find(one => itemForWindow(one) === item)
  if (!w) return 'no such window in the shown reading'
  if (typeof w.resetsAt !== 'number') return 'the shown reading did not say'

  return `${new Date(w.resetsAt).toISOString()} (${countdown(w.resetsAt, now)}, ${calendar(w.resetsAt)}) ${showReset ? 'drawn' : 'off by the reset key'}`
}

// Which reading to draw. The remote one is preferred because it is the only one
// carrying the per-model week, but only while it is fresh: past the staleness
// bound the engine's two live windows are used instead.
//
// A shared reading may have been written by a session running a mod from before
// the reset existed, and then it carries none: on 2026-10-22 a VPS session on
// 0.1.6 drew no reset at all because a 0.1.4 session on the same box had
// fetched last, and the two took turns as their timers came round. The engine's
// own windows carry the reset for the same two periods, so a window that did not
// say takes it from there. Nothing is invented: a scoped week has no live twin
// and stays as it came.
function shownWindows(now: number): Window[] {
  const age = reading.at === null ? null : now - reading.at
  const fresh = reading.windows.length > 0 && age !== null && age < STALE_MS
  if (!fresh) return windows

  return reading.windows.map(w => {
    if (typeof w.resetsAt === 'number' || w.scope) return w
    const live = windows.find(l => itemForWindow(l) === itemForWindow(w))

    return typeof live?.resetsAt === 'number' ? { ...w, resetsAt: live.resetsAt } : w
  })
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
    showReset = (await $.store.get('showReset')) !== false
    guardOn = (await $.store.get('guard')) === true
    coldGateOn = (await $.store.get('coldGate')) === true
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
    contextWindow = usage.context.window ?? null
    if (typeof usage.context.percent === 'number') {
      await setContext($, usage.context.percent, 'session.start')
    }
    windows = fromEngine(usage.rateLimits)
    costUsd = usage.cost?.usd ?? null
    await refreshTheme($)

    // Timers FIRST, then the probes. The other way round, a probe that threw
    // left this hook without its timers and without `next(e)`: `session.start`
    // is a gating hook, which `claude plugin validate` says in as many words,
    // and one repo with no tags was enough to take the git poll down with it.
    //
    // Git is the one figure nothing pushes, so it is what gets polled -- off the
    // draw path, where its cost does not show. The version rides a slower timer:
    // it changes when someone edits package.json.
    $.clock.every(5000, () => void refreshGit($))
    $.clock.every(60_000, () => void refreshVersion($))
    $.clock.every(60_000, () => tickCountdown($))
    // The gauge's check on itself, for a compaction no hook was allowed to hear.
    $.clock.every(RESYNC_MS, () => void resyncContext($))
    // Off the draw path, always: a network call must never sit between a
    // keystroke and a frame.
    $.clock.every(POLL_MS, () => void refreshUsage($))

    void refreshGit($)
    void refreshVersion($)
    void refreshUsage($)

    return next(e)
  })

  // `session.start` does not fire after /clear, /resume or /branch -- the guide
  // is explicit about it -- so the readings would quietly age from whenever the
  // session began. This picks them up again. It also happens to be the only
  // event a test can raise, which is how the fallback paths below are covered.
  on('classic.SessionStart', async ($, e, next) => {
    const usage = await $.session.usage()
    contextWindow = usage.context.window ?? null
    if (typeof usage.context.percent === 'number') {
      await setContext($, usage.context.percent, 'classic.SessionStart')
    }
    windows = fromEngine(usage.rateLimits)
    costUsd = usage.cost?.usd ?? null
    // Awaited here, not fired and forgotten: this is the only event a test can
    // raise, so the probes have to have finished before the test looks. Each one
    // swallows its own failure, which is what makes awaiting them safe in a
    // gating hook.
    await refreshGit($)
    await refreshVersion($)
    await refreshUsage($)
    await refreshTheme($)

    return next(e)
  })

  // The person changed theme in /config: redraw in the other palette, once the
  // change has gone through.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const done = await next(e)
    if (done.deny === undefined) {
      applyTheme(e.value)
      $.ui.invalidate('ui.render')
    }

    return done
  })

  // Pushed, not polled: this fires when a figure actually moves.
  on('session.measure', async ($, e, next) => {
    if (typeof e.context.percent === 'number') {
      await setContext($, e.context.percent, 'session.measure')
    }
    contextWindow = e.context.window ?? contextWindow
    windows = fromEngine(e.rateLimits)
    costUsd = e.cost?.usd ?? costUsd
    // `cost` in `changed` is the engine saying a priced response landed, which
    // is exactly once per response: the dedup signal the token counts need.
    if (e.changed.includes('cost')) await sampleTokens($)

    return next(e)
  })

  // A compaction empties most of the window, and `session.measure` does not fire
  // for it: Ban watched a session compact and the `ct` gauge sit at 38%. The
  // number was not wrong when it was taken, which is the worst kind of wrong --
  // it reads as current.
  //
  // The compaction's own result carries what the window came down to, so this
  // takes the figure from the event rather than asking again. Asking again does
  // not help on its own: `context.tokens` is "input tokens the LAST RESPONSE was
  // answered over", and right after a compaction there has not been one yet.
  // Neither this hook nor the backstop below runs when a module seated outside
  // this one keeps the event; see resyncContext for the case that happened.
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (done.skip !== undefined) return done

    if (typeof done.tokensAfter === 'number' && contextWindow) {
      await setContext($, Math.round((done.tokensAfter / contextWindow) * 100), 'session.compact tokensAfter')
      $.ui.invalidate('ui.render')
    } else {
      const estimate = await breakdownPercent($)
      if (estimate !== null) {
        await setContext($, estimate, 'session.compact breakdown')
        $.ui.invalidate('ui.render')
      }
    }

    return done
  })

  // The backstop, for a compaction the hook above did not see or could not
  // size; see afterCompaction for what it takes.
  on('classic.PostCompact', async ($, e, next) => {
    await afterCompaction($, 'classic.PostCompact')

    return next(e)
  })

  // The only place effort can be read. `$.env.get('CLAUDE_EFFORT')` is
  // `undefined` in here -- the engine exports that variable to hook commands and
  // to Bash, not to a hooks module, which cost an afternoon to find out. So it
  // is unknown until the first model request of the session, and what shows
  // afterwards is the effort actually sent, after any silent downgrade.
  //
  // It is also the one compaction signal nothing seats itself in front of. The
  // main loop's request after a compaction carries a fraction of the messages
  // the one before it did -- the transcript was rewritten under it -- so a count
  // that fell below half is taken as one, on the first request rather than on
  // the next tick. A subagent's loop starts small and is not the transcript.
  // A /clear halves it too, and the breakdown then reads an emptied window,
  // which is right. The reading cannot fail; if it does, the request goes on.
  on('turn.step', async function* ($, e, next) {
    if (typeof e.effort === 'string') effort = e.effort
    if (e.agentId === undefined) {
      if (e.messageCount * 2 < mainMessages) {
        try {
          await afterCompaction($, 'turn.step')
        } catch {
          // the gauge keeps what it has; the model request is not the place to fail
        }
      }
      mainMessages = e.messageCount
      // The cache's hour runs from the request; the response's end is the
      // later, safer mark, and the cell takes it below.
      cacheWarmAt = await $.clock.now()
      coldAskedAt = null
    }
    const stream = effortOverride !== null && effortOverride !== e.effort ? next({ ...e, effort: effortOverride }) : next(e)
    let firstAt: number | null = null
    for await (const chunk of stream) {
      if (e.agentId === undefined) {
        if (firstAt === null) firstAt = await $.clock.now()
        if (chunk.kind === 'stop' && chunk.usage !== null) {
          const ms = (await $.clock.now()) - firstAt
          const out = chunk.usage.output_tokens
          if (out >= SPEED_MIN_TOKENS && ms >= SPEED_MIN_MS) speed = Math.round((out / ms) * 1000)
        }
      }
      yield chunk
    }
    const result = await stream.result
    if (e.agentId === undefined) {
      cacheWarmAt = await $.clock.now()
      $.ui.invalidate('ui.render')
    }

    return result
  })

  // A turn's cost is the difference of two session totals, read fresh at each
  // end; a reading that fails leaves the cost off the cell and keeps the
  // length. A subagent's turn is not the one you asked for.
  on('turn.start', async ($, e, next) => {
    try {
      turnCostAtStart = (await $.session.usage()).cost?.usd ?? null
    } catch {
      turnCostAtStart = null
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      let usd: number | null = null
      try {
        const total = (await $.session.usage()).cost?.usd
        if (typeof total === 'number' && turnCostAtStart !== null) usd = Math.max(0, total - turnCostAtStart)
      } catch {
        // the length still stands
      }
      lastTurn = { usd, ms: e.durationMs }
      $.ui.invalidate('ui.render')
    }

    return result
  })

  // The second source for effort, and the one that actually answers. `turn.step`
  // carries `effort` only where the request names one -- "the session's setting
  // or the model's default, absent for a model without effort" -- and in this
  // session it never did, so the model cell showed no level until a press put
  // one there. The classic hooks carry `effort.level` instead, "after any silent
  // downgrade", on anything that fires inside a tool-use context.
  //
  // PostToolUse for a turn that uses tools, Stop for one that does not. Both do
  // nothing but read a string, and both pass the event straight on.
  on('classic.PostToolUse', async ($, e, next) => {
    if (e.effort?.level) effort = e.effort.level

    return next(e)
  })

  on('classic.Stop', async ($, e, next) => {
    if (e.effort?.level) effort = e.effort.level

    return next(e)
  })

  on('command.run', { command: 'sl' }, async $ => {
    isHidden = !isHidden
    await $.store.set('isHidden', isHidden)
    $.ui.invalidate('ui.render')

    return { text: isHidden ? 'Status line hidden. `/sl` brings it back.' : 'Status line shown.' }
  })

  on('command.run', { command: 'sl-help' }, async $ => {
    await openTabs($, LEGEND)

    return {}
  })

  on('command.run', { command: 'sl-settings' }, async $ => {
    await openTabs($, SETTINGS)

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
    const [usage, model, estimate, now] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      breakdownPercent($),
      $.clock.now(),
    ])
    const age = contextAt === null ? '' : `, ${Math.round((now - contextAt) / 1000)}s ago`

    return {
      text: [
        `rateLimits: ${usage.rateLimits.length} entry(s)`,
        ...usage.rateLimits.map((w, i) => `  [${i}] ${JSON.stringify(w)}`),
        `  5h resets: ${resetDebug(shownWindows(now), now, 'five_hour')}`,
        `  7d resets: ${resetDebug(shownWindows(now), now, 'seven_day')}`,
        `context: ${JSON.stringify(usage.context)}`,
        `  band ct: ${contextPercent === null ? 'none' : `${contextPercent}%`} window=${contextWindow ?? 'none'} from=${contextSource}${age}`,
        `  breakdown (what /context shows): ${estimate === null ? 'none' : `${estimate}%`}`,
        `cost: ${JSON.stringify(usage.cost)}`,
        `model: ${model}`,
        `effort (from turn.step): ${effort ?? 'not seen yet'}`,
        `effort override: ${effortOverride ?? 'none'}`,
        `git: branch=${branch} dirty=${isDirty} ahead=${isAhead} -- ${gitNote}`,
        `project version: ${projectVersion ?? 'none found'} -- ${versionNote}`,
        `tokens: ${JSON.stringify(tokens)} cacheHit=${cacheHit() ?? 'n/a'}%`,
        `cache: ${cacheWarmAt === null ? 'no request seen yet' : `warm at ${new Date(cacheWarmAt).toISOString()}, ${countdown(cacheWarmAt + CACHE_TTL_MS, now)} left`}`,
        `speed: ${speed === null ? 'not timed yet' : `${speed} tok/s`}; last turn: ${lastTurn === null ? 'none' : `${lastTurn.usd === null ? 'cost unknown' : `$${lastTurn.usd.toFixed(2)}`}, ${elapsed(lastTurn.ms)}`}`,
        `layout: ${ITEMS.map(i => `${i.name}=${layout[i.key] || 'off'}`).join(' ')}`,
        `guard: ${guardOn ? 'on' : 'off'}${held === null ? '' : `, holding ${held.risk.label}`}`,
        `cold gate: ${coldGateOn ? 'on' : 'off'}${coldAskedAt === null ? '' : `, asked at ${new Date(coldAskedAt).toISOString()}`}`,
        `usage endpoint: ${reading.windows.length} window(s)`,
        ...reading.windows.map(w => `  ${w.kind}${w.scope ? ` (${w.scope})` : ''} ${w.percentUsed}%`),
        `  note=${reading.note || 'ok'}`,
        `  source=${readingSource}`,
      ].join('\n'),
    }
  })

  // The guard. Holding needs the hook to wait, and a hook has ten seconds of
  // its own time; time inside a `$` call is not its own, so the wait is a loop
  // of short sleeps run as a child process, until a Button's press, the turn's
  // interruption, or the ten-minute limit sets the decision. A guard that
  // throws fails open unless its registration says otherwise, so it does.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!guardOn) return next(e)
    const risk = classifyCommand(String(e.command ?? ''))
    if (risk === null) return next(e)

    // One at a time. `held` is claimed with no await between the check and the
    // claim, so two waiting calls cannot both get through.
    while (held !== null) {
      if (next.signal.aborted) return { deny: guardRefusal(risk.label, risk.label, 'the turn was interrupted') }
      await $.process.run([...GUARD_POLL], { timeoutMs: 5000 })
    }
    const mine: Held = { command: String(e.command), risk, report: null, decision: null }
    held = mine

    try {
      const from = await $.session.cwd()
      const cwd = risk.dir === null ? from : await resolveDir($, from, risk.dir)
      mine.report =
        cwd === null
          ? { summary: `${risk.label} in ${risk.dir}`, lines: [], more: 0, note: `the folder ${risk.dir} is not there, so this could not be measured` }
          : await measureRisk($, risk, cwd)
      $.ui.invalidate('ui.render')

      const startedAt = await $.clock.now()
      while (mine.decision === null) {
        if (next.signal.aborted) {
          mine.decision = 'interrupted'
          break
        }
        if ((await $.clock.now()) - startedAt > GUARD_HOLD_MS) {
          mine.decision = 'timeout'
          break
        }
        await $.process.run([...GUARD_POLL], { timeoutMs: 5000 })
      }
    } catch {
      mine.decision = 'error'
    } finally {
      if (held === mine) held = null
      $.ui.invalidate('ui.render')
    }

    if (mine.decision === 'run') {
      $.ui.toast('sl-mod guard: running it')

      return next(e)
    }
    const why: Record<Exclude<Decision, 'run'>, string> = {
      refuse: 'the user pressed refuse',
      interrupted: 'the turn was interrupted',
      timeout: 'no answer within ten minutes',
      error: 'the guard hit an error while holding it',
    }

    return { deny: guardRefusal(risk.label, mine.report?.summary ?? risk.label, why[mine.decision ?? 'error']) }
  }).catch(() => ({
    deny: 'sl-mod guard hit an error while holding this command and did not run it. Do not retry it unless the user asks you to.',
  }))

  // --- The cold gate: the prompt after a cold hour costs one more Enter ------
  // The cell says `cache cold`; this makes it cost a keystroke. A prompt typed
  // at the composer after the hour has gone is dropped once, with the re-read
  // in tokens, and the next Enter sends it. Only the person's own Enter is
  // gated: a scheduled trigger, a peer or a plugin has nobody there to send it
  // again, a slash command is not a model request, and a prompt typed into a
  // running turn lands on a cache that turn is keeping warm. Under
  // COLD_GATE_FLOOR tokens it stays quiet. In tokens, not dollars, for the same
  // reason `i` and `o` are. Asking once per cold spell, the floor, and letting
  // a slash command and an unattended prompt by are Karan Bansal's, from
  // cache-tax (see ACKNOWLEDGEMENTS.md). A gate that breaks lets the prompt
  // through -- the engine's default, and the right one for a nudge about money.
  on('prompt.submit', async ($, e, next) => {
    if (!coldGateOn || e.origin.kind !== 'composer' || e.turnId !== undefined || cacheWarmAt === null) return next(e)
    if (e.text.trimStart().startsWith('/')) return next(e)
    const now = await $.clock.now()
    const coldAt = cacheWarmAt + CACHE_TTL_MS
    if (now < coldAt) return next(e)
    if (coldAskedAt !== null) {
      // Asked already, and nothing sent since: this Enter is the answer.
      coldAskedAt = null

      return next(e)
    }
    const size = (await $.session.usage()).context.tokens
    if (size !== undefined && size < COLD_GATE_FLOOR) return next(e)
    coldAskedAt = now
    $.ui.invalidate('ui.render')
    // Whether a dropped prompt's draft stays in the box is the engine's to say,
    // and it does not say: so the text is put back if the box is empty, and
    // left alone if it is not.
    const box = await $.prompt.read()
    if (box.text.trim() === '') await $.prompt.fill({ text: e.text })

    return { drop: coldReason(countdown(now, coldAt), size) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A survey owns the band while it is up; stand aside rather than fight it.
    // A held command is drawn even while the band is hidden: it is a question,
    // and ten minutes of silence would refuse it.
    const holding = held !== null && held.report !== null ? held : null
    if (e.props.hasSurvey || (isHidden && holding === null)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const cwd = await $.session.cwd()
    const model = await $.session.model()
    const now = await $.clock.now()

    // While Claude works the spinner is what matters, so the row steps back.
    const dim = e.props.isWorking

    const lines = buildLines(ctxOf(cwd, model, now), e.props.bodyColumns)
    // While a command is held, its report takes row one's place: the budget
    // rows stay, the identity row is the one you need least just then.
    if (holding !== null && isHidden) lines.length = 0
    else if (holding !== null && lines.length > 0 && lineFor(1, ctxOf(cwd, model, now)).length > 0) lines.shift()
    if (lines.length === 0 && holding === null) return next(e)

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

        // The tail is its own Text so it can take its own colour, on the same
        // background so the cell stays one cell.
        return [
          Text({ backgroundColor: here, color: part.fg, dimColor: dim, children: [` ${part.text}${part.tail ? '' : ' '}`] }),
          ...(part.tail
            ? [Text({ backgroundColor: here, color: part.tail.fg, dimColor: dim, children: [` ${part.tail.text} `] })]
            : []),
          Text({ backgroundColor: after, color: here, dimColor: dim, children: [ICON.sep] }),
        ]
      })

    // The held command's report. The buttons answer the call this was drawn
    // for, never whichever one is held by the time the key lands. `refuse` has
    // the focus, so Enter refuses.
    const guard = (h: Held & { report: Report }) => {
      const decide = (choice: Decision) => () => {
        if (h.decision === null) h.decision = choice
      }
      const label = (left: string, right: string, color: string) =>
        Box({
          flexDirection: 'row',
          children: [Text({ color: MUTED, children: [left.padEnd(8)] }), Text({ color, bold: true, wrap: 'truncate-end', children: [right] })],
        })

      return Box({
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: AMBER,
        paddingX: 1,
        children: [
          Text({ color: AMBER, bold: true, children: [`${ICON.warn} guard ${ICON.dot} ${h.risk.label}`] }),
          label('command', h.command, FG),
          label('would', h.report.summary, RED),
          ...h.report.lines.map(l => Text({ color: FG, wrap: 'truncate-end', children: [`  ${l}`] })),
          ...(h.report.more > 0 ? [Text({ color: MUTED, children: [`  + ${h.report.more} more`] })] : []),
          ...(h.report.note !== '' ? [Text({ color: MUTED, italic: true, wrap: 'wrap', children: [h.report.note] })] : []),
          Box({
            flexDirection: 'row',
            columnGap: 2,
            children: [
              Button({ key: 'guard-run', label: 'run', hotkey: '1', plain: true, onPress: decide('run') }),
              Button({ key: 'guard-refuse', label: 'refuse', hotkey: '2', plain: true, autoFocus: true, onPress: decide('refuse') }),
              Text({ color: MUTED, children: ['Claude is waiting on your answer'] }),
            ],
          }),
        ],
      })
    }

    return Box({
      flexDirection: 'column',
      children: [
        ...(holding !== null ? [guard(holding as Held & { report: Report })] : []),
        ...lines.map(line => Box({ flexDirection: 'row', children: row(line) })),
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
      now,
    }

    const itemRow = (item: (typeof ITEMS)[number]) => {
      const n = layout[item.key]
      const parts = partsFor(item.key, ctx)
      const preview = parts.length > 0 ? parts.map(plain).join('  ') : '(nothing to show yet)'

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

    const lines = buildLines(ctx, e.props.bodyColumns)

    // The five levels spelled out, with the one in force in brackets. `session`
    // is a choice like any other and the first one: it means this mod has no
    // opinion and the band reports whatever the session is doing.
    const choices = EFFORT_CHOICES.map(choice => {
      const name = choice === null ? 'session' : (EFFORT_LETTER[choice] ?? choice)

      return choice === effortOverride ? `[${name}]` : ` ${name} `
    }).join('')

    return Box({
      flexDirection: 'column',
      children: [
        Text({ color: MUTED, wrap: 'wrap', children: ['A key moves its item on: 1, 2, 3, 4, off.'] }),
        Text({ children: [' '] }),
        ...ITEMS.map(itemRow),
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Button({
              key: 'item-reset',
              label: 'reset'.padEnd(9),
              hotkey: 't',
              plain: true,
              onPress: () => void toggleReset($),
            }),
            Text({ color: showReset ? BLUE : MUTED, children: [showReset ? 'on    ' : 'off   '] }),
            Text({
              color: MUTED,
              wrap: 'wrap',
              children: [`${ICON.reset} after 5h and 7d: time to the reset; the week also turns to a date`],
            }),
          ],
        }),
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Button({
              key: 'item-guard',
              label: 'guard'.padEnd(9),
              hotkey: 'a',
              plain: true,
              onPress: () => void toggleGuard($),
            }),
            Text({ color: guardOn ? BLUE : MUTED, children: [guardOn ? 'on    ' : 'off   '] }),
            Text({
              color: MUTED,
              wrap: 'wrap',
              children: ['hold rm -rf, git reset --hard, git clean and a force push; 1 runs, 2 refuses'],
            }),
          ],
        }),
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Button({
              key: 'item-cold-gate',
              label: 'cold gate'.padEnd(9),
              hotkey: 'k',
              plain: true,
              onPress: () => void toggleColdGate($),
            }),
            Text({ color: coldGateOn ? BLUE : MUTED, children: [coldGateOn ? 'on    ' : 'off   '] }),
            Text({
              color: MUTED,
              wrap: 'wrap',
              children: ['cold cache: drop the next prompt once, with the re-read; enter again sends it'],
            }),
          ],
        }),
        Text({ children: [' '] }),
        Text({ color: BLUE, bold: true, children: ['Effort'] }),
        Box({
          flexDirection: 'row',
          columnGap: 1,
          children: [
            Button({
              key: 'item-effort',
              label: 'effort'.padEnd(9),
              hotkey: 'e',
              plain: true,
              onPress: () => cycleEffort($),
            }),
            Text({ color: effortOverride === null ? MUTED : BLUE, children: [choices] }),
          ],
        }),
        Text({
          color: MUTED,
          wrap: 'wrap',
          children: [
            `the session itself reports ${effort ?? 'nothing yet -- it is read off the first tool call or the end of the first turn'}`,
          ],
        }),
        Text({ children: [' '] }),
        Text({ color: BLUE, bold: true, children: ['As the band will draw it'] }),
        ...(lines.length === 0
          ? [Text({ color: MUTED, children: ['nothing switched on'] })]
          : lines.map((line, i) =>
              Text({ color: FG, wrap: 'truncate-end', children: [`${i + 1}  ${line.map(plain).join('  ')}`] }),
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
            Text({
              color: MUTED,
              children: [`${ICON.dot} esc closes ${ICON.dot} tab to the sl help tab and enter, or click it`],
            }),
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
        line('reset (t)', `${ICON.reset}2h14m after 5h, ${ICON.reset}3d15h or ${ICON.reset}Oct 6 11:00pm after 7d, turn by turn ${ICON.dot} ${showReset ? 'on' : 'off'}`),
        line('reset colour', 'cyan when the reset is close, blue midway, plain further out -- never the gauge colours'),
        line('narrow', 'a line the terminal has no room for drops its bars: `5h 8%` for `5h ▰▱▱▱▱ 8%`'),
        line('theme', 'Tokyo Night Moon on a dark theme, Day on a light one; follows /config'),
        gap,
        Text({ color: BLUE, bold: true, children: ['Reading a gauge'] }),
        line(`${bar(10)}  1-20%`, 'five segments of 20%, rounded UP'),
        line(`${bar(30)}  21-40%`, 'so 19% shows one segment, never none'),
        line(`${bar(90)}  81-100%`, 'a quota must not read lower than it is'),
        line('colour', 'green under 60%, amber from 60, red from 85'),
        line('cache', 'the hour left on the prompt cache, from the last request: amber inside 20m, red inside 10m, `cold` once gone'),
        line('ch', `cache hit, joins the cell only under ${CACHE_ALERT_BELOW}% -- above that it has nothing to say`),
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
        line('effort (e)', 'in /sl-settings: session, low, medium, high, xhigh, max -- picked outright, never nudged'),
        line('guard (a)', `in /sl-settings: hold a risky shell command in the band until 1 runs it or 2 refuses it ${ICON.dot} ${guardOn ? 'on' : 'off'}`),
        line('cold gate (k)', `in /sl-settings: after a cold hour, the next prompt is dropped once with the re-read in tokens; enter again sends it ${ICON.dot} ${coldGateOn ? 'on' : 'off'}`),
        line('/sl', 'hide or show the band'),
        line('/sl-settings', 'choose what shows, and on which line'),
        line('/sl-effort <level>', 'set it outright, or `off` to stop overriding'),
        line('/sl-debug', 'print what the engine reports -- text, so it can be copied out'),
        line('tabs', 'help and settings open together; click a tab, or tab onto it and enter'),
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
