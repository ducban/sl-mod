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
const KIND_ICON: Record<string, string> = {
  five_hour: '',
  seven_day: '',
  spend_limit: '',
}
const iconFor = (kind: string) => KIND_ICON[kind] ?? ''

// --- What the drawing reads --------------------------------------------------
// Module-level, so a redraw costs nothing. They go back to their defaults when
// the module reloads, and each is filled again by the hook that owns it.
type Window = { kind: string; percentUsed: number }
let contextPercent: number | null = null
let windows: Window[] = []
let effort: string | undefined
let branch: string | null = null
let isDirty = false
let isAhead = false

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
    await $.command.register({
      name: 'sl-debug',
      description: 'Print the raw session usage the status line reads',
    })

    // The first reading, before any measurement has been pushed.
    const usage = await $.session.usage()
    contextPercent = usage.context.percent ?? null
    windows = usage.rateLimits.map(w => ({ kind: w.kind, percentUsed: w.percentUsed }))

    await refreshGit($)
    // Git is the one figure nothing pushes, so it is the one thing polled --
    // off the draw path, where its cost does not show.
    $.clock.every(5000, () => void refreshGit($))

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
    yield* next(e)
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
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A survey owns the band while it is up; stand aside rather than fight it.
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
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
      ...cell(bg(0), bg(1), BLUE, `  ${folder}`),
      ...cell(
        bg(1),
        bg(2),
        PINK,
        (() => {
          const eff = effortBar(effort)
          return eff ? ` ${model} ${eff.bar} (${eff.letter})` : ` ${model}`
        })(),
      ),
      ...(branch
        ? cell(
            bg(2),
            bg(3),
            isDirty ? AMBER : isAhead ? CYAN : GREEN,
            ` ${branch} ${isDirty ? '●' : isAhead ? '⇡' : '✓'}`,
          )
        : []),
    ]

    // Every gauge means the same thing -- how much of an allowance is gone --
    // so they can sit in one row and be read at a glance.
    const gauges = [
      ...(contextPercent === null
        ? []
        : cell(bg(0), bg(1), FG, `◔ ${bar(contextPercent)} ${contextPercent}%`)),
      ...windows.flatMap((w, i) =>
        cell(
          bg(i + 1),
          bg(i + 2),
          barColor(w.percentUsed),
          `${iconFor(w.kind)} ${bar(w.percentUsed)} ${Math.round(w.percentUsed)}%`,
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
}
