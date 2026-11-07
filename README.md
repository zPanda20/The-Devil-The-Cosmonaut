# The Devil & The Cosmonaut

Card games and puzzles at one table, played in the browser on phone (including folding screens) or laptop.

**The Devil (card games)**
- **Devil's Grip** — two-pack solitaire (aces out). Build 2-5-8-J, 3-6-9-Q and 4-7-10-K up three rows of eight.
- **Klondike** — draw 1 or 3, tap-to-move or drag, optional winnable-only deals (seeds solved offline).
- **Pyramid** — clear the pyramid in pairs that add up to 13.
- **Hearts** — you against three computer players; passing, moon shots, first to 100.
- **Spades** — you and a computer partner against two; bidding, nil, bags, first to 500.

**The Cosmonaut (puzzles)**
- **Cosmonaut Sudoku** — Star Battle / Queens. 330 levels from 5×5 to 12×12, three lives per level, and a daily mission.
- **2048** — tiles in the deck's colours; the 2048 tile turns into the deck's King.

Ten card decks theme the whole app. Every game pays into one shared points total, and decks unlock at point thresholds (Hellfire Pulp is the starter).

## Play

Open `docs/index.html` in a browser, or turn on GitHub Pages (Settings → Pages → Deploy from branch → `main` / `docs`).
Progress is saved in the browser's local storage, so it stays on the device you play on.

## Layout

| Path | What it is |
|---|---|
| `src/home.html`, `src/grip.html`, `src/cosmo.html` | Page markup and styles (home, Devil's Grip, Cosmonaut Sudoku) |
| `src/pages/*.html`, `src/ui.css` | Pages for the newer games and their shared chrome (inlined at build) |
| `src/table.js`, `src/tricks.js` | Shared helpers for the newer games; trick-taking table and rules helpers |
| `src/klondike.js`, `src/pyramid.js`, `src/2048.js`, `src/hearts.js`, `src/spades.js` | The newer games (Hearts and Spades keep a pure, seat-based rules core for future multiplayer) |
| `src/klondike-deals.js` | Winnable Klondike seeds from `tools/klondike-solver.js` |
| `src/app.js` | Shared layer: equipped deck, points bank and deck unlocks, on-demand deck art, daily mission |
| `src/grip.js` | Devil's Grip rules, layout and UI |
| `src/cosmo.js` | Cosmonaut Sudoku play, scoring, level map and daily mode |
| `src/engine.js` | Card engine: draws every card, back and token for all ten deck styles |
| `src/art-*.js` | Embedded face-card and suit artwork per deck |
| `src/levels.js` | Level pack (generated from `tools/levels.json`) |
| `tools/` | Star Battle generator, pack builder and verifier (Node) |
| `assets/` | Processed artwork source images |
| `docs/` | Built, playable site |

## Build

```sh
./build.sh            # writes docs/ (site) and dist/ (claude.ai artifact copy)
```

Regenerate or check the puzzles (from `tools/`):

```sh
node build-packs.js   # writes levels.json (takes a few minutes)
node verify.js        # checks every level is valid, unique and solvable by deduction
```

## Adding a deck's artwork

Register images for a deck in a new `src/art-<deck>.js`:

```js
CardEngine.registerAssets('deck-id', {
  blend: 'multiply',              // 'multiply' for art on light paper (emblems as transparent PNGs); 'normal' for pre-blended dark art
  faces: { K: { red: 'data:…', black: 'data:…' }, Q: {…}, J: {…} },
  suits: { S: 'data:…', H: 'data:…', C: 'data:…', D: 'data:…' }
});
```

Then add its `<script>` line to `COMMON` in `build.sh`.
