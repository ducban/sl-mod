# sl-mod

A status line for Claude Code drawn in the band above the prompt, as a mod
instead of a `statusLine` command.

## Why

The `statusLine` setting runs a command on every redraw. The one it replaces,
`claude-powerline`, takes **~57 ms** a render here: almost all of that is Node
starting up, before it reads 127 MB of transcripts to total the tokens. A mod
is a module the engine loads once, so a redraw is a function call, and the
expensive reads move onto a timer instead of sitting on the draw path.

The trade: there is no render site under the prompt, so the band sits **above**
it. The two lines move; they do not stay where `statusLine` put them.

## What it shows

```
  arch     Opus 5 ▮▮▮▯▯ (H)    main ✓
 ct ▰▰▰▰▱ 66%   5h ▰▱▱▱▱ 9%   7d ▰▰▱▱▱ 39%   fable ▰▰▱▱▱ 26%

 > │
   effort: [▲] [▼] · [help]
   ⏵⏵ auto mode on · (shift+tab to cycle) · ← for agents
```

Line one is identity, line two is budget, and the controls sit in the engine's
own hint line under the prompt.
Each bar is five segments of 20%, rounded **up**, so 19% shows one segment
rather than none — a quota must never read lower than it is.

Line two walks whatever windows come back rather than asking for two by name.
That matters: the engine hands a mod `five_hour` and `seven_day` and drops the
per-model week, the `Current week (Fable)` row in `/usage`. It's filtered out of
the status line payload too.

`$.session.authorize()` gets round that. It answers an opaque handle for the
session's own Anthropic credential, and `$.http.fetch(url, { auth: handle })`
spends it against a first-party host. The credential never reaches the mod, which
also means the mod never refreshes it — so the token rotation that can cost you a
Claude Code session isn't in play. Nothing to install, on any machine.

When that reading is older than fifteen minutes it isn't drawn, and the engine's
two live windows are used instead. Two bars beat three bars holding an old
number.

## State

Both rows draw. `4` and `5` rotate effort, `0` opens the legend, and `/sl`,
`/sl-help`, `/sl-effort` and `/sl-debug` work. Eight tests pass under
`claude plugin test`.

The controls sit under the prompt, on a row of their own above the engine's
hint line. Measured, not assumed: `4`, `5` and `0` **do not fire** there. The
types say a bare digit from an empty composer presses a band Button and only a
band Button, and that is what happens. The hotkeys stay registered in case the
site is ever focusable, and they are not drawn — advertising a key that does
nothing is worse than no key. Clicking works, and `/sl-effort <level>` sets the
level outright.

## Run it

```bash
claude --plugin-dir ~/Workspace/Projects/personal_works/sl-mod
claude plugin validate ~/Workspace/Projects/personal_works/sl-mod
claude plugin test ~/Workspace/Projects/personal_works/sl-mod
```

The old `statusLine` command was removed from `~/.claude/settings.json` on
2026-10-06 so the band is the only status line in the window. To put
`claude-powerline` back, the block was:

```json
"statusLine": {
  "type": "command",
  "command": "claude-powerline --config=~/.claude/powerline-config.json",
  "padding": 0
},
```

## Icons on row one, words on row two

Row one takes Nerd Font icons. They draw a shade smaller than the text beside
them and a mod can't fix that: JetBrains Mono carries none of them, so each is
drawn by whichever fallback font fontconfig reaches, at that font's metrics. It
has `◔ ■ □ █ ░ │ · ✓ ●` and not `▰ ▱ ▮ ▯` or anything in the Nerd Font private
use area. Choosing the font is the terminal's call, not the mod's.

Row two takes words — `ct`, `5h`, `7d`, and the model's own name for a scoped
window. A word renders at the row's own size, and the budget row is the half
that has to be read fast.

Every glyph in the source is written as a `\u{...}` escape. Written as
characters they were lost in a file write once already, and the symptom was
quiet: every icon became an empty string, and the powerline separator between
two cells drew nothing at all for four commits.
