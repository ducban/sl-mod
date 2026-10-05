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

Line two is built by walking `$.session.usage().rateLimits` rather than asking
for two windows by name. The documented kinds are `five_hour`, `seven_day` and
`spend_limit`, but the 2.1.289 binary carries nine, and `/usage` shows a
per-model week — so a hardcoded pair would have dropped the Fable window, the
one segment this was asked for.

## State

Step 1 only: `/sl-debug` prints what the engine reports, and nothing is drawn
yet. It exists because no static source says whether `rateLimits` carries the
per-model windows or under what `kind`.

## Run it

```bash
claude --plugin-dir ~/Workspace/Projects/personal_works/sl-mod
claude plugin validate ~/Workspace/Projects/personal_works/sl-mod
```
