# Acknowledgements

Who this mod owes what. One line per debt: the thing, the person, the project,
the licence. A line goes in with the commit that takes the thing, not before.
Nothing here is copied code unless the line says so; the rest is an idea read in
someone else's repo and written again here.

## Inspiration

- The status line this mod replaced, the segment strip it keeps and the `✓`
  that means git-clean: Owloops, [claude-powerline](https://github.com/Owloops/claude-powerline), MIT
- The Tokyo Night Moon and Day palettes, carried over from that status line:
  folke, [tokyonight.nvim](https://github.com/folke/tokyonight.nvim), Apache-2.0,
  after Enkia's [Tokyo Night](https://github.com/enkia/tokyo-night-vscode-theme), MIT.
  Colour values only; no code

## Ideas borrowed, written again here

- A compaction read off `turn.step`: a main-loop request carrying fewer than
  half the messages of the one before is the first after a compaction.
  Karan Bansal ([@karanb192](https://github.com/karanb192)),
  [cache-tax](https://github.com/karanb192/cache-tax) `hooks/register.ts`, MIT
  (sl-mod 0.1.9)
- The prompt cache's hour counted down in the band, with amber and red steps as
  it runs out: johnnyvizz ([@JohnnyVizz](https://github.com/JohnnyVizz)),
  [session-band](https://github.com/JohnnyVizz/claude-kit/tree/main/plugins/session-band)
  `hooks/register.tsx`, MIT (sl-mod 0.1.10)
- The hour measured from the last request, and `cold` as the word for a cache
  that has gone: Karan Bansal, cache-tax, MIT (sl-mod 0.1.10)
- Holding a risky Bash call until a button is pressed, measuring what it would
  destroy and drawing that in the band with run and refuse; the hold as a loop
  of short sleeps through `$.process.run`, since a hook's own time is ten
  seconds and time inside a `$` call is not its own; the refusal worded so the
  model does not retry: Claude Code DevRel, Anthropic PBC,
  [blast-radius](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/blast-radius)
  in claude-code-playground, Apache-2.0. Idea and shape only; the classifier,
  the measuring scripts and the drawing here were written in this repo after
  reading theirs, and no code was copied, so no NOTICE is owed (sl-mod 0.1.11)
- Dropping the first prompt after a cold hour once, with what the re-read
  costs, and sending it on the next Enter; asking once per cold spell, a floor
  under which the gate stays quiet, and letting a slash command and a prompt
  nobody typed through: Karan Bansal, cache-tax `hooks/register.ts`, MIT.
  Written again here without its price table, in tokens (sl-mod 0.1.12)

## This file

- The format, one line per contribution with a link to the person: Kurt Buhler
  ([@data-goblin](https://github.com/data-goblin)),
  [claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) `ACKNOWLEDGEMENTS.md`
