# The Devil & The Cosmonaut

Two games at one table, played in the browser on phone (including folding screens) or laptop.

- **Devil's Grip** — two-pack solitaire (aces out). Build 2-5-8-J, 3-6-9-Q and 4-7-10-K up three rows of eight and finish with as few cards left as you can.
- **Cosmonaut Sudoku** — Star Battle / Queens. Place one token (two in the Binary Stars levels) in every row, column and region, never touching. 330 levels from 5×5 to 12×12, three lives per level, and a daily mission.

Ten card decks theme the whole app. Hellfire Pulp is the starter; the rest unlock through either game or a daily streak.

## Play

Open `docs/index.html` in a browser, or turn on GitHub Pages (Settings → Pages → Deploy from branch → `main` / `docs`).
Progress is saved in the browser's local storage, so it stays on the device you play on.

## Layout

| Path | What it is |
|---|---|
| `src/home.html`, `src/grip.html`, `src/cosmo.html` | Page markup and styles (home, Devil's Grip, Cosmonaut Sudoku) |
| `src/app.js` | Shared layer: equipped deck, unlock ladder, daily mission and streaks |
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
./build.sh            # writes docs/
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
