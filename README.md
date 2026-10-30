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

What it keeps from `claude-powerline`, and every idea taken from another mod
since, is listed in `ACKNOWLEDGEMENTS.md`, one line each with the person and
the licence.

## What it shows

```
  arch     Opus 5 ▮▮▯▯▯ (M)    main ✓   ⌂ 0.1.2
 ct ▰▰▰▰▱ 66%   5h ▰▱▱▱▱ 9% ↻2h14m   7d ▰▰▱▱▱ 39% ↻3d15h   fable ▰▰▱▱▱ 26%
```

Up to four lines, and what sits on which is set in `/sl-settings`. The default
is identity on line one and budget on line two. Nothing is drawn under the
prompt: the engine keeps its own hint line.
Each bar is five segments of 20%, rounded **up**, so 19% shows one segment
rather than none — a quota must never read lower than it is.

The `5h` bar carries `↻2h14m`: how long until the window resets, minutes rounded
up, and `↻now` once the moment has passed and the engine has not sent the next
reset yet — it comes with the next reading, not at the stroke of the hour. The
`7d` bar turns over once a minute between its countdown, `↻3d15h`, and the date
it lands on, `↻Oct 6 11:00pm` in the terminal's own zone: the week is days off,
and the date is the one you would put in a calendar. Both readings carry the
reset (`resetsAt` from the engine, `resets_at` from the endpoint), so it and the
percent always come off the same reading. The `reset` key in `/sl-settings`
turns both off, and while they are on the band ticks once a minute, since
nothing else redraws it between events.

A shared reading written by a session on an older mod carries no reset, and on
2026-10-22 a VPS running 0.1.6 and 0.1.4 side by side drew the reset only when
the newer one had fetched last. A window that did not say now takes its reset
from the engine's own window of the same period, which always carries one; a
scoped week has no live twin and stays as it came. Updating every session on
the box makes the question go away.

## Narrow terminals, and the theme

A line the terminal has no room for is drawn without its bars:

```
 ct 14%   5h 8% ↻2h08m   7d 8% ↻5d20h   fable 1%
```

The same figures in half the width. It is decided line by line against the
`bodyColumns` the surface hands the band, so one crowded line does not strip
the others, and a line that fits keeps its bars. On a narrow line the `7d` cell
keeps to its countdown, the shorter of its two faces.

Two palettes: Tokyo Night Moon on a dark theme, which is what the old status
line used, and Tokyo Night Day on a light one. The band paints its own
backgrounds, so it was readable on a light theme before — a dark bar on a light
page — but it looked pasted on. The theme is read from the `/config` row at
start and again on the `config.set` that changes it, so switching redraws the
band without a restart. The Moon background steps were a shade too close to the
terminal's own background — on 2026-10-22 a reader could not make the cells out
from the row behind them — so each is one notch up the palette now.

The reset sits in the bar's cell but not in its colour. It goes cyan when the
reset is close (inside a fifth of the window: the last hour of 5h, the last
day and a bit of 7d), blue midway, and plain further out — and never green,
amber or red, which are the quota's. A red countdown next to a green bar would
read as a quota in trouble.

Line two walks whatever windows come back rather than asking for two by name.
That matters: the engine hands a mod `five_hour` and `seven_day` and drops the
per-model week, the `Current week (Fable)` row in `/usage`. It's filtered out of
the status line payload too.

`$.session.authorize()` gets round that. It answers an opaque handle for the
session's own Anthropic credential, and `$.http.fetch(url, { auth: handle })`
spends it against a first-party host. The credential never reaches the mod, which
also means the mod never refreshes it — so the token rotation that can cost you a
Claude Code session isn't in play. Nothing to install, on any machine.

One reading per machine, not per session. Each open session runs its own copy
of this mod with its own three-minute timer, so four sessions made four calls a
period against one token, plus one per session start, and the endpoint's limit
is per token: on 2026-10-11 that kept one Mac at 429 for hours while the same
account from another machine answered 200. The reading now lives in `$.store`,
which every session on the box shares: whoever finds it older than three minutes
fetches and writes it back, everyone else adopts it, and a 429's backoff is
shared the same way. `/sl-debug` prints `source=` so you can see which it was.

When that reading is older than fifteen minutes it isn't drawn, and the engine's
two live windows are used instead. Two bars beat three bars holding an old
number.

