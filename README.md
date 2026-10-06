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
  arch     Opus 5 ▮▮▯▯▯ (M)    main ✓   ⌂ 0.1.0
 ct ▰▰▰▰▱ 66%   5h ▰▱▱▱▱ 9%   7d ▰▰▱▱▱ 39%   fable ▰▰▱▱▱ 26%
```

Up to four lines, and what sits on which is set in `/sl-settings`. The default
is identity on line one and budget on line two. Nothing is drawn under the
prompt: the engine keeps its own hint line.
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

Up to four lines draw, set in `/sl-settings`. `/sl`, `/sl-help`, `/sl-settings`,
`/sl-effort` and `/sl-debug` work. Twelve tests pass under `claude plugin test`,
`tsc -p .` is clean and `claude plugin validate` passes.

Every polled figure carries a note saying why it has nothing, and `/sl-debug`
prints it. An empty cell looks identical whether the probe answered "no branch"
or threw on the way to asking, and that silence has cost time here before.

## The hint line, and why nothing is drawn there now

Two things were tried and neither worked.

A `flexDirection: 'column'` tree at `PromptHint` does **not** give two rows. A
tree carrying both the controls and the engine's own `hint` string came out as
one wrapped line with the engine's text broken across it:

```
⏵⏵ auto mode on · effort: [ ▲ ] [ ▼ ] · [ help ]
                    (shift+tab to cycle)
```

And `4`, `5` and `0` never fired there — measured, not assumed. The types say a
bare digit from an empty composer presses a band Button and only a band Button,
and that is what happens.

So the site is left alone. The controls live in `/sl-settings` instead, where a
pane holds the keyboard and a Button's hotkey works.

## Effort is picked, never nudged

A relative control needs a baseline, and the baseline was a guess. `turn.step`
carries `effort` only where the request names one — *"the session's setting or
the model's default, absent for a model without effort"* — and in this session it
never did. So one press of "more" from an unknown start computed `medium + 1`
and drew `(H)` for a session that was not on high.

Two fixes, and both were needed:

- **The level is now read.** The classic hooks carry `effort.level`, *"after any
  silent downgrade"*, on anything firing inside a tool-use context.
  `classic.PostToolUse` covers a turn that uses tools and `classic.Stop` one
  that does not. Each hook reads one string and passes the event straight on.
- **The control is a list, not a nudge.** `/sl-settings` spells out `session`,
  `L`, `M`, `H`, `X`, `✦` and `e` steps through them. `session` is the first
  choice and means this mod has no opinion: `turn.step` passes every request
  through untouched and the band reports whatever the session is doing. A list
  you pick from cannot be wrong about where it started.

Unlike the layout, the effort choice is **not** stored. The layout is a
preference that outlives the session; the effort of the requests this session
sends is not.

## What goes where

`/sl-settings` draws one row per item. Its key moves that item on: line 1, 2, 3,
4, off, and round again. One key per item and no cursor to lose. The effort
control sits at the bottom of the same pane.

The layout is stored in `$.store`, so it is per machine and outlives the
session.

Two rules the pane obeys:

- An item switched **on** whose data is missing draws nothing. An empty bar
  reads as "nothing spent yet", which is the same green-because-it-was-attempted
  reading this repo keeps finding elsewhere.
- A line with nothing on it is dropped, not left as a gap.

### cache hit

`ch` is drawn only under **70%**. Above that it reads 98–100% and says nothing,
and a permanent cell for a constant is spent width. It is also the one figure
here that reports the past: by the time it drops, the money is gone.

It is summed over the session rather than read off the last response, which
needs a dedup signal — `session.measure` naming `cost` in `changed`, the
engine's own word for "a priced response landed".

### input and output are tokens, not dollars

The engine hands a mod one money figure: the session total, `cost.usd`, with no
split between input and output. Turning tokens into dollars would mean a price
table in this file, and a price table in a file is a number that goes wrong
silently the day the prices change. So `i` and `o` are token counts and `$` is
the session total.

The lifetime figures (`$470.66`, `587.4M tokens`) are out of reach entirely:
they need either the transcript scan this mod exists to avoid, or `ccuc`, which
is not on every machine.

### version

`⌂ 0.1.0` is the **open project's** version, not the engine's, read in this
order: `package.json`, `.claude-plugin/plugin.json`, `pyproject.toml`,
`Cargo.toml`, then `git describe --tags`. Nothing found means no cell — `⌂ ?`
says less than nothing does.

`dotfiles/arch` declares no version and has no tags, so it draws no cell. That
is the intended answer, not a failure — `/sl-debug` spells out which it is.

A version from a git tag gets `+N` when HEAD has moved past it, because then the
thing running is not the thing the tag names. A version from a file gets no
mark: in claude-powerline `✓` is the **git-clean** symbol, and the git cell two
along already draws that. (Its own version segment shows `hookData.version`,
i.e. Claude Code's version, with no tick at all.)

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
them and a mod can't fix that: a mod does not choose the font. A glyph JetBrains
Mono does not carry is drawn by whichever fallback font fontconfig reaches, at
that font's metrics.

Measured with `fc-list :charset=<cp>`, so it is checkable rather than folklore:

| | in JetBrains Mono | from a fallback font |
|---|---|---|
| icons | `⌂ ✓ ● ⇡ ▲ ▼ ·` and ``  (E0B0) | ``  ``  `` (Nerd Font PUA) |
| gauges | `■ □ █ ░ ▓` | `▰ ▱` (in use), `▮ ▯` (effort) |

Two things fall out of that table. The powerline separator **is** in JetBrains
Mono, so it draws at the right size — it was simply missing, as an empty string,
for four commits. And both bar pairs in use are fallback glyphs: `██░░░` or
`■■□□□` would be the same-size swap, one line each, not taken because the
current pair was asked for.

Row two takes words — `ct`, `5h`, `7d`, and the model's own name for a scoped
window. A word renders at the row's own size, and the budget row is the half
that has to be read fast.

Every glyph in the source is written as a `\u{...}` escape. Written as
characters they were lost in a file write once already, and the symptom was
quiet: every icon became an empty string, and the powerline separator between
two cells drew nothing at all for four commits.
