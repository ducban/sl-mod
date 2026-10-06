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
  arch   Opus ▮▮▯▯▯ (M)   main ●                                 ?
 ◔ ▰▰▱▱▱ 31%   ▰▱▱▱▱ 8%   ▰▰▱▱▱ 35%   ▰▰▱▱▱ 25%
```

Line one is identity, line two is budget, and the icons follow that split.
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

Both rows draw. Effort rotates with `4` and `5` from an empty prompt, `0` opens
the legend, and `/sl`, `/sl-help`, `/sl-effort` and `/sl-debug` work. Six tests
pass under `claude plugin test`.

## Run it

```bash
claude --plugin-dir ~/Workspace/Projects/personal_works/sl-mod
claude plugin validate ~/Workspace/Projects/personal_works/sl-mod
```
