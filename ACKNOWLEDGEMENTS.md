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

## This file

- The format, one line per contribution with a link to the person: Kurt Buhler
  ([@data-goblin](https://github.com/data-goblin)),
  [claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) `ACKNOWLEDGEMENTS.md`
