/*
 * Card Engine v1 — playing-card renderer for the Devil's Grip app
 * ----------------------------------------------------------------
 * One engine draws every deck. A style only supplies colours, fonts,
 * face-card art (J, Q, K) and a card back; the engine lays out the
 * number cards (A–10), the corner indices, scaling and a compact
 * phone-size layout for every style automatically.
 *
 * USAGE
 *   CardEngine.renderCard({ rank: '9', suit: 'D' }, 'void-ink', { width: 100 })  -> HTML string
 *   CardEngine.renderBack('void-ink', { width: 100 })                             -> HTML string
 *   CardEngine.makeDeck({ decks: 2, aces: false })                                -> card objects
 *   CardEngine.shuffle(cards)                                                     -> same array, shuffled
 *   CardEngine.peek('void-ink', width)  -> px of a card to show when cards overlap in a pile
 *   CardEngine.getStyle(id).theme       -> app colour + font tokens that match the deck
 *   CardEngine.listStyles()             -> [{ id, name }] for every registered deck
 *   CardEngine.loadFonts(id)            -> adds the deck's Google Fonts to the page once
 *   CardEngine.registerAssets(id, art)  -> swaps in finished artwork (face cards and suit emblems);
 *                                          anything not supplied keeps the drawn version.
 *                                          See void-ink-assets.js for the shape.
 *
 * DECKS INCLUDED: void-ink, hellfire-pulp, neon-riot, signal-orange, ultraviolet-rite,
 *   glitch-runner, blood-moon, carcosa-yellow, toxic-halftone, lilac-pixel
 *
 * Cards are drawn on a 140 x 200 design grid and scaled to the requested
 * width. Below `compactBelow` px wide (default 64) a card switches to a
 * compact layout (big index, single pip) so it stays readable on phones.
 *
 * ADDING A NEW STYLE — copy the Void Ink block at the bottom and change:
 *   id, name, fontsHref     Google Fonts link for the style's faces
 *   fonts.rank              CSS font stack for corner ranks (+ optional rankWeight)
 *   card                    bg, radius, border (px), borderColor ('ink' = suit colour),
 *                           shadow, extra CSS, decor(c) for art behind every card
 *   backCard                bg, radius, border, borderColor, shadow, extra for the back
 *   compactBelow            width (px) under which the compact phone layout is used (default 64)
 *   corner                  x, y offsets, rankSize / glyphSize (px on the 140 grid), gap
 *   pip, pipLarge           pip font sizes (pipLarge is used on 2s and 3s)
 *   suits.red / suits.black colour sets; every key you add (ink, wash, alt, ...)
 *                           is available to the face art as c.<key>
 *   faces.J / Q / K         functions (c) => SVG/HTML on the 140 x 200 grid
 *                           c = { rank, suit, glyph, ink, ...suit colour set }
 *   back                    function () => SVG/HTML on the 140 x 200 grid
 *   theme                   tokens the app uses when this deck is equipped:
 *                           scheme ('dark' | 'light'), table, surface, line, text, muted,
 *                           accent, accentText, warn, display / ui / body font stacks,
 *                           displaySize, uiSize, bodySize, regionTint (puzzle region colours)
 */