## Compaction

`session.measure` does **not** fire for a compaction, so the context gauge used
to keep the figure from before it — 38% on a session that had just emptied its
window. True when it was taken, which is the worst kind of wrong, because it
reads as current.

Two hooks cover it. `session.compact` takes the number off the compaction's own
result (`tokensAfter`), which is the better source: asking again does not help on
its own, because `context.tokens` is *"input tokens the last response was
answered over"* and right after a compaction there has not been one.
`classic.PostCompact` is the backstop for a compaction that reports no count.

The backstop first shipped reading `context.percent` and taking it only if it had
moved down, on the theory that a reading which had not caught up would still hold
the pre-compaction figure. It does not: the engine **drops the field**, so right
after a compaction `usage.context` is `{ window }` and nothing else until the next
response lands. On 2026-10-19 a session read `/context` at 9% while the band held
20% from before its compaction — the backstop had asked, been handed no `percent`,
and kept what it had. One response later the engine reported 10% and the gauge
caught up on its own, so the hole was exactly the gap between a compaction and
the next response, which is also exactly when you look at the gauge.

Both hooks now fall back to `$.session.usage({ breakdown: 'summary' })` and take
`breakdown.percentage`: the fill as `/context` estimates it, computed locally
with no request sent, and the only figure that exists in that gap. It measures
against the compaction window rather than the model's, so it may read a point
above `percent` for the same transcript — the same as `/context` does. The
moved-down guard stays as the last resort for a breakdown that is not there.

`/sl-debug` now prints `band ct:` — the gauge's own number, which hook wrote it
and how long ago — next to the engine's raw `context:`, so "the engine stopped
reporting" and "the band stopped listening" no longer look the same. It prints
the breakdown's figure too.

Then on 2026-10-26 neither hook ran at all. On a machine with managed settings,
or a Team or Enterprise account, Claude Code 2.1.310 seats its bundled
`cc-plugin-sec-default@builtin` outermost, and that module does not pass
`session.compact` or `classic.PostCompact` on: the engine logs *"sl-mod: its
session.compact hook was skipped. \"cc-plugin-sec-default\" runs first and sent
the event on past it"* and the band never hears. A `/compact` took one session
from 202k tokens to 15k and the gauge held 20% while `/context` said 6%. (The
same module keeps `classic.SessionStart` and `classic.PostToolUse`, which is the
notice that opens every session on such a machine; those two are harmless here,
because `session.start` takes the first readings.)

So the gauge now checks its own premise, on a timer, which is the mod's own and
has nothing seated in front of it. Every ten seconds it reads the plain usage —
one local call. The engine drops `context.percent` the moment a compaction lands
and does not put it back until the next response, so a gauge holding a number
while the reading has none has missed a compaction, and it takes the breakdown
as the hooks would have. The rest of the time the tick does nothing: no
estimate, no redraw. `/sl-debug` shows a gauge written this way as
`from=tick breakdown`. The fix that belongs to Claude Code is for the bundled
module to call `next(e)`; this one just stops depending on it.