(function (root) {
  'use strict';

  var BASE_W = 140, BASE_H = 200;
  var RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var VALUE = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };
  var RANK_NAME = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };
  var SUITS = {
    S: { glyph: '♠︎', color: 'black', name: 'spades' },
    H: { glyph: '♥︎', color: 'red', name: 'hearts' },
    C: { glyph: '♣︎', color: 'black', name: 'clubs' },
    D: { glyph: '♦︎', color: 'red', name: 'diamonds' }
  };

  // Pip layouts: [column, height fraction]. Columns are fractions of the inner width.
  var COLS = { L: 0.32, C: 0.5, R: 0.68 };
  var LAYOUTS = {
    1: [['C', 0.5]],
    2: [['C', 0.2], ['C', 0.8]],
    3: [['C', 0.2], ['C', 0.5], ['C', 0.8]],
    4: [['L', 0.2], ['R', 0.2], ['L', 0.8], ['R', 0.8]],
    5: [['L', 0.2], ['R', 0.2], ['C', 0.5], ['L', 0.8], ['R', 0.8]],
    6: [['L', 0.2], ['R', 0.2], ['L', 0.5], ['R', 0.5], ['L', 0.8], ['R', 0.8]],
    7: [['L', 0.2], ['R', 0.2], ['C', 0.35], ['L', 0.5], ['R', 0.5], ['L', 0.8], ['R', 0.8]],
    8: [['L', 0.2], ['R', 0.2], ['C', 0.35], ['L', 0.5], ['R', 0.5], ['C', 0.65], ['L', 0.8], ['R', 0.8]],
    9: [['L', 0.2], ['R', 0.2], ['L', 0.4], ['R', 0.4], ['C', 0.5], ['L', 0.6], ['R', 0.6], ['L', 0.8], ['R', 0.8]],
    10: [['L', 0.2], ['R', 0.2], ['C', 0.3], ['L', 0.4], ['R', 0.4], ['L', 0.6], ['R', 0.6], ['C', 0.7], ['L', 0.8], ['R', 0.8]]
  };

  var styles = {};

  function registerStyle(def) { styles[def.id] = def; return def; }

  // Optional artwork for a deck, replacing the drawn art where present:
  // { faces: { K: { red: url, black: url }, Q: {...}, J: {...} }, suits: { S: url, H: url, C: url, D: url } }
  // Images are drawn with multiply blending, so pure-white paper in the art takes on the card colour.
  function registerAssets(id, assets) { getStyle(id).assets = shorten(assets); }

  // In a browser, turn embedded data: images into short blob: links once, so every card redraw stays light.
  function shorten(node) {
    if (typeof node === 'string') {
      if (node.indexOf('data:') !== 0 || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return node;
      try {
        var comma = node.indexOf(','), mime = node.slice(5, node.indexOf(';')), bin = atob(node.slice(comma + 1));
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
      } catch (e) { return node; }
    }
    var out = {};
    for (var k in node) out[k] = shorten(node[k]);
    return out;
  }

  // Light paper art multiplies into the card; art on a black ground (dark decks) uses screen instead.
  function blendOf(s) { return (s.assets && s.assets.blend) || 'multiply'; }
  function suitArt(s, suit, px, extra) {
    var url = s.assets && s.assets.suits && s.assets.suits[suit];
    if (!url) return null;
    return '<img src="' + url + '" alt="" draggable="false" style="display:block;width:' + px + 'px;height:' + px + 'px;mix-blend-mode:' + blendOf(s) + ';' + (extra || '') + '">';
  }
  function faceArt(s, rank, suit) {
    var f = s.assets && s.assets.faces && s.assets.faces[rank];
    var url = f && f[SUITS[suit].color];
    if (!url) return null;
    return '<img src="' + url + '" alt="" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;mix-blend-mode:' + blendOf(s) + '">';
  }
  function getStyle(id) {
    var s = styles[id];
    if (!s) throw new Error('Unknown card style: ' + id);
    return s;
  }
  function listStyles() { return Object.keys(styles).map(function (k) { return { id: k, name: styles[k].name }; }); }

  function makeDeck(opts) {
    opts = opts || {};
    var decks = opts.decks || 1, aces = opts.aces !== false;
    var ranks = aces ? ['A'].concat(RANKS) : RANKS.slice();
    var out = [];
    for (var d = 0; d < decks; d++) {
      ['S', 'H', 'C', 'D'].forEach(function (suit) {
        ranks.forEach(function (rank) {
          out.push({ id: rank + suit + '-' + d, rank: rank, suit: suit, value: VALUE[rank] });
        });
      });
    }
    return out;
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function cardName(card) {
    return (RANK_NAME[card.rank] || card.rank) + ' of ' + SUITS[card.suit].name;
  }

  function heightFor(width) { return Math.round(width * BASE_H / BASE_W); }
  function isCompact(s, width) { return width < (s.compactBelow || 64); }

  function peek(styleId, width) {
    var s = getStyle(styleId);
    var h = heightFor(width);
    return isCompact(s, width) ? Math.round(width * 0.38 + 3) : Math.round(h * 0.17);
  }

  function colourSet(s, card) {
    var suit = SUITS[card.suit];
    var pal = s.suits[suit.color] || {};
    var c = { rank: card.rank, suit: card.suit, glyph: suit.glyph };
    for (var k in pal) c[k] = pal[k];
    return c;
  }

  // borderColor 'ink' means the border takes the suit colour.
  function borderColour(s, ink) { return s.card.borderColor === 'ink' ? ink : s.card.borderColor; }

  function cardFrame(s, width, inner, ink) {
    var h = heightFor(width), k = width / BASE_W, b = s.card.border || 0;
    var outerRadius = (s.card.radius || 0) * k;
    return '<div class="ce-card" style="position:relative;width:' + width + 'px;height:' + h + 'px;flex:none;border-radius:' + outerRadius.toFixed(1) + 'px">' +
      '<div style="position:absolute;left:0;top:0;width:' + BASE_W + 'px;height:' + BASE_H + 'px;transform:scale(' + k.toFixed(4) + ');transform-origin:0 0;box-sizing:border-box;overflow:hidden;' +
      'border-radius:' + (s.card.radius || 0) + 'px;background:' + s.card.bg + ';' +
      (b ? 'border:' + b + 'px solid ' + borderColour(s, ink) + ';' : '') +
      (s.card.shadow ? 'box-shadow:' + s.card.shadow + ';' : '') +
      (s.card.extra || '') + ';color:' + ink + '">' + inner + '</div></div>';
  }

  // On picture cards with full-bleed art the index sits on a small chip of card colour so it stays readable.
  function corner(s, card, glyph, flipped, chip) {
    var f = s.fonts, dx = chip ? 3 : 0;
    return '<div style="position:absolute;' + (flipped ? 'bottom' : 'top') + ':' + (s.corner.y - dx) + 'px;' + (flipped ? 'right' : 'left') + ':' + (s.corner.x - dx) + 'px;' +
      (chip ? 'background:' + s.card.bg + ';padding:' + dx + 'px;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.25);' : '') +
      'display:flex;flex-direction:column;align-items:center;gap:' + (s.corner.gap || 0) + 'px;line-height:1;font-family:' + f.rank + ';' +
      (f.rankWeight ? 'font-weight:' + f.rankWeight + ';' : '') + (flipped ? 'transform:rotate(180deg);' : '') + '">' +
      '<span style="font-size:' + s.corner.rankSize + 'px">' + card.rank + '</span>' +
      (suitArt(s, card.suit, Math.round(s.corner.glyphSize * 0.95), 'margin-top:2px') ||
        '<span style="font-size:' + s.corner.glyphSize + 'px">' + glyph + '</span>') + '</div>';
  }

  function pips(s, card, glyph) {
    var b = s.card.border || 0, iw = BASE_W - 2 * b, ih = BASE_H - 2 * b;
    var v = VALUE[card.rank];
    var size = v === 1 ? (s.pipAce || 64) : v <= 3 ? (s.pipLarge || 38) : (s.pip || 30);
    var art = suitArt(s, card.suit, Math.round(size * 0.82));
    return LAYOUTS[v].map(function (p) {
      var x = COLS[p[0]] * iw, y = p[1] * ih, flip = p[1] > 0.5;
      return '<span style="position:absolute;left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;' +
        'transform:translate(-50%,-50%)' + (flip ? ' rotate(180deg)' : '') + ';font-size:' + size + 'px;line-height:1">' + (art || glyph) + '</span>';
    }).join('');
  }

  function compactCard(s, card, c, width) {
    var h = heightFor(width), k = width / BASE_W, b = s.card.border || 0;
    var face = VALUE[card.rank] > 10;
    return '<div class="ce-card ce-compact" style="position:relative;width:' + width + 'px;height:' + h + 'px;flex:none;box-sizing:border-box;overflow:hidden;' +
      'border-radius:' + ((s.card.radius || 0) * k).toFixed(1) + 'px;background:' + s.card.bg + ';' +
      (b ? 'border:' + Math.max(1, Math.round(b * k * 1.5)) + 'px solid ' + borderColour(s, c.ink) + ';' : '') +
      'color:' + c.ink + ';font-family:' + s.fonts.rank + ';' + (s.fonts.rankWeight ? 'font-weight:' + s.fonts.rankWeight + ';' : '') + 'line-height:1">' +
      '<div style="position:absolute;left:' + Math.round(width * 0.08) + 'px;top:' + Math.round(width * 0.04) + 'px;display:flex;align-items:baseline;gap:1px">' +
      '<span style="font-size:' + Math.round(width * (card.rank.length > 1 ? 0.28 : 0.34)) + 'px">' + card.rank + '</span>' +
      (suitArt(s, card.suit, Math.round(width * 0.24), 'align-self:center') ||
        '<span style="font-size:' + Math.round(width * 0.28) + 'px">' + c.glyph + '</span>') + '</div>' +
      (face && faceArt(s, card.rank, card.suit)
        ? '<div style="position:absolute;left:0;right:0;bottom:0;height:64%;overflow:hidden">' +
          faceArt(s, card.rank, card.suit).replace('object-fit:cover', 'object-fit:cover;object-position:50% 46%;transform:scale(1.5)') + '</div></div>'
        : (face && c.wash ? '<div style="position:absolute;left:12%;right:12%;bottom:10%;height:34%;border-radius:3px;background:' + c.wash + '"></div>' : '') +
          '<div style="position:absolute;left:0;right:0;bottom:' + Math.round(h * 0.1) + 'px;display:flex;justify-content:center;text-align:center;font-size:' + Math.round(width * (face ? 0.42 : 0.5)) + 'px">' +
          (face ? card.rank : (suitArt(s, card.suit, Math.round(width * 0.44)) || c.glyph)) + '</div></div>');
  }

  function renderCard(card, styleId, opts) {
    opts = opts || {};
    var s = getStyle(styleId);
    var width = opts.width || BASE_W;
    var c = colourSet(s, card);
    if (isCompact(s, width)) return compactCard(s, card, c, width);
    var v = VALUE[card.rank], body;
    if (v <= 10) body = pips(s, card, c.glyph);
    else if (faceArt(s, card.rank, card.suit)) body = faceArt(s, card.rank, card.suit);
    else if (s.faces && s.faces[card.rank]) body = s.faces[card.rank](c);
    else body = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:' + s.fonts.rank + ';font-size:96px">' + card.rank + '</div>';
    var decor = s.card.decor ? s.card.decor(c) : '';
    var chip = v > 10 && !!faceArt(s, card.rank, card.suit);
    return cardFrame(s, width, decor + body + corner(s, card, c.glyph, false, chip) + corner(s, card, c.glyph, true, chip), c.ink);
  }

  function renderBack(styleId, opts) {
    opts = opts || {};
    var s = getStyle(styleId);
    var width = opts.width || BASE_W, h = heightFor(width), k = width / BASE_W;
    var back = s.backCard || s.card;
    return '<div class="ce-card ce-back" style="position:relative;width:' + width + 'px;height:' + h + 'px;flex:none;border-radius:' + ((back.radius || 0) * k).toFixed(1) + 'px">' +
      '<div style="position:absolute;left:0;top:0;width:' + BASE_W + 'px;height:' + BASE_H + 'px;transform:scale(' + k.toFixed(4) + ');transform-origin:0 0;box-sizing:border-box;overflow:hidden;' +
      'border-radius:' + (back.radius || 0) + 'px;background:' + back.bg + ';' +
      (back.border ? 'border:' + back.border + 'px solid ' + back.borderColor + ';' : '') +
      (back.shadow ? 'box-shadow:' + back.shadow + ';' : '') + (back.extra || '') + '">' + s.back() + '</div></div>';
  }

  // Round token cut from a face card's art (for puzzle markers). rank 'K' | 'Q' | 'J'.
  function renderToken(styleId, rank, suit, size) {
    var s = getStyle(styleId);
    var c = colourSet(s, { rank: rank, suit: suit });
    var art = faceArt(s, rank, suit) || (s.faces && s.faces[rank] ? s.faces[rank](c) : '');
    var k = size / 104;
    var ring = s.token && s.token.ring ? s.token.ring : c.ink;
    return '<span class="ce-token" style="position:relative;display:block;width:' + size + 'px;height:' + size + 'px;border-radius:50%;overflow:hidden;' +
      'background:' + s.card.bg + ';box-shadow:0 0 0 ' + Math.max(1.5, size * 0.05).toFixed(1) + 'px ' + ring + ' inset">' +
      '<span style="position:absolute;left:' + (size / 2 - 70 * k).toFixed(2) + 'px;top:' + (size / 2 - 104 * k).toFixed(2) + 'px;width:' + BASE_W + 'px;height:' + BASE_H + 'px;' +
      'transform:scale(' + k.toFixed(4) + ');transform-origin:0 0;color:' + c.ink + ';' + (s.card.extra || '') + '">' + art + '</span></span>';
  }

  // Distinct region tints for an n-region puzzle grid, in the deck's mood.
  // theme.regionTint = { s: saturation %, l: lightness %, h0: starting hue, ink: mark colour, line: border colour }
  function regionColours(styleId, n) {
    var t = getStyle(styleId).theme.regionTint || { s: 40, l: 80, h0: 0 };
    var out = [], step = 360 / n, jump = n % 5 === 0 ? 3 : 5;
    for (var i = 0; i < n; i++) {
      var slot = (i * jump) % n;
      var h = Math.round((t.h0 || 0) + slot * step) % 360;
      var l = t.l + (i % 2 ? -5 : 5);
      out.push('hsl(' + h + ' ' + t.s + '% ' + l + '%)');
    }
    return out;
  }

  // Load a style's Google Fonts once (browser only).
  function loadFonts(styleId) {
    var s = getStyle(styleId);
    if (typeof document === 'undefined' || !s.fontsHref) return;
    if (document.querySelector('link[data-ce-fonts="' + styleId + '"]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = s.fontsHref; l.setAttribute('data-ce-fonts', styleId);
    document.head.appendChild(l);
  }

  /* ================================================================
   * STYLE 01 · VOID INK
   * Monochrome brush-and-wash. Red suits print as grey smoke.
   * ================================================================ */
  var SKULL = function (fill, hole) {
    return '<path d="M50 12 C28 12 16 28 16 46 C16 58 22 66 30 70 L30 82 L70 82 L70 70 C78 66 84 58 84 46 C84 28 72 12 50 12 Z" fill="' + fill + '"></path>' +
      '<circle cx="37" cy="48" r="9" fill="' + hole + '"></circle><circle cx="63" cy="48" r="9" fill="' + hole + '"></circle>' +
      '<path d="M50 58 L45 67 L55 67 Z" fill="' + hole + '"></path>' +
      '<path d="M40 72 L40 82 M50 72 L50 82 M60 72 L60 82" stroke="' + hole + '" stroke-width="2.5"></path>';
  };

  registerStyle({
    id: 'void-ink',
    name: 'Void Ink',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;600&display=swap',
    fonts: { rank: "'Bebas Neue', Oswald, Impact, 'Arial Narrow', sans-serif" },
    card: { bg: '#F2F0EA', radius: 10, border: 0 },
    backCard: { bg: '#0B0B0B', radius: 10, border: 1, borderColor: '#3A3A38' },
    corner: { x: 9, y: 7, rankSize: 24, glyphSize: 19 },
    pip: 30,
    pipLarge: 38,
    suits: {
      black: { ink: '#111111', wash: '#D9D7D0' },
      red: { ink: '#6E6E6A', wash: '#B9B7B0' }
    },
    faces: {
      K: function (c) {
        return '<svg viewBox="0 0 120 140" width="100" height="117" style="position:absolute;left:20px;top:42px" aria-hidden="true">' +
          '<circle cx="60" cy="64" r="48" fill="none" stroke="' + c.wash + '" stroke-width="13"></circle>' +
          '<circle cx="60" cy="64" r="48" fill="none" stroke="' + c.ink + '" stroke-width="2.5"></circle>' +
          '<path d="M42 16 L44 2 L52 10 L60 0 L68 10 L76 2 L78 16 Z" fill="' + c.ink + '"></path>' +
          '<ellipse cx="60" cy="66" rx="34" ry="38" fill="#E4E2DB"></ellipse>' +
          '<g transform="translate(31 33) scale(0.58)">' + SKULL(c.ink, '#E4E2DB') + '</g>' +
          '<g stroke="' + c.ink + '" stroke-width="1.3" stroke-linecap="round"><path d="M60 54 L24 34 M60 54 L96 30 M60 54 L18 72 M60 54 L102 80 M60 54 L84 108 M60 54 L32 102"></path></g>' +
          '<path d="M48 106 L46 132 M58 110 L58 138 M70 106 L72 124" stroke="' + c.ink + '" stroke-width="4" stroke-linecap="round"></path>' +
          '<g fill="' + c.ink + '"><circle cx="18" cy="122" r="2.5"></circle><circle cx="98" cy="124" r="3"></circle><circle cx="86" cy="136" r="1.6"></circle></g>' +
          '</svg>';
      },
      Q: function (c) {
        return '<svg viewBox="0 0 120 140" width="100" height="117" style="position:absolute;left:20px;top:42px" aria-hidden="true">' +
          '<circle cx="60" cy="64" r="48" fill="none" stroke="' + c.wash + '" stroke-width="13"></circle>' +
          '<circle cx="60" cy="64" r="48" fill="none" stroke="' + c.ink + '" stroke-width="2.5"></circle>' +
          '<path d="M36 14 L42 4 L48 12 L60 0 L72 12 L78 4 L84 14" fill="none" stroke="' + c.ink + '" stroke-width="3" stroke-linejoin="round"></path>' +
          '<ellipse cx="60" cy="66" rx="34" ry="38" fill="#E4E2DB"></ellipse>' +
          '<path d="M60 40 A26 26 0 0 0 60 92 A30 30 0 0 1 60 40 Z" fill="' + c.ink + '"></path>' +
          '<path d="M68 56 L74 60 M76 74 L80 76" stroke="' + c.wash + '" stroke-width="3" stroke-linecap="round"></path>' +
          '<g fill="' + c.ink + '"><circle cx="78" cy="48" r="1.8"></circle><circle cx="84" cy="86" r="1.4"></circle><circle cx="70" cy="96" r="1.2"></circle><circle cx="88" cy="66" r="1"></circle></g>' +
          '<path d="M62 106 L62 130 M70 104 L71 118" stroke="' + c.ink + '" stroke-width="4" stroke-linecap="round"></path>' +
          '<g fill="' + c.ink + '"><circle cx="22" cy="118" r="2"></circle><circle cx="100" cy="114" r="2.5"></circle><circle cx="62" cy="137" r="2"></circle></g>' +
          '</svg>';
      },
      J: function (c) {
        return '<svg viewBox="0 0 140 200" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<path d="M44 56 C60 40 94 44 100 68 C106 92 86 120 72 134 C62 145 48 156 39 151 C31 146 41 135 49 127 C31 119 26 76 44 56 Z" fill="' + c.wash + '" opacity="0.75"></path>' +
          '<text x="72" y="152" text-anchor="middle" font-family="Bebas Neue, Oswald, Impact, sans-serif" font-size="130" fill="' + c.ink + '">J</text>' +
          '<g fill="' + c.ink + '"><circle cx="30" cy="58" r="2.5"></circle><circle cx="110" cy="138" r="3.2"></circle><circle cx="104" cy="154" r="1.6"></circle><circle cx="116" cy="48" r="1.6"></circle></g>' +
          '<path d="M66 156 L65 174" stroke="' + c.ink + '" stroke-width="3.5" stroke-linecap="round"></path>' +
          '</svg>';
      }
    },
    back: function () {
      return '<svg viewBox="0 0 180 260" width="138" height="198" style="position:absolute;left:0;top:0" aria-hidden="true">' +
        '<rect x="10" y="10" width="158" height="238" rx="6" fill="none" stroke="#F2F0EA" stroke-width="1" opacity="0.4"></rect>' +
        '<circle cx="89" cy="124" r="52" fill="none" stroke="#F2F0EA" stroke-width="12" opacity="0.9"></circle>' +
        '<circle cx="89" cy="124" r="38" fill="#B9B7B0" opacity="0.25"></circle>' +
        '<g stroke="#F2F0EA" stroke-width="1.2"><path d="M89 124 L60 90 M89 124 L122 96 M89 124 L58 150 M89 124 L118 160 M89 124 L89 80"></path></g>' +
        '<path d="M80 176 L78 206 M92 178 L92 220 M102 176 L104 196" stroke="#F2F0EA" stroke-width="4" stroke-linecap="round"></path>' +
        '<g fill="#F2F0EA"><circle cx="40" cy="200" r="2"></circle><circle cx="140" cy="60" r="2.5"></circle><circle cx="132" cy="214" r="1.6"></circle></g>' +
        '</svg>' +
        '<span style="position:absolute;left:0;right:0;bottom:14px;text-align:center;font-family:\'Bebas Neue\',Oswald,Impact,sans-serif;font-size:14px;letter-spacing:4px;color:#F2F0EA">DEVIL\'S GRIP</span>';
    },
    theme: {
      scheme: 'dark',
      table: '#0B0B0B', surface: '#161615', line: '#2E2E2B', text: '#F2F0EA', muted: '#A9A7A0',
      accent: '#F2F0EA', accentText: '#0B0B0B', warn: '#8F8D87',
      display: "'Bebas Neue', Oswald, Impact, 'Arial Narrow', sans-serif",
      ui: "'Bebas Neue', Oswald, Impact, 'Arial Narrow', sans-serif",
      body: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace",
      displaySize: 'clamp(42px, 7vw, 68px)', uiSize: '20px', bodySize: '14px',
      regionTint: { s: 14, l: 80, h0: 30, ink: '#111111', line: '#0B0B0B' }
    }
  });

  /* ================================================================
   * Shared art helpers for the styles below
   * ================================================================ */
  var SKULL_PATH = 'M50 12 C28 12 16 28 16 46 C16 58 22 66 30 70 L30 82 L70 82 L70 70 C78 66 84 58 84 46 C84 28 72 12 50 12 Z';
  function skullFace(hole, eye) {
    return '<circle cx="37" cy="48" r="9" fill="' + (eye || hole) + '"></circle><circle cx="63" cy="48" r="9" fill="' + hole + '"></circle>' +
      '<path d="M50 58 L45 67 L55 67 Z" fill="' + hole + '"></path>' +
      '<path d="M40 72 L40 82 M50 72 L50 82 M60 72 L60 82" stroke="' + hole + '" stroke-width="2.5"></path>';
  }
  function bigLetter(font, size, colour, extra) {
    return '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:' + font + ';font-size:' + size + 'px;line-height:1;color:' + colour + ';' + (extra || '') + '">J</div>';
  }
  function caption(font, size, colour, text, pos) {
    return '<span style="position:absolute;left:0;right:0;' + pos + ';text-align:center;font-family:' + font + ';font-size:' + size + 'px;letter-spacing:2px;color:' + colour + '">' + text + '</span>';
  }

  /* ================================================================
   * STYLE 02 · HELLFIRE PULP
   * Crimson halftone on bone stock, blackletter royalty.
   * ================================================================ */
  var HF_FONT = "'UnifrakturMaguntia', 'Old English Text MT', serif";
  var HF_QUIPS = { S: 'THIS ONE LIES', H: 'NEVER TRUST HIM', C: 'BURN THE EVIDENCE', D: 'HE OWES YOU MONEY' };
  function hfPanel(c) {
    return '<div style="position:absolute;left:12px;right:12px;top:40px;bottom:40px;background-color:' + c.panel + ';background-image:radial-gradient(' + c.dots + ' 1.2px,transparent 1.5px);background-size:5px 5px"></div>';
  }
  registerStyle({
    id: 'hellfire-pulp',
    name: 'Hellfire Pulp',
    fontsHref: 'https://fonts.googleapis.com/css2?family=UnifrakturMaguntia&family=Oswald:wght@400;600&display=swap',
    fonts: { rank: HF_FONT },
    card: { bg: '#F1E6D2', radius: 8, border: 0 },
    backCard: { bg: '#D7263D', radius: 8, extra: 'background-image:radial-gradient(#8E0F1F 1.2px,transparent 1.5px);background-size:5px 5px;' },
    corner: { x: 9, y: 6, rankSize: 26, glyphSize: 19 },
    pip: 30, pipLarge: 38,
    suits: {
      red: { ink: '#C81F35', panel: '#D7263D', dots: '#8E0F1F', accent: '#0E0B0B', wash: '#E8A3A9' },
      black: { ink: '#0E0B0B', panel: '#0E0B0B', dots: '#8E0F1F', accent: '#D7263D', wash: '#D9CDB8' }
    },
    faces: {
      K: function (c) {
        return hfPanel(c) + '<svg viewBox="0 0 100 110" width="92" height="101" style="position:absolute;left:24px;top:48px" aria-hidden="true">' +
          '<path d="M22 30 L28 8 L38 22 L50 4 L62 22 L72 8 L78 30 Z" fill="' + c.accent + '"></path>' +
          '<rect x="22" y="28" width="56" height="5" fill="' + c.accent + '"></rect>' +
          '<g transform="translate(0 26)"><path d="' + SKULL_PATH + '" fill="#F1E6D2"></path>' + skullFace('#0E0B0B') +
          '<path d="M24 40 L30 44 M76 40 L70 44 M34 20 L40 26" stroke="#0E0B0B" stroke-width="1.2"></path></g></svg>';
      },
      Q: function (c) {
        return hfPanel(c) + '<svg viewBox="0 0 100 120" width="92" height="110" style="position:absolute;left:24px;top:44px" aria-hidden="true">' +
          '<path d="M18 50 C18 14 82 14 82 50 L92 116 L8 116 Z" fill="' + c.accent + '"></path>' +
          '<g fill="' + c.panel + '" opacity="0.7"><circle cx="30" cy="96" r="2"></circle><circle cx="40" cy="104" r="2"></circle><circle cx="60" cy="104" r="2"></circle><circle cx="70" cy="96" r="2"></circle><circle cx="20" cy="106" r="2"></circle><circle cx="80" cy="106" r="2"></circle></g>' +
          '<g fill="#F1E6D2"><circle cx="34" cy="16" r="2.5"></circle><circle cx="42" cy="11" r="2.5"></circle><circle cx="50" cy="9" r="3"></circle><circle cx="58" cy="11" r="2.5"></circle><circle cx="66" cy="16" r="2.5"></circle></g>' +
          '<g transform="translate(18 26) scale(0.64)"><path d="' + SKULL_PATH + '" fill="#F1E6D2"></path>' + skullFace('#0E0B0B') + '</g>' +
          '<circle cx="50" cy="94" r="9" fill="#F1E6D2"></circle>' +
          '<path d="M50 87 C44 90 46 98 50 96 C54 94 52 90 48 92" fill="none" stroke="#0E0B0B" stroke-width="1.6"></path>' +
          '<path d="M50 103 L50 116 M50 108 L56 104" stroke="#F1E6D2" stroke-width="2"></path></svg>';
      },
      J: function (c) {
        return bigLetter(HF_FONT, 124, '#0E0B0B') + caption("Oswald, 'Arial Narrow', sans-serif", 10, c.ink, HF_QUIPS[c.suit], 'bottom:40px');
      }
    },
    back: function () {
      return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
        '<g fill="#0E0B0B"><path d="M90 130 L84 0 L96 0 Z"></path><path d="M90 130 L84 260 L96 260 Z"></path><path d="M90 130 L0 124 L0 136 Z"></path><path d="M90 130 L180 124 L180 136 Z"></path><path d="M90 130 L6 30 L16 22 Z"></path><path d="M90 130 L174 30 L164 22 Z"></path><path d="M90 130 L6 230 L16 238 Z"></path><path d="M90 130 L174 230 L164 238 Z"></path></g>' +
        '<circle cx="90" cy="130" r="50" fill="#0E0B0B"></circle>' +
        '<rect x="9" y="9" width="162" height="242" rx="5" fill="none" stroke="#F1E6D2" stroke-width="1.5"></rect></svg>' +
        '<div style="position:absolute;left:0;right:0;top:71px;text-align:center;font-family:' + HF_FONT + ';font-size:56px;line-height:1;color:#D7263D">D</div>';
    },
    theme: {
      scheme: 'dark',
      table: '#0E0B0B', surface: '#1A1213', line: '#3A1A1E', text: '#F1E6D2', muted: '#D9CDB8',
      accent: '#D7263D', accentText: '#F1E6D2', warn: '#E8707F',
      display: HF_FONT, ui: "Oswald, 'Arial Narrow', sans-serif", body: "Oswald, 'Arial Narrow', sans-serif",
      displaySize: 'clamp(44px, 7.5vw, 76px)', uiSize: '17px', bodySize: '15px',
      regionTint: { s: 38, l: 80, h0: 350, ink: '#0E0B0B', line: '#0E0B0B' }
    }
  });

  /* ================================================================
   * STYLE 03 · NEON RIOT
   * Blacklight punk: dark cards, hot pink and cyan, acid-green splatter.
   * ================================================================ */
  var NR_FONT = "Bungee, Impact, 'Arial Black', sans-serif";
  registerStyle({
    id: 'neon-riot',
    name: 'Neon Riot',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Bungee&family=Space+Mono:wght@400;700&display=swap',
    fonts: { rank: NR_FONT },
    card: { bg: '#1C1C1C', radius: 10, border: 2, borderColor: 'ink' },
    backCard: { bg: '#141414', radius: 10, border: 2, borderColor: '#FF2E7A' },
    corner: { x: 8, y: 6, rankSize: 22, glyphSize: 19 },
    pip: 30, pipLarge: 38,
    suits: {
      red: { ink: '#FF2E7A', alt: '#A6FF2E' },
      black: { ink: '#2FE0FF', alt: '#A6FF2E' }
    },
    faces: {
      K: function (c) {
        return '<svg viewBox="0 0 100 120" width="100" height="120" style="position:absolute;left:18px;top:36px" aria-hidden="true">' +
          '<g fill="' + c.ink + '"><path d="M30 34 L22 2 L40 28 Z"></path><path d="M42 26 L46 0 L54 26 Z"></path><path d="M58 28 L72 2 L68 34 Z"></path><path d="M70 38 L92 18 L76 46 Z"></path><path d="M26 40 L6 22 L22 46 Z"></path></g>' +
          '<g transform="translate(0 22)"><path d="' + SKULL_PATH + '" fill="#2E5BFF" stroke="' + c.alt + '" stroke-width="1.6"></path>' + skullFace('#141414', c.alt) + '</g>' +
          '<path d="M26 106 L74 106 L76 116 L24 116 Z" fill="none" stroke="' + c.alt + '" stroke-width="1.8"></path>' +
          '<g fill="' + c.alt + '"><path d="M32 106 L35 99 L38 106 Z"></path><path d="M47 106 L50 99 L53 106 Z"></path><path d="M62 106 L65 99 L68 106 Z"></path></g></svg>';
      },
      Q: function (c) {
        return '<svg viewBox="0 0 100 120" width="100" height="120" style="position:absolute;left:18px;top:36px" aria-hidden="true">' +
          '<g transform="translate(0 22)"><path d="' + SKULL_PATH + '" fill="#2E5BFF" stroke="' + c.alt + '" stroke-width="1.6"></path>' +
          '<circle cx="63" cy="48" r="9" fill="' + c.alt + '"></circle><path d="M50 58 L45 67 L55 67 Z" fill="#141414"></path>' +
          '<path d="M40 72 L40 82 M50 72 L50 82 M60 72 L60 82" stroke="#141414" stroke-width="2.5"></path></g>' +
          '<path d="M12 70 C6 34 30 16 58 22 C76 26 86 36 88 48 C70 34 46 36 40 58 C38 72 40 84 46 96 C28 92 16 84 12 70 Z" fill="' + c.ink + '"></path>' +
          '<path d="M28 40 L36 30 M40 34 L50 26 M54 30 L66 28" stroke="#141414" stroke-width="2"></path>' +
          '<circle cx="86" cy="84" r="7" fill="none" stroke="' + c.alt + '" stroke-width="2.2"></circle>' +
          '<rect x="28" y="106" width="44" height="7" fill="#141414" stroke="' + c.ink + '" stroke-width="1.6"></rect>' +
          '<g fill="' + c.ink + '"><path d="M34 113 L37 120 L40 113 Z"></path><path d="M47 113 L50 120 L53 113 Z"></path><path d="M60 113 L63 120 L66 113 Z"></path></g></svg>';
      },
      J: function (c) {
        return '<svg viewBox="0 0 136 196" width="136" height="196" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<path d="M26 156 L116 42" stroke="' + c.ink + '" stroke-width="13" stroke-linecap="round"></path>' +
          '<g stroke="' + c.alt + '" stroke-width="2" stroke-linecap="round"><path d="M86 70 L100 56 M94 64 L110 62 M100 54 L102 38 M106 50 L122 46 M80 80 L88 92"></path></g></svg>' +
          bigLetter(NR_FONT, 96, '#2E5BFF');
      }
    },
    back: function () {
      return '<svg viewBox="0 0 176 256" width="136" height="196" style="position:absolute;left:0;top:0" aria-hidden="true">' +
        '<g fill="#FF2E7A"><path d="M20 120 L36 40 L52 120 Z"></path><path d="M56 120 L72 20 L88 120 Z"></path><path d="M92 120 L108 30 L124 120 Z"></path><path d="M128 120 L144 50 L160 120 Z"></path></g>' +
        '<g fill="#2E5BFF"><path d="M20 136 L36 216 L52 136 Z"></path><path d="M56 136 L72 236 L88 136 Z"></path><path d="M92 136 L108 226 L124 136 Z"></path><path d="M128 136 L144 206 L160 136 Z"></path></g>' +
        '<rect x="8" y="120" width="160" height="16" fill="#A6FF2E"></rect></svg>' +
        '<span style="position:absolute;left:0;right:0;top:92px;height:12px;text-align:center;font-family:\'Space Mono\',monospace;font-weight:700;font-size:9px;line-height:12px;letter-spacing:2px;color:#141414">DEVIL\'S GRIP</span>';
    },
    theme: {
      scheme: 'dark',
      table: '#141414', surface: '#1C1C1C', line: '#2E2E2E', text: '#EDEDED', muted: '#BDBDBD',
      accent: '#FF2E7A', accentText: '#141414', warn: '#A6FF2E',
      display: NR_FONT, ui: NR_FONT, body: "'Space Mono', ui-monospace, Menlo, monospace",
      displaySize: 'clamp(32px, 6vw, 58px)', uiSize: '15px', bodySize: '13px',
      regionTint: { s: 62, l: 28, h0: 310, ink: '#EDEDED', line: '#000000' }
    }
  });

  /* ================================================================
   * STYLE 04 · SIGNAL ORANGE
   * Industrial hazard livery: gunmetal stock, orange and teal.
   * ================================================================ */
  var SO_FONT = "'Chakra Petch', 'Arial Narrow', sans-serif";
  var SO_MONO = "'Share Tech Mono', ui-monospace, monospace";
  var SO_CODES = { S: ['3210', '3211'], H: ['4471', '4472'], C: ['0826', '0827'], D: ['1593', '1594'] };
  registerStyle({
    id: 'signal-orange',
    name: 'Signal Orange',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;700&family=Share+Tech+Mono&display=swap',
    fonts: { rank: SO_FONT, rankWeight: 700 },
    card: { bg: '#151B1D', radius: 4, border: 1, borderColor: '#3A4245' },
    backCard: { bg: '#FF7A1A', radius: 4 },
    corner: { x: 8, y: 6, rankSize: 24, glyphSize: 19 },
    pip: 30, pipLarge: 38,
    suits: {
      red: { ink: '#FF7A1A', alt: '#22D3C5' },
      black: { ink: '#22D3C5', alt: '#FF7A1A' }
    },
    faces: {
      K: function (c) {
        return '<svg viewBox="0 0 178 258" width="138" height="198" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<path d="M46 70 L132 70 L148 110 L140 176 L38 176 L30 110 Z" fill="' + c.ink + '"></path>' +
          '<path d="M44 104 L134 104 L128 132 L50 132 Z" fill="#0A0D0E"></path>' +
          '<path d="M56 112 L122 112" stroke="' + c.alt + '" stroke-width="4"></path>' +
          '<path d="M60 150 L84 150 M94 150 L118 150 M60 160 L118 160" stroke="#0A0D0E" stroke-width="3"></path>' +
          '<path d="M30 110 L14 96 L14 140 L34 150 Z M148 110 L164 96 L164 140 L144 150 Z" fill="' + c.alt + '"></path>' +
          '<path d="M60 82 L76 92 L96 78 L118 92" stroke="' + c.alt + '" stroke-width="5" fill="none" stroke-linecap="square"></path></svg>' +
          caption(SO_MONO, 11, '#A9B2B4', 'UNIT ' + SO_CODES[c.suit][0] + ' · KING', 'top:146px');
      },
      Q: function (c) {
        return '<svg viewBox="0 0 178 258" width="138" height="198" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<path d="M98 82 L120 50" stroke="' + c.alt + '" stroke-width="3"></path><circle cx="120" cy="50" r="4" fill="' + c.alt + '"></circle>' +
          '<path d="M40 128 C40 84 64 70 89 70 C114 70 138 84 138 128 L144 176 L34 176 Z" fill="' + c.ink + '"></path>' +
          '<path d="M50 108 L128 108 L122 136 L56 136 Z" fill="#0A0D0E"></path>' +
          '<path d="M60 118 L96 118" stroke="' + c.alt + '" stroke-width="3"></path>' +
          '<circle cx="36" cy="128" r="10" fill="' + c.alt + '"></circle><circle cx="142" cy="128" r="10" fill="' + c.alt + '"></circle>' +
          '<circle cx="36" cy="128" r="4" fill="#0A0D0E"></circle><circle cx="142" cy="128" r="4" fill="#0A0D0E"></circle>' +
          '<path d="M66 156 L112 156" stroke="#0A0D0E" stroke-width="3"></path>' +
          '<path d="M60 86 L74 80" stroke="#0A0D0E" stroke-width="3" stroke-linecap="round"></path></svg>' +
          caption(SO_MONO, 11, '#A9B2B4', 'PILOT ' + SO_CODES[c.suit][1] + ' · QUEEN', 'top:146px');
      },
      J: function (c) {
        return '<svg viewBox="0 0 138 198" width="138" height="198" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<path d="M0 148 L138 46 L138 84 L0 186 Z" fill="' + c.ink + '" opacity="0.9"></path>' +
          '<g fill="' + c.alt + '"><path d="M30 136 L54 116 L49 133 L71 113 L62 144 Z"></path><path d="M80 96 L104 78 L97 102 Z"></path></g></svg>' +
          bigLetter(SO_FONT, 104, '#F4F1EA', 'font-weight:700;');
      }
    },
    back: function () {
      return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
        '<path d="M20 150 L70 110 L60 140 L120 96 L100 150 L160 120 L140 180 L30 196 Z" fill="#22D3C5"></path>' +
        '<g fill="#0A0D0E"><rect x="16" y="16" width="3" height="60"></rect><rect x="22" y="16" width="1.5" height="60"></rect><rect x="26" y="16" width="4" height="60"></rect><rect x="33" y="16" width="1.5" height="60"></rect><rect x="37" y="16" width="2.5" height="60"></rect><rect x="42" y="16" width="1.5" height="60"></rect><rect x="46" y="16" width="4" height="60"></rect></g>' +
        '<path d="M164 230 L150 244 L164 244 Z" fill="#0A0D0E"></path></svg>' +
        '<span style="position:absolute;left:48px;top:13px;font-family:' + SO_FONT + ';font-weight:700;font-size:28px;line-height:1;color:#0A0D0E">DG</span>' +
        '<span style="position:absolute;left:48px;top:42px;font-family:' + SO_MONO + ';font-size:10px;letter-spacing:1px;color:#0A0D0E">CARGO 3210</span>' +
        '<span style="position:absolute;left:12px;bottom:12px;font-family:' + SO_MONO + ';font-size:10px;letter-spacing:1px;color:#0A0D0E">DEVIL\'S GRIP</span>';
    },
    theme: {
      scheme: 'dark',
      table: '#0A0D0E', surface: '#151B1D', line: '#253033', text: '#F4F1EA', muted: '#A9B2B4',
      accent: '#FF7A1A', accentText: '#0A0D0E', warn: '#22D3C5',
      display: SO_FONT, ui: SO_FONT, body: SO_MONO,
      displaySize: 'clamp(40px, 7vw, 66px)', uiSize: '17px', bodySize: '14px',
      regionTint: { s: 40, l: 27, h0: 25, ink: '#F4F1EA', line: '#050708' }
    }
  });

  /* ================================================================
   * STYLE 05 · ULTRAVIOLET RITE
   * Engraved tarot under blacklight: violet stock, ember and lilac.
   * ================================================================ */
  var UV_FONT = "Cinzel, 'Trajan Pro', Georgia, serif";
  var UV_SCAN = 'background-image:repeating-linear-gradient(0deg,rgba(201,182,255,0.08) 0 1px,transparent 1px 3px);';
  registerStyle({
    id: 'ultraviolet-rite',
    name: 'Ultraviolet Rite',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=Cormorant+Garamond:ital,wght@0,500;1,500&display=swap',
    fonts: { rank: UV_FONT, rankWeight: 700 },
    card: {
      bg: '#1A0B4F', radius: 8, border: 0, extra: UV_SCAN,
      decor: function () { return '<div style="position:absolute;inset:6px;border:1px solid #7B3FF2;border-radius:4px"></div>'; }
    },
    backCard: { bg: '#3B12A8', radius: 8, extra: 'background-image:repeating-linear-gradient(0deg,rgba(13,6,48,0.35) 0 1px,transparent 1px 3px);' },
    corner: { x: 11, y: 10, rankSize: 22, glyphSize: 19 },
    pip: 30, pipLarge: 38,
    suits: {
      red: { ink: '#FF5A1F', alt: '#C9B6FF' },
      black: { ink: '#C9B6FF', alt: '#FF5A1F' }
    },
    faces: {
      K: function (c) {
        return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<path d="M86 66 L90 50 L94 66 L108 58 L100 72 L116 76 L100 80 L108 94 L94 86 L90 102 L86 86 L72 94 L80 80 L64 76 L80 72 L72 58 Z" fill="#0D0630"></path>' +
          '<g fill="none" stroke="#7B3FF2" stroke-width="1.6"><path d="M86 110 C60 92 34 98 22 132 C40 124 54 126 66 134 C50 136 40 146 34 162 C52 150 66 148 80 150"></path><path d="M94 110 C120 92 146 98 158 132 C140 124 126 126 114 134 C130 136 140 146 146 162 C128 150 114 148 100 150"></path></g>' +
          '<path d="M90 104 C82 104 78 112 80 120 L76 176 L104 176 L100 120 C102 112 98 104 90 104 Z" fill="' + c.ink + '" opacity="0.9"></path>' +
          '<path d="M80 176 L100 176 M84 186 L96 186" stroke="' + c.alt + '" stroke-width="2"></path>' +
          '<path d="M104 136 L150 186" stroke="' + c.alt + '" stroke-width="3" stroke-linecap="round"></path></svg>' +
          caption(UV_FONT, 9, '#C9B6FF', 'THE KING', 'bottom:28px');
      },
      Q: function (c) {
        return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<path d="M90 48 A16 16 0 1 0 90 80 A12 12 0 1 1 90 48 Z" fill="#0D0630" stroke="' + c.alt + '" stroke-width="1"></path>' +
          '<circle cx="90" cy="102" r="17" fill="none" stroke="' + c.alt + '" stroke-width="1.6"></circle>' +
          '<circle cx="90" cy="102" r="10" fill="' + c.ink + '"></circle>' +
          '<path d="M90 114 C80 114 76 124 78 132 L62 190 L118 190 L102 132 C104 124 100 114 90 114 Z" fill="' + c.ink + '" opacity="0.88"></path>' +
          '<path d="M72 150 L108 150 M68 168 L112 168" stroke="#1A0B4F" stroke-width="1.2" opacity="0.7"></path>' +
          '<path d="M112 186 C116 160 122 140 128 124" stroke="' + c.alt + '" stroke-width="2" fill="none"></path>' +
          '<g fill="' + c.alt + '"><path d="M128 124 C122 112 124 104 128 100 C132 104 134 112 128 124 Z"></path><path d="M128 124 C118 120 114 112 114 108 C120 108 126 114 128 124 Z"></path><path d="M128 124 C138 120 142 112 142 108 C136 108 130 114 128 124 Z"></path></g></svg>' +
          caption(UV_FONT, 9, '#C9B6FF', 'THE QUEEN', 'bottom:28px');
      },
      J: function (c) {
        return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<g fill="' + c.alt + '" opacity="0.9"><path d="M120 64 C134 70 142 84 138 98 C130 90 122 88 116 90 C124 80 124 72 120 64 Z"></path><path d="M60 196 C46 190 38 176 42 162 C50 170 58 172 64 170 C56 180 56 188 60 196 Z"></path></g></svg>' +
          bigLetter(UV_FONT, 100, c.ink, 'font-weight:700;') + caption(UV_FONT, 9, '#C9B6FF', 'THE KNAVE', 'bottom:28px');
      }
    },
    back: function () {
      return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
        '<rect x="8" y="8" width="164" height="244" rx="4" fill="none" stroke="#C9B6FF" stroke-width="1"></rect>' +
        '<rect x="14" y="14" width="152" height="232" rx="2" fill="none" stroke="#C9B6FF" stroke-width="0.6" opacity="0.6"></rect>' +
        '<g fill="none" stroke="#FF5A1F" stroke-width="1.6"><path d="M80 126 C56 104 30 108 18 140 C34 132 48 134 58 140 C44 144 36 154 30 170"></path><path d="M100 126 C124 104 150 108 162 140 C146 132 132 134 122 140 C136 144 144 154 150 170"></path></g>' +
        '<path d="M90 92 L96 116 L118 104 L104 124 L128 130 L104 136 L118 156 L96 144 L90 168 L84 144 L62 156 L76 136 L52 130 L76 124 L62 104 L84 116 Z" fill="#0D0630"></path>' +
        '<circle cx="90" cy="130" r="12" fill="#0D0630" stroke="#FF5A1F" stroke-width="1.5"></circle></svg>' +
        caption(UV_FONT, 18, '#C9B6FF', 'XIV', 'top:22px') + caption(UV_FONT, 10, '#C9B6FF', 'DEVIL\'S GRIP', 'bottom:20px');
    },
    theme: {
      scheme: 'dark',
      table: '#0D0630', surface: '#1A0B4F', line: '#2A1870', text: '#E4DAFF', muted: '#B8A8E8',
      accent: '#FF5A1F', accentText: '#0D0630', warn: '#C9B6FF',
      display: UV_FONT, ui: UV_FONT, body: "'Cormorant Garamond', Garamond, Georgia, serif",
      displaySize: 'clamp(36px, 6.5vw, 62px)', uiSize: '16px', bodySize: '17px',
      regionTint: { s: 45, l: 30, h0: 265, ink: '#E4DAFF', line: '#05021A' }
    }
  });

  /* ================================================================
   * STYLE 06 · GLITCH RUNNER
   * Bright sci-fi sportswear: white stock, cobalt, acid lime, pixel type.
   * ================================================================ */
  var GR_FONT = "Silkscreen, 'Courier New', monospace";
  var GR_BARS = function (x) {
    return '<g fill="#111111"><rect x="' + x + '" y="186" width="2" height="22"></rect><rect x="' + (x + 4) + '" y="186" width="4" height="22"></rect><rect x="' + (x + 10) + '" y="186" width="1" height="22"></rect><rect x="' + (x + 13) + '" y="186" width="3" height="22"></rect><rect x="' + (x + 18) + '" y="186" width="4" height="22"></rect></g>';
  };
  registerStyle({
    id: 'glitch-runner',
    name: 'Glitch Runner',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&family=Space+Grotesk:wght@400;600&display=swap',
    fonts: { rank: GR_FONT, rankWeight: 700 },
    card: { bg: '#FFFFFF', radius: 6, border: 1, borderColor: '#C3C7CF' },
    backCard: { bg: '#2B2BD9', radius: 6 },
    corner: { x: 8, y: 7, rankSize: 20, glyphSize: 19, gap: 2 },
    pip: 30, pipLarge: 38,
    suits: {
      red: { ink: '#2B2BD9', alt: '#FF3EA5', wash: '#D4FF00' },
      black: { ink: '#111111', alt: '#2B2BD9', wash: '#D4FF00' }
    },
    faces: {
      K: function (c) {
        return '<svg viewBox="0 0 178 258" width="138" height="198" style="position:absolute;left:0;top:0" aria-hidden="true" shape-rendering="crispEdges">' +
          '<rect x="0" y="96" width="178" height="18" fill="#D4FF00"></rect>' +
          '<rect x="38" y="150" width="140" height="10" fill="' + c.alt + '" opacity="0.85"></rect>' +
          '<g fill="' + c.ink + '"><rect x="49" y="70" width="10" height="10"></rect><rect x="84" y="60" width="10" height="10"></rect><rect x="119" y="70" width="10" height="10"></rect><rect x="49" y="80" width="10" height="40"></rect><rect x="59" y="100" width="10" height="20"></rect><rect x="74" y="90" width="10" height="30"></rect><rect x="84" y="70" width="10" height="50"></rect><rect x="94" y="90" width="10" height="30"></rect><rect x="109" y="100" width="10" height="20"></rect><rect x="119" y="80" width="10" height="40"></rect><rect x="49" y="124" width="80" height="10"></rect></g>' +
          '<rect x="64" y="124" width="10" height="10" fill="#FF3EA5"></rect><rect x="104" y="124" width="10" height="10" fill="#D4FF00"></rect>' +
          GR_BARS(20) + '</svg>' +
          '<span style="position:absolute;left:38px;top:143px;font-family:' + GR_FONT + ';font-size:8px;line-height:1.3;color:#111111">RUNNER_K<br>SHELL: ROYAL</span>';
      },
      Q: function (c) {
        return '<svg viewBox="0 0 178 258" width="138" height="198" style="position:absolute;left:0;top:0" aria-hidden="true" shape-rendering="crispEdges">' +
          '<g fill="' + c.alt + '"><rect x="68" y="52" width="8" height="8"></rect><rect x="84" y="42" width="10" height="18"></rect><rect x="102" y="52" width="8" height="8"></rect></g>' +
          '<g fill="' + c.ink + '"><rect x="64" y="60" width="50" height="8"></rect><rect x="56" y="68" width="66" height="8"></rect><rect x="48" y="76" width="82" height="48"></rect><rect x="72" y="124" width="34" height="12"></rect><rect x="46" y="136" width="86" height="14"></rect></g>' +
          '<rect x="56" y="90" width="66" height="16" fill="#D4FF00"></rect><rect x="104" y="94" width="10" height="8" fill="#FFFFFF"></rect>' +
          '<rect x="40" y="94" width="8" height="22" fill="#FF3EA5"></rect><rect x="0" y="166" width="70" height="8" fill="#D4FF00"></rect>' +
          GR_BARS(136) + '</svg>' +
          '<span style="position:absolute;left:14px;top:143px;font-family:' + GR_FONT + ';font-size:8px;line-height:1.3;color:#111111">RUNNER_Q<br>SHELL: REGAL</span>';
      },
      J: function (c) {
        return '<svg viewBox="0 0 178 258" width="138" height="198" style="position:absolute;left:0;top:0" aria-hidden="true" shape-rendering="crispEdges">' +
          '<rect x="22" y="88" width="134" height="64" fill="' + c.ink + '"></rect>' +
          '<rect x="70" y="80" width="86" height="12" fill="#D4FF00"></rect><rect x="10" y="156" width="60" height="8" fill="#D4FF00"></rect>' +
          '<g fill="#D4FF00"><rect x="130" y="100" width="8" height="8"></rect><rect x="138" y="108" width="8" height="8"></rect><rect x="130" y="124" width="8" height="8"></rect></g>' +
          '<rect x="30" y="140" width="10" height="6" fill="#FF3EA5"></rect></svg>' +
          '<div style="position:absolute;left:0;right:0;top:66px;text-align:center;font-family:' + GR_FONT + ';font-weight:700;font-size:62px;line-height:1;color:#FFFFFF">J</div>';
      }
    },
    back: function () {
      return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true" shape-rendering="crispEdges">' +
        '<g fill="#D4FF00"><rect x="0" y="60" width="120" height="22"></rect><rect x="40" y="82" width="140" height="10"></rect><rect x="100" y="140" width="80" height="34"></rect><rect x="20" y="174" width="60" height="8"></rect><rect x="140" y="30" width="16" height="16"></rect><rect x="24" y="120" width="12" height="12"></rect><rect x="36" y="132" width="12" height="12"></rect></g>' +
        '<g fill="#111111"><rect x="108" y="148" width="2" height="18"></rect><rect x="112" y="148" width="4" height="18"></rect><rect x="118" y="148" width="1" height="18"></rect><rect x="121" y="148" width="3" height="18"></rect><rect x="126" y="148" width="1" height="18"></rect><rect x="129" y="148" width="4" height="18"></rect><rect x="135" y="148" width="2" height="18"></rect></g>' +
        '<g fill="none" stroke="#FFFFFF" stroke-width="1"><path d="M20 20 L28 20 M24 16 L24 24 M152 230 L160 230 M156 226 L156 234"></path></g></svg>' +
        '<span style="position:absolute;left:10px;top:49px;font-family:' + GR_FONT + ';font-weight:700;font-size:11px;line-height:1;color:#111111">DEVIL\'S GRIP</span>' +
        '<span style="position:absolute;left:10px;bottom:12px;font-family:' + GR_FONT + ';font-size:8px;color:#FFFFFF">RUN_001 // DECK</span>';
    },
    theme: {
      scheme: 'light',
      table: '#E9EBEF', surface: '#FFFFFF', line: '#C3C7CF', text: '#111111', muted: '#3C3F47',
      accent: '#2B2BD9', accentText: '#FFFFFF', warn: '#5A5FD0',
      display: GR_FONT, ui: GR_FONT, body: "'Space Grotesk', system-ui, sans-serif",
      displaySize: 'clamp(30px, 6vw, 58px)', uiSize: '15px', bodySize: '14px',
      regionTint: { s: 70, l: 85, h0: 230, ink: '#111111', line: '#111111' }
    }
  });

  /* ================================================================
   * STYLE 07 · BLOOD MOON
   * Woodblock drama: ivory stock, cobalt night, vermilion cloth.
   * ================================================================ */
  var BM_FONT = "'Shippori Mincho B1', 'Hiragino Mincho ProN', Georgia, serif";
  function bmMoon(cx, cy, r) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#EFE9DC"></circle>' +
      '<g fill="#C9C4B8"><circle cx="' + (cx - r * 0.27) + '" cy="' + (cy - r * 0.27) + '" r="' + (r * 0.18) + '"></circle><circle cx="' + (cx + r * 0.27) + '" cy="' + (cy + r * 0.36) + '" r="' + (r * 0.13) + '"></circle><circle cx="' + (cx + r * 0.36) + '" cy="' + (cy - r * 0.36) + '" r="' + (r * 0.09) + '"></circle></g>';
  }
  registerStyle({
    id: 'blood-moon',
    name: 'Blood Moon',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@600;800&family=Zen+Kaku+Gothic+New:wght@400;700&display=swap',
    fonts: { rank: BM_FONT, rankWeight: 800 },
    card: { bg: '#EFE9DC', radius: 6, border: 0 },
    backCard: { bg: '#1B3A8F', radius: 6 },
    corner: { x: 9, y: 5, rankSize: 24, glyphSize: 19 },
    pip: 30, pipLarge: 38,
    suits: {
      red: { ink: '#C81E15', cloth: '#E3261C', sash: '#E3261C', disc: '#E3261C', wash: '#F2A39E' },
      black: { ink: '#111111', cloth: '#111111', sash: '#C9C4B8', disc: '#1B3A8F', wash: '#8FA3DC' }
    },
    faces: {
      K: function (c) {
        return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<rect x="14" y="44" width="152" height="172" fill="#1B3A8F"></rect>' +
          '<path d="M110 44 L166 44 L166 216 L96 216 C120 170 126 100 110 44 Z" fill="' + c.cloth + '"></path>' + bmMoon(60, 80, 22) +
          '<path d="M120 50 C134 100 132 160 116 214" fill="none" stroke="#EFE9DC" stroke-width="7"></path>' +
          '<path d="M124 60 L128 62 M126 76 L130 78 M128 92 L132 94 M128 108 L132 110 M128 124 L132 126 M126 140 L130 142 M124 156 L128 158" stroke="#111" stroke-width="2"></path>' +
          '<path d="M40 216 L56 150 L74 132 L98 132 L112 150 L120 216 Z" fill="#111"></path>' +
          '<path d="M66 136 L56 108 L72 128 M90 128 L104 106 L96 134" stroke="#111" stroke-width="5" fill="none" stroke-linecap="round"></path>' +
          '<path d="M68 132 L94 132 L90 152 L72 152 Z" fill="#EFE9DC"></path><path d="M74 146 L88 146" stroke="#111" stroke-width="2"></path>' +
          '<circle cx="76" cy="140" r="2" fill="#E3261C"></circle><path d="M58 170 L102 170" stroke="' + c.sash + '" stroke-width="6"></path></svg>';
      },
      Q: function (c) {
        return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<rect x="14" y="44" width="152" height="172" fill="#1B3A8F"></rect>' +
          '<path d="M14 216 L14 170 C50 180 70 196 84 216 Z" fill="' + c.cloth + '"></path>' + bmMoon(108, 96, 34) +
          '<path d="M36 216 L140 70" stroke="#111" stroke-width="3.5"></path>' +
          '<path d="M140 70 C150 58 156 46 152 34 C146 48 138 58 132 66 Z" fill="#EFE9DC" stroke="#111" stroke-width="1.5"></path>' +
          '<path d="M60 216 L66 152 C58 132 64 108 82 106 C98 106 104 122 100 140 L110 216 Z" fill="#111"></path>' +
          '<path d="M66 152 C56 172 50 196 48 216 L60 216 Z" fill="#111"></path>' +
          '<ellipse cx="85" cy="124" rx="8" ry="10" fill="#EFE9DC"></ellipse>' +
          '<path d="M80 122 L84 122 M87 122 L91 122" stroke="#111" stroke-width="1.6"></path><circle cx="85" cy="131" r="1.4" fill="#E3261C"></circle>' +
          '<path d="M66 170 L106 162 L108 174 L68 182 Z" fill="' + c.sash + '"></path></svg>';
      },
      J: function (c) {
        return '<svg viewBox="0 0 140 200" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<circle cx="70" cy="100" r="48" fill="' + c.disc + '"></circle><path d="M22 166 C62 150 94 92 118 30" stroke="#111" stroke-width="2.5" fill="none"></path></svg>' +
          bigLetter(BM_FONT, 92, '#EFE9DC', 'font-weight:800;');
      }
    },
    back: function () {
      return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
        '<path d="M104 0 L180 0 L180 260 L80 260 C120 190 128 80 104 0 Z" fill="#E3261C"></path>' + bmMoon(66, 78, 38) +
        '<path d="M114 10 C138 90 134 180 106 254" fill="none" stroke="#EFE9DC" stroke-width="9"></path>' +
        '<path d="M120 30 L126 33 M124 54 L130 57 M128 78 L134 80 M130 102 L136 104 M130 126 L136 128 M128 150 L134 152 M126 174 L132 176 M122 198 L128 200" stroke="#111" stroke-width="3"></path>' +
        '<rect x="8" y="8" width="164" height="244" rx="3" fill="none" stroke="#EFE9DC" stroke-width="1"></rect></svg>' +
        '<span style="position:absolute;left:12px;bottom:14px;font-family:' + BM_FONT + ';font-weight:800;font-size:11px;letter-spacing:2px;color:#EFE9DC">DEVIL\'S GRIP</span>';
    },
    theme: {
      scheme: 'dark',
      table: '#1B3A8F', surface: '#234597', line: '#3E5BB5', text: '#EFE9DC', muted: '#D5D9EA',
      accent: '#E3261C', accentText: '#EFE9DC', warn: '#F2A39E',
      display: BM_FONT, ui: BM_FONT, body: "'Zen Kaku Gothic New', system-ui, sans-serif",
      displaySize: 'clamp(40px, 7vw, 68px)', uiSize: '17px', bodySize: '14px',
      regionTint: { s: 42, l: 82, h0: 5, ink: '#111111', line: '#111111' }
    }
  });

  /* ================================================================
   * STYLE 08 · CARCOSA YELLOW
   * Weird-fiction paperback: faded mustard, black stars, rust robes.
   * ================================================================ */
  var CY_FONT = "'DM Serif Display', Georgia, serif";
  var CY_EPITHETS = { S: 'the pallid jack', H: 'the masked jack', C: 'the drowned jack', D: 'the waiting jack' };
  var CY_STARS = '<g fill="#111"><circle cx="40" cy="50" r="1.4"></circle><circle cx="120" cy="40" r="1.2"></circle><circle cx="150" cy="80" r="1.6"></circle><circle cx="60" cy="96" r="1"></circle><circle cx="130" cy="120" r="1.2"></circle></g>';
  registerStyle({
    id: 'carcosa-yellow',
    name: 'Carcosa Yellow',
    fontsHref: 'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500&display=swap',
    fonts: { rank: CY_FONT },
    card: { bg: '#F5D66B', radius: 6, border: 0, shadow: '0 2px 0 #111' },
    backCard: { bg: '#E8B21E', radius: 6, shadow: '0 2px 0 #111' },
    corner: { x: 9, y: 5, rankSize: 28, glyphSize: 19 },
    pip: 30, pipLarge: 38,
    suits: {
      red: { ink: '#7A2E14', robe: '#7A2E14', crown: '#5A1F0C', wash: '#D9A441' },
      black: { ink: '#111111', robe: '#4A3A1E', crown: '#2A1A08', wash: '#D9A441' }
    },
    faces: {
      K: function (c) {
        return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<g fill="#A5781A" opacity="0.55"><path d="M10 230 L10 150 L18 120 L26 150 L26 110 L34 70 L42 110 L42 230 Z"></path><path d="M140 230 L140 140 L148 110 L156 140 L156 230 Z"></path></g>' + CY_STARS +
          '<g stroke="' + c.crown + '" stroke-width="4" stroke-linecap="round"><path d="M76 108 L64 74 M84 104 L80 66 M92 104 L94 62 M100 104 L110 68 M106 108 L122 80 M70 110 L54 88"></path></g>' +
          '<path d="M60 230 L60 160 C60 130 74 108 90 108 C106 108 120 130 120 160 L124 230 Z" fill="' + c.robe + '"></path>' +
          '<path d="M74 230 L76 168 C80 150 88 144 96 150 L104 230 Z" fill="' + c.crown + '" opacity="0.6"></path>' +
          '<rect x="68" y="116" width="44" height="44" fill="#111"></rect></svg>';
      },
      Q: function (c) {
        return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<path d="M128 230 L128 120 L136 90 L144 120 L144 70 L152 40 L160 70 L160 230 Z" fill="#A5781A" opacity="0.5"></path>' + CY_STARS +
          '<path d="M90 64 C70 86 60 118 62 150 L50 232 L130 232 L118 150 C120 118 110 86 90 64 Z" fill="' + c.robe + '"></path>' +
          '<path d="M90 64 C82 90 80 120 84 150 L78 232 L92 232 L96 150 C98 120 96 90 90 64 Z" fill="' + c.crown + '" opacity="0.45"></path>' +
          '<ellipse cx="90" cy="128" rx="14" ry="18" fill="#F2E4B8"></ellipse>' +
          '<path d="M83 124 L87 124 M93 124 L97 124" stroke="#A5781A" stroke-width="1.2"></path>' +
          '<path d="M50 232 L56 220 L62 232 L70 218 L78 232 L86 220 L94 232 L102 218 L110 232 L118 220 L124 232 L130 222 L130 236 L50 236 Z" fill="#F5D66B"></path></svg>';
      },
      J: function (c) {
        return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
          '<g fill="none" stroke="' + c.ink + '" stroke-width="7" stroke-linecap="round"><path d="M70 92 C64 70 84 56 102 64 C116 72 112 92 96 96"></path><path d="M94 116 C120 116 136 136 128 160"></path><path d="M84 120 C64 130 54 150 62 170"></path></g>' +
          '<circle cx="90" cy="112" r="9" fill="none" stroke="' + c.ink + '" stroke-width="5"></circle>' +
          '<g fill="#111"><circle cx="40" cy="60" r="1.6"></circle><circle cx="140" cy="70" r="2"></circle><circle cx="150" cy="200" r="1.4"></circle><circle cx="36" cy="200" r="1.8"></circle></g></svg>' +
          '<span style="position:absolute;left:0;right:0;bottom:34px;text-align:center;font-family:' + CY_FONT + ';font-size:13px;font-style:italic;color:' + c.ink + '">' + CY_EPITHETS[c.suit] + '</span>';
      }
    },
    back: function () {
      return '<svg viewBox="0 0 180 260" width="140" height="200" style="position:absolute;left:0;top:0" aria-hidden="true">' +
        '<g fill="#A5781A" opacity="0.7"><path d="M0 260 L0 200 L14 170 L22 190 L30 130 L38 90 L46 130 L52 170 L62 150 L70 190 L70 260 Z"></path><path d="M110 260 L110 200 L122 160 L132 190 L140 140 L150 110 L158 150 L166 190 L180 170 L180 260 Z"></path></g>' +
        '<circle cx="70" cy="70" r="22" fill="#111"></circle><circle cx="112" cy="84" r="14" fill="#111"></circle>' +
        '<g fill="#111"><circle cx="30" cy="30" r="1.6"></circle><circle cx="150" cy="40" r="1.8"></circle><circle cx="140" cy="130" r="1.2"></circle><circle cx="24" cy="110" r="1.4"></circle><circle cx="96" cy="140" r="1.2"></circle></g>' +
        '<rect x="8" y="8" width="164" height="244" fill="none" stroke="#111" stroke-width="1"></rect></svg>' +
        '<span style="position:absolute;left:0;right:0;top:130px;text-align:center;font-family:' + CY_FONT + ';font-size:16px;line-height:1;color:#111">Devil\'s Grip</span>';
    },
    theme: {
      scheme: 'light',
      table: '#E8B21E', surface: '#F5D66B', line: '#A5781A', text: '#111111', muted: '#2A1A08',
      accent: '#111111', accentText: '#F5D66B', warn: '#7A2E14',
      display: CY_FONT, ui: CY_FONT, body: "'DM Mono', ui-monospace, monospace",
      displaySize: 'clamp(44px, 7.5vw, 76px)', uiSize: '18px', bodySize: '13px',
      regionTint: { s: 45, l: 74, h0: 40, ink: '#111111', line: '#111111' }
    }
  });

  /* ================================================================
   * STYLE 09 · TOXIC HALFTONE
   * Misregistered print: aubergine, slime green, magenta offset.
   * ================================================================ */
  var TX_FONT = "'Rubik Mono One', 'Arial Black', sans-serif";
  function txAura(colour, x, y, d, op) {
    return '<div style="position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + d + 'px;height:' + d + 'px;border-radius:50%;background-image:radial-gradient(' + colour + ' 1.1px,transparent 1.4px);background-size:5px 5px;opacity:' + op + '"></div>';
  }
  registerStyle({
    id: 'toxic-halftone',
    name: 'Toxic Halftone',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Rubik+Mono+One&family=Rubik:wght@400;600&display=swap',
    fonts: { rank: TX_FONT },
    card: { bg: '#2A0B33', radius: 10, border: 0 },
    backCard: { bg: '#4A1659', radius: 10, border: 2, borderColor: '#7CF25A' },
    corner: { x: 8, y: 7, rankSize: 20, glyphSize: 19, gap: 1 },
    pip: 30, pipLarge: 38,
    suits: {
      red: { ink: '#E05CF0', alt: '#7CF25A' },
      black: { ink: '#7CF25A', alt: '#E05CF0' }
    },
    faces: {
      K: function (c) {
        return txAura(c.ink, 20, 46, 100, 0.45) +
          '<svg viewBox="0 0 100 120" width="100" height="120" style="position:absolute;left:20px;top:38px" aria-hidden="true">' +
          '<path d="M70 30 C96 12 104 52 82 62 C96 46 88 30 74 38 Z" fill="#2E6B2A" stroke="' + c.alt + '" stroke-width="1.5"></path>' +
          '<path d="M30 30 C4 12 -4 52 18 62 C4 46 12 30 26 38 Z" fill="#2E6B2A" stroke="' + c.alt + '" stroke-width="1.5"></path>' +
          '<g transform="translate(3 22)"><path d="' + SKULL_PATH + '" fill="' + c.alt + '"></path></g>' +
          '<g transform="translate(0 20)"><path d="' + SKULL_PATH + '" fill="' + c.ink + '"></path>' + skullFace('#2A0B33') + '</g></svg>';
      },
      Q: function (c) {
        return txAura(c.alt, 30, 56, 80, 0.4) +
          '<svg viewBox="0 0 100 120" width="100" height="120" style="position:absolute;left:20px;top:38px" aria-hidden="true">' +
          '<g fill="' + c.alt + '"><circle cx="38" cy="16" r="3"></circle><circle cx="50" cy="10" r="3.5"></circle><circle cx="62" cy="16" r="3"></circle></g>' +
          '<g transform="translate(13 26) scale(0.74)"><path d="' + SKULL_PATH + '" fill="' + c.alt + '" transform="translate(4 3)"></path><path d="' + SKULL_PATH + '" fill="' + c.ink + '"></path>' + skullFace('#2A0B33') + '</g>' +
          '<path d="M28 44 C8 40 4 70 18 80 C30 88 40 76 32 68 C26 64 20 70 24 74" fill="none" stroke="#2E6B2A" stroke-width="7" stroke-linecap="round"></path>' +
          '<path d="M72 44 C92 40 96 70 82 80 C70 88 60 76 68 68 C74 64 80 70 76 74" fill="none" stroke="#2E6B2A" stroke-width="7" stroke-linecap="round"></path>' +
          '<path d="M28 44 C8 40 4 70 18 80 C30 88 40 76 32 68" fill="none" stroke="' + c.ink + '" stroke-width="1.4"></path>' +
          '<path d="M72 44 C92 40 96 70 82 80 C70 88 60 76 68 68" fill="none" stroke="' + c.ink + '" stroke-width="1.4"></path>' +
          '<path d="M36 102 C44 108 56 108 64 102" fill="none" stroke="' + c.alt + '" stroke-width="2"></path><circle cx="50" cy="108" r="3" fill="' + c.ink + '"></circle></svg>';
      },
      J: function (c) {
        return bigLetter(TX_FONT, 96, c.alt, 'transform:translate(4px,3px);') + bigLetter(TX_FONT, 96, c.ink);
      }
    },
    back: function () {
      return txAura('#7CF25A', 22, 52, 92, 0.35) +
        '<svg viewBox="0 0 176 256" width="136" height="196" style="position:absolute;left:0;top:0" aria-hidden="true">' +
        '<path d="M88 128 C88 100 128 100 128 130 C128 168 66 172 60 128 C54 80 128 64 146 112 C162 160 120 206 74 196" fill="none" stroke="#7CF25A" stroke-width="14" stroke-linecap="round"></path>' +
        '<path d="M88 128 C88 100 128 100 128 130 C128 168 66 172 60 128 C54 80 128 64 146 112 C162 160 120 206 74 196" fill="none" stroke="#E05CF0" stroke-width="2" transform="translate(3 2)"></path></svg>' +
        '<span style="position:absolute;left:0;right:0;top:14px;text-align:center;font-family:' + TX_FONT + ';font-size:9px;color:#7CF25A">DEVIL\'S GRIP</span>';
    },
    theme: {
      scheme: 'dark',
      table: '#4A1659', surface: '#2A0B33', line: '#6A2A7B', text: '#F1E6F5', muted: '#DCC6E4',
      accent: '#7CF25A', accentText: '#2A0B33', warn: '#E05CF0',
      display: TX_FONT, ui: TX_FONT, body: "Rubik, system-ui, sans-serif",
      displaySize: 'clamp(28px, 5.5vw, 54px)', uiSize: '13px', bodySize: '14px',
      regionTint: { s: 45, l: 30, h0: 285, ink: '#F1E6F5', line: '#12031A' }
    }
  });

  /* ================================================================
   * STYLE 10 · LILAC PIXEL
   * 16-bit still life: pale lilac, charcoal sprites, violet shadows.
   * ================================================================ */
  var LP_FONT = "'Press Start 2P', 'Courier New', monospace";
  registerStyle({
    id: 'lilac-pixel',
    name: 'Lilac Pixel',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap',
    fonts: { rank: LP_FONT },
    compactBelow: 70,
    card: { bg: '#F7EEFF', radius: 0, border: 3, borderColor: '#2B2433', shadow: '4px 4px 0 #6A2BD9' },
    backCard: { bg: '#6A2BD9', radius: 0, border: 3, borderColor: '#2B2433', shadow: '4px 4px 0 #2B2433', extra: 'background-image:radial-gradient(rgba(43,36,51,0.45) 1px,transparent 1.1px);background-size:3px 3px;' },
    corner: { x: 6, y: 7, rankSize: 15, glyphSize: 19, gap: 4 },
    pip: 30, pipLarge: 38,
    suits: {
      red: { ink: '#B0285E', alt: '#6A2BD9' },
      black: { ink: '#2B2433', alt: '#B0285E' }
    },
    faces: {
      K: function (c) {
        return '<svg viewBox="0 0 174 254" width="134" height="194" style="position:absolute;left:0;top:0" aria-hidden="true" shape-rendering="crispEdges">' +
          '<g fill="#6A2BD9" opacity="0.55"><rect x="48" y="140" width="96" height="16"></rect><rect x="56" y="156" width="80" height="8"></rect></g>' +
          '<g fill="' + c.ink + '"><rect x="40" y="96" width="8" height="40"></rect><rect x="48" y="112" width="8" height="24"></rect><rect x="56" y="104" width="8" height="32"></rect><rect x="64" y="120" width="8" height="16"></rect><rect x="72" y="96" width="8" height="40"></rect><rect x="80" y="88" width="8" height="48"></rect><rect x="88" y="96" width="8" height="40"></rect><rect x="96" y="120" width="8" height="16"></rect><rect x="104" y="104" width="8" height="32"></rect><rect x="112" y="112" width="8" height="24"></rect><rect x="120" y="96" width="8" height="40"></rect><rect x="40" y="136" width="88" height="8"></rect></g>' +
          '<g fill="#E0A060"><rect x="40" y="88" width="8" height="8"></rect><rect x="80" y="80" width="8" height="8"></rect><rect x="120" y="88" width="8" height="8"></rect><rect x="56" y="128" width="8" height="8"></rect><rect x="104" y="128" width="8" height="8"></rect></g>' +
          '<rect x="80" y="128" width="8" height="8" fill="' + c.alt + '"></rect>' +
          '<g fill="#F7EEFF" opacity="0.5"><rect x="48" y="96" width="8" height="8"></rect><rect x="88" y="88" width="8" height="8"></rect></g></svg>' +
          caption("VT323, 'Courier New', monospace", 16, '#3A2F45', 'LVL 99 KING', 'top:132px');
      },
      Q: function (c) {
        return '<svg viewBox="0 0 174 254" width="134" height="194" style="position:absolute;left:0;top:0" aria-hidden="true" shape-rendering="crispEdges">' +
          '<rect x="56" y="152" width="80" height="10" fill="#6A2BD9" opacity="0.55"></rect>' +
          '<g fill="#E0A060"><rect x="52" y="64" width="8" height="8"></rect><rect x="68" y="64" width="8" height="8"></rect><rect x="84" y="60" width="8" height="8"></rect><rect x="100" y="64" width="8" height="8"></rect><rect x="116" y="64" width="8" height="8"></rect></g>' +
          '<g fill="' + c.ink + '"><rect x="52" y="72" width="8" height="8"></rect><rect x="68" y="72" width="8" height="8"></rect><rect x="84" y="68" width="8" height="12"></rect><rect x="100" y="72" width="8" height="8"></rect><rect x="116" y="72" width="8" height="8"></rect><rect x="52" y="80" width="72" height="16"></rect><rect x="60" y="96" width="56" height="8"></rect><rect x="72" y="104" width="32" height="24"></rect><rect x="64" y="128" width="48" height="8"></rect><rect x="56" y="136" width="64" height="8"></rect><rect x="48" y="144" width="80" height="8"></rect></g>' +
          '<rect x="84" y="84" width="8" height="8" fill="' + c.alt + '"></rect>' +
          '<g fill="#F7EEFF" opacity="0.45"><rect x="60" y="80" width="8" height="8"></rect><rect x="76" y="104" width="8" height="16"></rect></g></svg>' +
          caption("VT323, 'Courier New', monospace", 16, '#3A2F45', 'LVL 98 QUEEN', 'top:132px');
      },
      J: function (c) {
        return bigLetter(LP_FONT, 64, '#6A2BD9', 'transform:translate(5px,5px);') + bigLetter(LP_FONT, 64, c.ink);
      }
    },
    back: function () {
      return '<svg viewBox="0 0 174 254" width="134" height="194" style="position:absolute;left:0;top:0" aria-hidden="true" shape-rendering="crispEdges">' +
        '<g fill="#D9A6F2"><rect x="83" y="71" width="8" height="8"></rect><rect x="75" y="79" width="24" height="8"></rect><rect x="67" y="87" width="40" height="8"></rect><rect x="59" y="95" width="56" height="8"></rect><rect x="51" y="103" width="72" height="8"></rect><rect x="43" y="111" width="88" height="16"></rect><rect x="51" y="127" width="72" height="8"></rect><rect x="59" y="135" width="56" height="8"></rect><rect x="67" y="143" width="40" height="8"></rect><rect x="75" y="151" width="24" height="8"></rect><rect x="83" y="159" width="8" height="8"></rect></g>' +
        '<rect x="79" y="107" width="16" height="24" fill="#2B2433"></rect>' +
        '<g fill="#E0A060"><rect x="83" y="111" width="8" height="8"></rect><rect x="14" y="14" width="8" height="8"></rect><rect x="152" y="14" width="8" height="8"></rect><rect x="14" y="232" width="8" height="8"></rect><rect x="152" y="232" width="8" height="8"></rect></g></svg>' +
        '<span style="position:absolute;left:0;right:0;bottom:24px;text-align:center;font-family:' + LP_FONT + ';font-size:7px;color:#F7EEFF">DEVIL\'S GRIP</span>';
    },
    theme: {
      scheme: 'light',
      table: '#D9A6F2', surface: '#F7EEFF', line: '#2B2433', text: '#2B2433', muted: '#3A2F45',
      accent: '#E0A060', accentText: '#2B2433', warn: '#6A2BD9',
      display: LP_FONT, ui: LP_FONT, body: "VT323, 'Courier New', monospace",
      displaySize: 'clamp(22px, 4.6vw, 42px)', uiSize: '11px', bodySize: '19px',
      regionTint: { s: 55, l: 84, h0: 270, ink: '#2B2433', line: '#2B2433' }
    }
  });

  root.CardEngine = {
    BASE_W: BASE_W, BASE_H: BASE_H, RANKS: RANKS, VALUE: VALUE, SUITS: SUITS, LAYOUTS: LAYOUTS,
    registerStyle: registerStyle, registerAssets: registerAssets, getStyle: getStyle, listStyles: listStyles,
    renderCard: renderCard, renderBack: renderBack, makeDeck: makeDeck, shuffle: shuffle, loadFonts: loadFonts,
    renderToken: renderToken, regionColours: regionColours,
    cardName: cardName, heightFor: heightFor, peek: peek,
    isCompact: function (styleId, width) { return isCompact(getStyle(styleId), width); },
    // How far apart to fan cards sideways so each covered card still shows its rank and suit.
    fanOffset: function (styleId, width) { return Math.round(width * (isCompact(getStyle(styleId), width) ? 0.84 : 0.34)); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