The tick can still be ten seconds late, and the request you send right after a
compaction is when you look at the gauge. So `turn.step`, the one event every
mod is handed, is read for it too: each main-loop request says how many
messages it carries (`messageCount`), and a request carrying fewer than half of
what the last one did is the first after a compaction — the transcript was
rewritten under it. The gauge then takes the breakdown the same way, on the
request itself rather than on the next tick; `/sl-debug` shows it as
`from=turn.step breakdown`. A subagent's loop carries its own small count and is
skipped, and a `/clear` halves it too, which lands on an emptied window and is
right. The halving test is Karan Bansal's, from
[cache-tax](https://github.com/karanb192/cache-tax); see `ACKNOWLEDGEMENTS.md`.

The `session.compact` path has no test: the harness has no transcript, so
`e.messages` is not a list and every hook in the chain is skipped for passing it
on. The backstop is tested against the reading's real post-compaction shape: no
`percent`, a breakdown only when asked, and the guard on a `percent` that is
present. The timer is tested on its own: a reading that loses its `percent`
while the gauge holds one, the tick taking the breakdown, following it while the
gap lasts, and standing down once a pushed figure returns. The `turn.step` test
drives the stream from a stand-in bottom: a count that grows, a subagent's small
one, then the main loop's falling to a third and the gauge taking the breakdown.

## State

Version 0.1.8, installed from this repo's own marketplace at scope **user**, so
it draws in every session on this box. All five commands work. Twenty-two tests
pass under `claude plugin test`, `tsc -p .` is clean and `claude plugin validate`
passes.

Every polled figure carries a note saying why it has nothing, and `/sl-debug`
prints it. An empty cell looks identical whether the probe answered "no branch"
or threw on the way to asking, and that silence has cost time here before.

## Help and settings are tabs

Nothing was built for this. The engine draws no title for a lone pane and a tab
strip the moment a second one is open -- `PaneOpenArgs.title` says so outright:
"The pane's tab while more than one pane is open (with one, no title is drawn)",
and the `Pane` render event: "one shown, the rest tabs".

So `/sl-help` and `/sl-settings` each open both panes and raise their own.
`focus: true` raises as well as focuses, which is why the asked-for pane is
opened last. A click on the other tab shows it, or Tab onto it and Enter.

`/sl-debug` stays text. It is a dump meant to be selected and pasted somewhere,
and a pane body cannot be copied out.

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

## The guard

The band was only ever a reading. This is the first thing on it that asks.

Four shell commands throw something away that neither git nor the disk gives
back: `rm -rf`, `git reset --hard`, `git clean`, and a force push. With the
guard on, a Bash call for one of them is held before it runs, what it would
destroy is measured, and the report takes row one's place in the band:

```
 ╭─ ⚠ guard · rm -rf ────────────────────────────────────────────────╮
 │ command  rm -rf build                                              │
 │ would    delete 1,204 files · 38 MB                                │
 │   build/index.js                                                   │
 │   build/chunk-1f3a.js                                              │
 │   build/assets/logo.svg                                            │
 │   + 1,201 more                                                     │
 │ 1: run   2: refuse   Claude is waiting on your answer              │
 ╰────────────────────────────────────────────────────────────────────╯
 ct ▰▰▰▰▱ 66%   5h ▰▱▱▱▱ 9% ↻2h14m   7d ▰▰▱▱▱ 39% ↻3d15h
```

`1` runs it as written. `2`, Esc on the turn, ten minutes of silence, or an
error in the guard itself all refuse it, and Claude reads why — *"the user
pressed refuse. It would have: delete 1,204 files"* — so it does not try the
same line again. `refuse` holds the focus, so Enter refuses. The budget row
stays under the report; the identity row is the one you need least just then.
A held command is drawn even while the band is hidden with `/sl`: it is a
question, and silence would answer it.

What each one measures:

| Command | Shown |
|---|---|
| `rm -r`, `rm -f`, `rm -rf` | the files it would delete, count and size; globs and `~` expanded |
| `git reset --hard` | the files with uncommitted changes, and `git diff --shortstat` |
| `git clean` | what `git clean -n` with the same flags would remove |
| `git push --force`, `-f`, `--force-with-lease`, `+ref` | the commits on the remote branch that the push would drop, as of the last fetch |

A `cd dir &&` or `git -C dir` earlier on the line moves where it is measured.
Paths go to `bash`, `find`, `du` and `git` as **arguments**, never as source, so
nothing in a file name runs. A relative path gets `./` in front, so `find` never
reads a name like `-delete` as an action.

How the hold works: a hook has ten seconds of its own time, which is no time to
wait for a person, but time inside a `$` call is not its own. So the hold is a
loop that sleeps a quarter second at a time through `$.process.run(['sleep'])`
until a button's `onPress` sets the decision, the turn's `next.signal` aborts,
or ten minutes pass. One command is held at a time; a second risky call waits
for the first. A guard that throws fails *open* unless its registration carries
a `.catch`, so it does, and the handler refuses.

What it does not do: it reads the command text and does not parse shell.
`$(...)`, `eval`, `bash -c "..."`, `xargs rm`, `find -delete`, and scripts that
call `rm` are not caught. It is a net, not a permission system; a hard block
belongs in the permission rules. It is **off** by default and switched on with
`guard (a)` in `/sl-settings`, stored like the layout.

The idea, and the shape of the hold, are Blast Radius's, by Claude Code DevRel
at Anthropic, in
[claude-code-playground](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius)
(Apache-2.0). The code here is this repo's own, written after reading theirs;
see `ACKNOWLEDGEMENTS.md`. The reason it lives in this mod and not beside it:
Blast Radius draws its report in the band when the terminal is too narrow for
a pane, and its README says the band is one mod's at a time. This mod is that
mod. Inside it, there is nothing to fight for.

Three tests stand in for the engine beneath: Bash answered by a recorder,
processes by a script, the hold loop's sleeps by waits on the mock clock, so
each `advance` is one turn of the loop. One holds `rm -rf build`, checks the
report and that the budget row stayed, presses refuse and reads the deny. One
lets `ls` through untouched, then holds `cd sub && git push --force origin
main`, checks the measuring ran in `sub` against `main..origin/main`, presses
run and sees Bash called. One has the guard off and sees `git reset --hard` go
straight through.

## What goes where

`/sl-settings` draws one row per item. Its key moves that item on: line 1, 2, 3,
4, off, and round again. One key per item and no cursor to lose. Under the
items sit `reset (t)`, an on/off for the resets after the `5h` and `7d` bars,
`guard (a)`, the on/off for the hold above, and `cold gate (k)`, the on/off for
the ask below; the effort control sits at the bottom of the same pane.

The layout is stored in `$.store`, so it is per machine and outlives the
session.

Two rules the pane obeys:

- An item switched **on** whose data is missing draws nothing. An empty bar
  reads as "nothing spent yet", which is the same green-because-it-was-attempted
  reading this repo keeps finding elsewhere.
- A line with nothing on it is dropped, not left as a gap.

### cache

The prompt cache lives an hour from the last request that touched it, and the
first request after that hour re-reads the whole transcript at the uncached
price — on a 330k-token session that is a few dollars for a two-line recap. So
the `cache` cell counts the hour down from the main loop's last request, which
`turn.step` sees go out and come back:

```
 cache ▰▰▰▰▰ 1h00m     just sent
 cache ▰▰▱▱▱ 15m       amber inside twenty minutes
 cache ▰▱▱▱▱ 4m        red inside ten
 cache cold            the hour has gone; the next request pays to re-warm
```

The bar drains, five segments of the hour left, rounded up like the quotas. The
colours here are the gauge's own — green, amber, red — because running out *is*
the trouble, unlike a reset, which is only a date. A subagent's requests do not
restart it: they are not the main transcript's cache. Nothing is drawn before
the first request, since there is no cache to time yet. On a narrow line the bar
drops and `cache 15m` stays. The countdown is johnnyvizz's idea, from
[session-band](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/session-band);
timing the hour from the last request is Karan Bansal's, from cache-tax.

One thing the cell cannot know: a session in usage overage drops to a
five-minute cache, and nothing tells a mod. The cell then reads warm for longer
than it is.

### cold gate

The cell says `cache cold`. With the gate on, that costs a keystroke:

```
 > fix the flaky test in band.test.ts                      ⏎

 sl-mod cold gate: the prompt cache has been cold for 23m, so this request
 re-reads about 142.0k tokens at the uncached price before it answers. Enter
 again sends it as it is; /clear starts a fresh window if this is a new task.

 ct ▰▰▰▱▱ 58%   cache cold · enter sends it   5h ▰▱▱▱▱ 9% ↻2h14m
 > fix the flaky test in band.test.ts                      ⏎  → sent
```

The first prompt typed after the hour has gone is dropped once, the draft is put
back in the box, and the next Enter sends it. Nothing is asked twice in one
cold spell, and a request clears the ask. The figure is the last response's
input, which is what the next request re-reads; it is in tokens and not
dollars, for the reason the next section gives.

What is never asked: a slash command, which is not a model request; a prompt
typed while a turn runs, which lands on a cache that turn is keeping warm; a
scheduled trigger, a peer session's message or a plugin's own prompt, which
have nobody at the keyboard to send them again; and a window under 50k tokens,
where the re-read is cents. A gate that breaks lets the prompt through, which is
the engine's default and the right one for a nudge about money. Compacting
first does not help: the compaction's own request re-reads the same transcript.

Asking once, the floor, and letting slash commands and unattended prompts by
are Karan Bansal's, from
[cache-tax](https://github.com/karanb192/cache-tax); the gate here is written
again without its price table, and off until `k` in `/sl-settings` turns it on.

`ch` — the hit rate — joins the same cell only under **70%**. Above that it
reads 98–100% and says nothing, and a permanent cell for a constant is spent
width. It is also the one figure here that reports the past: by the time it
drops, the money is gone. It is summed over the session rather than read off the
last response, which needs a dedup signal — `session.measure` naming `cost` in
`changed`, the engine's own word for "a priced response landed".

### input and output are tokens, not dollars

The engine hands a mod one money figure: the session total, `cost.usd`, with no
split between input and output. Turning tokens into dollars would mean a price
table in this file, and a price table in a file is a number that goes wrong
silently the day the prices change. So `i` and `o` are token counts and `$` is
the session total.

A lifetime total -- spend and tokens across every session, not just this one --
is out of reach entirely. It needs either the transcript scan this mod exists to
avoid, or `ccuc`, which is not on every machine.

### version

`⌂ 0.1.2` is the **open project's** version, not the engine's, read in this
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

## Install

This repo carries `.claude-plugin/marketplace.json`, so it **is** its own
marketplace. Two lines on any machine, and no path anywhere:

```bash
claude plugin marketplace add ducban/sl-mod
claude plugin install sl-mod@sl-mod
```

`"source": "."` in that manifest, because the plugin is the repo root. It lands
at scope **user**, which is what makes it global on the box rather than tied to
one project.

### Update

A machine that already has it picks up a new version in two lines — the first
re-clones the marketplace, the second swaps the installed copy:

```bash
claude plugin marketplace update sl-mod
claude plugin update sl-mod
```

It prints the version it moved between, e.g. `updated from 0.1.2 to 0.1.3`, and
then `Restart to apply changes`. That last part is literal: a session that is
already open keeps running the old copy until it is reopened, so after an
update, `/sl-debug` in an old session still describes the old code.

An earlier attempt put a `CLAUDE_CODE_PLUGIN_DIRS` export in the shell's
`.paths` instead. It was reverted: an absolute path in a per-machine shell file
is three path strings across this box, the Mac and the VPS, three things to go
stale, and the point of the mod was to stop depending on local wiring.

The repo is **public**, so `marketplace add` clones over plain HTTPS and no
machine needs GitHub auth for it — checked, not assumed: a clone with the
credential helper and the global git config both switched off succeeds. That
matters most for the VPS, which is headless and would otherwise need a device
flow or a token.

## Develop

An installed plugin runs a **copy** Claude Code made at install time. An edit in
this working copy reaches a session only through the full loop:

```bash
git push
claude plugin marketplace update sl-mod
claude plugin update sl-mod
# then /reload-plugins, or restart
```

While actually writing code, skip all of that and load the folder directly — one
flag on one command, nothing tracked:

```bash
claude --plugin-dir ~/Workspace/Projects/personal_works/sl-mod
```

The gate before a push:

```bash
claude plugin validate .
claude plugin test .
tsc -p .
```

`validate` prints `gating hook without .catch: ...` for the hooks that take the
chain. Those lines are not noise — one of them was on screen from the first
commit while an unguarded `$.process.run` in a gating hook took three probes
down, and it was read past every time.

## Commands

| | |
|---|---|
| `/sl` | hide or show the band |
| `/sl-settings` | what shows, on which line, the resets, and the effort choice |
| `/sl-help` | the legend: every item, how to read a gauge, the keys |
| `/sl-effort <level>` | set it outright, or `off` to stop overriding |
| `/sl-debug` | print what the engine reports, notes included |

`/sl-help` and `/sl-settings` are the two tabs. `/sl-debug` prints text.

## The statusLine it replaced

Two things held that slot before this mod, not one.

`reference/statusline-command.sh` is the first: 92 lines of bash Ban wrote by
hand, reading the engine's JSON on stdin with `jq`. Its shape is the shape of
this mod -- line one `folder | model | Ctx:%`, line two `5h` and `7d` with the
reset time and a countdown -- which is why it is kept here rather than thrown
away. It was the only copy; no repo on either machine tracked it, and it sat
unread in `~/.claude/` after the `statusLine` block went. It is archived, not
wired to anything: nothing in this mod reads it.

It also shows the cost the mod exists to remove. Every redraw forked `bash`,
then `jq` five times over, plus `awk` and `date` per field.

`claude-powerline` came after it and was removed from `~/.claude/settings.json`
on 2026-10-06, so the band is the only status line in the window now. To put
that one back, the block was:

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
