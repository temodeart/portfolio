/* =========================================================================
   Effects — self-gating. Watches <html data-fx> and starts or stops itself,
   so nothing here runs while the toggle is off.

   Add an effect by pushing an object onto EFFECTS. It may implement
   start(), frame() and stop(). stop() MUST leave the page exactly as it
   found it — the effects-off state is the design of record.
   ========================================================================= */

(() => {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

  /* ---------------------------------------------------- shared pointer */

  // One listener and one animation frame for every effect, rather than a
  // loop each. `moved` is cleared at the end of every frame so effects can
  // cheaply skip work when the pointer is at rest.
  const pointer = { x: -1e6, y: -1e6, moved: false };

  const onPointerMove = (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.moved = true;
  };

  /* ========================================================= effect: light */

  // PLACEHOLDER — pairs with the pointer light in effects.css.
  const pointerLight = {
    frame() {
      if (!pointer.moved) return;
      root.style.setProperty('--fx-x', `${pointer.x}px`);
      root.style.setProperty('--fx-y', `${pointer.y}px`);
    },
    stop() {
      root.style.removeProperty('--fx-x');
      root.style.removeProperty('--fx-y');
    },
  };

  /* ================================================= shared: the text grid */

  /* Both the proximity effect and the particle scroll need the page's text
     broken up, so it is split once here and handed to whoever wants it.

     Words are `inline-block` because `transform` does not apply to inline
     boxes and the particle scroll has to move them. Letters inside stay
     inline. Splitting is fully reversible: stop() puts the original text
     nodes back and the DOM comes out byte-identical. */

  const textGrid = (() => {
    // Text that rewrites itself, or isn't page text at all.
    const SKIP = '.fx, .clock, script, style, noscript, title';

    let words = [];
    let letters = [];
    let undo = [];

    const build = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (!parent || parent.closest(SKIP)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);

      for (const node of nodes) {
        const parentStyle = getComputedStyle(node.parentElement);
        const weight = parseInt(parentStyle.fontWeight, 10) || 400;
        const to = Math.min(weight + 450, 900);
        const decoration = parentStyle.textDecorationLine;
        const fragment = document.createDocumentFragment();
        const added = [];

        // Whitespace stays as plain text nodes, so lines still break where
        // they always did.
        for (const part of node.nodeValue.split(/(\s+)/)) {
          if (!part) continue;

          if (!part.trim()) {
            const space = document.createTextNode(part);
            fragment.append(space);
            added.push(space);
            continue;
          }

          const word = document.createElement('span');
          word.className = 'fx-w';

          // An inline-block breaks the underline an ancestor <a> would have
          // drawn through it, so carry the decoration onto the word itself.
          if (decoration !== 'none') {
            word.style.textDecorationLine = decoration;
            word.style.textDecorationColor = parentStyle.textDecorationColor;
            word.style.textDecorationStyle = parentStyle.textDecorationStyle;
            word.style.textDecorationThickness = parentStyle.textDecorationThickness;
            word.style.textUnderlineOffset = parentStyle.textUnderlineOffset;
          }

          const own = [];
          for (const character of part) {
            const span = document.createElement('span');
            span.className = 'fx-ch';
            span.textContent = character;
            word.append(span);
            own.push(span);
          }

          const entry = { el: word, settled: true };
          words.push(entry);
          for (const span of own) letters.push({ el: span, from: weight, to, word: entry });

          fragment.append(word);
          added.push(word);
        }

        // In a flex or grid parent the text was a single anonymous item;
        // loose words would each become an item and pick up the container's
        // gap ("I n d e x"). One wrapper keeps it a single item.
        if (/flex|grid/.test(parentStyle.display)) {
          const wrapper = document.createElement('span');
          wrapper.className = 'fx-t';
          wrapper.append(fragment);
          undo.push({ node, parent: node.parentNode, added: [wrapper] });
          node.parentNode.replaceChild(wrapper, node);
          continue;
        }

        undo.push({ node, parent: node.parentNode, added });
        node.parentNode.replaceChild(fragment, node);
      }
    };

    const teardown = () => {
      for (let i = undo.length - 1; i >= 0; i--) {
        const { node, parent, added } = undo[i];
        if (!added[0] || !added[0].parentNode) continue;
        added[0].parentNode.insertBefore(node, added[0]);
        for (const item of added) item.remove();
        parent.normalize();
      }
      undo = [];
      words = [];
      letters = [];
    };

    return {
      words: () => words,
      letters: () => letters,
      start: build,
      stop: teardown,
    };
  })();

  /* ============================================ effect: variable proximity */

  /* Ported from React Bits' <VariableProximity /> to vanilla JS, and
     rebuilt around the fact that it runs site-wide rather than on one
     headline: the original measures every letter with
     getBoundingClientRect() on every frame, which is ruinous for the few
     thousand letters on a page. Here every position is measured once into
     flat arrays and a frame is arithmetic plus a handful of style writes. */

  const variableProximity = (() => {
    const RADIUS = 25;
    const FALLOFF = 'gaussian';   // 'linear' | 'exponential' | 'gaussian'
    const OPSZ_FROM = 14;
    const OPSZ_TO = 28;

    let letters = [];
    let cx, cy;                   // Float32Array — page-space centres
    let applied;                  // Float32Array — last t written per letter
    let observer = null;
    let remeasure = 0;

    const falloff = (distance) => {
      const norm = Math.min(Math.max(1 - distance / RADIUS, 0), 1);
      if (FALLOFF === 'exponential') return norm * norm;
      if (FALLOFF === 'gaussian') return Math.exp(-((distance / (RADIUS / 2)) ** 2) / 2);
      return norm;
    };

    // All reads, then all writes — one layout pass rather than thousands.
    const measure = () => {
      const count = letters.length;
      cx = new Float32Array(count);
      cy = new Float32Array(count);
      applied = new Float32Array(count).fill(-1);

      const offsetX = window.scrollX;
      const offsetY = window.scrollY;

      for (let i = 0; i < count; i++) {
        const rect = letters[i].el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          cx[i] = NaN; // in a hidden panel — skipped until the next measure
          continue;
        }
        cx[i] = rect.left + rect.width / 2 + offsetX;
        cy[i] = rect.top + rect.height / 2 + offsetY;
      }
    };

    const scheduleMeasure = () => {
      clearTimeout(remeasure);
      remeasure = setTimeout(measure, 120);
    };

    return {
      start() {
        // A cursor-proximity effect needs a cursor, and it is motion.
        if (!finePointer.matches || reduceMotion.matches) return;

        letters = textGrid.letters();
        measure();

        // Switching tabs, resizing, or Inter finishing its download all move
        // the letters. The body's box changes in every one of those cases.
        observer = new ResizeObserver(scheduleMeasure);
        observer.observe(document.body);
        window.addEventListener('resize', scheduleMeasure);
        if (document.fonts) document.fonts.ready.then(scheduleMeasure);
      },

      frame() {
        if (!pointer.moved || !letters.length) return;

        const x = pointer.x + window.scrollX;
        const y = pointer.y + window.scrollY;
        const reach = RADIUS * RADIUS;

        for (let i = 0; i < letters.length; i++) {
          const letter = letters[i];
          const dx = cx[i] - x;
          const dy = cy[i] - y;
          const d2 = dx * dx + dy * dy;

          // NaN comparisons are false, which conveniently skips unmeasured
          // letters here and leaves them at rest below. A letter whose word
          // is mid-flight is skipped too: its cached centre is its home, not
          // where the particle scroll is currently drawing it.
          if (!(d2 < reach) || !letter.word.settled) {
            if (applied[i] !== 0) {
              applied[i] = 0;
              letter.el.style.fontVariationSettings = '';
            }
            continue;
          }

          const t = falloff(Math.sqrt(d2));
          // Sub-percent changes aren't visible; skipping them keeps the
          // style recalc down to the letters actually moving.
          if (Math.abs(t - applied[i]) < 0.01) continue;
          applied[i] = t;

          const wght = letter.from + (letter.to - letter.from) * t;
          const opsz = OPSZ_FROM + (OPSZ_TO - OPSZ_FROM) * t;
          letter.el.style.fontVariationSettings = `"wght" ${wght.toFixed(1)}, "opsz" ${opsz.toFixed(1)}`;
        }
      },

      stop() {
        clearTimeout(remeasure);
        if (observer) observer.disconnect();
        observer = null;
        window.removeEventListener('resize', scheduleMeasure);
        letters = [];
      },
    };
  })();

  /* ==================================================== effect: click spark */

  /* Ported from React Bits' <ClickSpark />. Three changes for this site:

     - One fixed, full-viewport canvas instead of a wrapper element per
       subtree, so a click anywhere sparks without restructuring the page.
     - It draws only while sparks are alive. The original runs an animation
       frame forever; here the shared loop is already running, and a frame
       with nothing to draw costs one array-length check.
     - The backing store is scaled by devicePixelRatio, so the lines are
       crisp rather than soft on a retina screen. */

  const clickSpark = (() => {
    const COUNT = 8;
    const RADIUS = 18;
    const SIZE = 9;
    const DURATION = 420;
    const LINE_WIDTH = 1.5;

    let canvas = null;
    let ctx = null;
    let sparks = [];
    let resizeTimer = 0;
    let painted = false;

    // Matches the site's --ease-out rather than the component's gentler
    // quadratic, so the sparks move like everything else here.
    const ease = (t) => 1 - (1 - t) ** 3;

    const viewport = () => [
      document.documentElement.clientWidth,
      document.documentElement.clientHeight,
    ];

    const size = () => {
      const [w, h] = viewport();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      painted = false;
    };

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(size, 120);
    };

    // pointerdown, not click: the spark should answer the press, not wait
    // for the release. Reading --text each burst keeps it correct in both
    // themes without watching for a change.
    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      const color =
        getComputedStyle(root).getPropertyValue('--text').trim() || '#111';
      const now = performance.now();

      for (let i = 0; i < COUNT; i++) {
        sparks.push({
          x: event.clientX,
          y: event.clientY,
          angle: (2 * Math.PI * i) / COUNT,
          start: now,
          color,
        });
      }
    };

    return {
      start() {
        if (reduceMotion.matches) return;

        canvas = document.createElement('canvas');
        canvas.className = 'fx-spark';
        canvas.setAttribute('aria-hidden', 'true');
        ctx = canvas.getContext('2d');
        document.body.append(canvas);
        size();

        window.addEventListener('resize', onResize);
        window.addEventListener('pointerdown', onPointerDown, { passive: true });
      },

      frame() {
        if (!ctx) return;
        const [w, h] = viewport();

        if (!sparks.length) {
          // One last clear when the final spark dies, then nothing.
          if (painted) {
            ctx.clearRect(0, 0, w, h);
            painted = false;
          }
          return;
        }

        ctx.clearRect(0, 0, w, h);
        painted = true;
        ctx.lineWidth = LINE_WIDTH;

        const now = performance.now();

        sparks = sparks.filter((spark) => {
          const progress = (now - spark.start) / DURATION;
          if (progress >= 1) return false;

          const eased = ease(progress);
          const distance = eased * RADIUS;
          const length = SIZE * (1 - eased);
          const cos = Math.cos(spark.angle);
          const sin = Math.sin(spark.angle);

          ctx.globalAlpha = Math.min(1, (1 - eased) * 2.2);
          ctx.strokeStyle = spark.color;
          ctx.beginPath();
          ctx.moveTo(spark.x + distance * cos, spark.y + distance * sin);
          ctx.lineTo(spark.x + (distance + length) * cos, spark.y + (distance + length) * sin);
          ctx.stroke();

          return true;
        });

        ctx.globalAlpha = 1;
      },

      stop() {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('pointerdown', onPointerDown);
        clearTimeout(resizeTimer);
        if (canvas) canvas.remove();
        canvas = null;
        ctx = null;
        sparks = [];
        painted = false;
      },
    };
  })();


  /* ============================================ shared: painting the page */

  /* Both the scroll dust and the page transition need the page redrawn into
     a canvas so it can be sampled into grains. The DOM has already done the
     hard part — it knows where every word sits, in what font, at what weight
     — so this just replays that with fillText, drawImage and roundRect. */

  const collectSources = () => {
    const list = textGrid.words().map((word) => ({ el: word.el, kind: 'text', word }));

    for (const img of document.querySelectorAll('img')) {
      if (img.closest('.preview')) continue;
      list.push({ el: img, kind: 'image', word: null });
    }

    // Surfaces with a fill of their own: cards, figure frames, the rule.
    for (const box of document.querySelectorAll('.card, .figure-frame, .rule')) {
      list.push({ el: box, kind: 'box', word: null });
    }

    return list;
  };

  const paintSources = (ctx, sources, top, height) => {
    const offset = window.scrollY;
    const bottom = top + height;
    ctx.textBaseline = 'alphabetic';

    // Boxes first, then pictures, then type — the page's own paint order.
    for (const pass of ['box', 'image', 'text']) {
      for (const entry of sources) {
        if (entry.kind !== pass) continue;
        const rect = entry.el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const y = rect.top + offset;
        if (y + rect.height < top || y > bottom) continue;

        const dy = y - top;
        const style = getComputedStyle(entry.el);

        if (pass === 'box') {
          const fill = style.backgroundColor;
          if (!fill || fill === 'rgba(0, 0, 0, 0)' || fill === 'transparent') continue;
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.roundRect(rect.left, dy, rect.width, rect.height, parseFloat(style.borderRadius) || 0);
          ctx.fill();
          continue;
        }

        if (pass === 'image') {
          try {
            ctx.drawImage(entry.el, rect.left, dy, rect.width, rect.height);
          } catch { /* not decoded yet */ }
          continue;
        }

        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.fillStyle = style.color;
        const metrics = ctx.measureText(entry.el.textContent);
        const ascent = metrics.fontBoundingBoxAscent || parseFloat(style.fontSize) * 0.8;
        const baseline = dy + (rect.height - (ascent + (metrics.fontBoundingBoxDescent || 0))) / 2 + ascent;
        ctx.fillText(entry.el.textContent, rect.left, baseline);

        // fillText draws no underline, and the word carries its own.
        if (style.textDecorationLine.includes('underline')) {
          ctx.fillStyle = style.textDecorationColor || style.color;
          ctx.fillRect(rect.left, baseline + 2, rect.width, 1);
        }
      }
    }
  };

  /* ================================================== effect: particle scroll */

  /* The idea from Canvas UI's <ParticleScroll />: everything below a
     formation line is dust, and it reassembles grain by grain as it scrolls
     up past that line.

     The original gets its grains from the page's *pixels* — it lays the DOM
     out inside a canvas via `layoutsubtree`, rasterises it with
     `drawElementImage`, and pushes that through a WebGL point shader. Both
     are experimental Chrome APIs behind a flag, undefined in every shipping
     browser, and the component silently degrades to doing nothing.

     So this rasterises the page itself. The DOM has already done the hard
     part — it knows where every word sits, in what font, at what weight — so
     each word is redrawn with fillText into an offscreen strip, the strip is
     sampled on a grid, and every opaque cell becomes a grain carrying that
     pixel's colour. The scatter, gravity, swirl, drift, stagger and settle
     maths are ported from the point shader. Grains are written into an
     ImageData buffer rather than stroked one by one: the cost is then
     proportional to grains rather than to draw calls. */

  const particleScroll = (() => {
    const POINT = 0.9;        // viewport fraction of the formation line
    const BAND = 130;         // px over which a row reassembles
    const DENSITY = 2;        // px between grains
    const SIZE = 1.25;        // grain size in px when fully scattered
    const SPREAD = 70;        // px a grain scatters from home
    const GRAVITY = 0.35;     // downward bias of the scattered cloud
    const DRIFT = 0.7;        // idle float speed while scattered
    const SWIRL = 60;         // px of sideways arc on the way home
    const STAGGER = 0.7;      // per-grain randomness of timing
    const FADE = 0.85;        // opacity when fully scattered
    const SETTLE = 1.2;       // seconds a row takes to condense
    const SMOOTHING = 0.6;    // seconds the damped scroll lags the real one

    const ALPHA_MIN = 24;     // ignore near-transparent pixels

    let canvas = null, ctx = null, image = null, buffer = null, pixels = null;
    let source = null, sctx = null;
    let sources = [];         // { el, kind, word }
    let stripTop = 0, stripHeight = 0, stripWidth = 0, stripValid = false;

    // Grains, in flat arrays: document-space home, colour, scatter vector.
    let gx, gy, gr, gg, gb, ga, gDelay, gOffX, gOffY, gSwX, gSwY, gDrA, gDrB, gPhA, gPhB;
    let gJx, gJy, gLagK;
    let grains = 0;

    let rows = null;          // progress per document row
    let override = null;      // per-row progress, shared across each element
    let scrollSmooth = 0, time = 0, last = 0, lag = 0, lastScroll = 0;
    let observer = null, remeasure = 0;
    let shown = new Map();  // last opacity written per element

    const smoothstep = (a, b, x) => {
      const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
      return t * t * (3 - 2 * t);
    };

    const hash = (n) => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
      return x - Math.floor(x);
    };

    /* ----- what there is to rasterise ----- */

    const collect = () => { sources = collectSources(); };

    /* ----- draw the page into an offscreen strip ----- */

    const rasterise = (top, height) => {
      const width = document.documentElement.clientWidth;
      if (!source) {
        source = document.createElement('canvas');
        sctx = source.getContext('2d', { willReadFrequently: true });
      }
      if (source.width !== width || source.height !== height) {
        source.width = width;
        source.height = height;
      }

      sctx.clearRect(0, 0, width, height);
      paintSources(sctx, sources, top, height);

      stripTop = top;
      stripHeight = height;
      stripWidth = width;
      extract();
      stripValid = true;
    };

    /* ----- sample the strip into grains ----- */

    const extract = () => {
      const data = sctx.getImageData(0, 0, stripWidth, stripHeight).data;
      const cols = Math.floor(stripWidth / DENSITY);
      const lines = Math.floor(stripHeight / DENSITY);
      const cap = cols * lines;

      if (!gx || gx.length < cap) {
        gx = new Float32Array(cap); gy = new Float32Array(cap);
        gr = new Uint8Array(cap); gg = new Uint8Array(cap); gb = new Uint8Array(cap);
        ga = new Uint8Array(cap);
        gDelay = new Float32Array(cap);
        gOffX = new Float32Array(cap); gOffY = new Float32Array(cap);
        gSwX = new Float32Array(cap); gSwY = new Float32Array(cap);
        gDrA = new Float32Array(cap); gDrB = new Float32Array(cap);
        gPhA = new Float32Array(cap); gPhB = new Float32Array(cap);
        gJx = new Float32Array(cap); gJy = new Float32Array(cap);
        gLagK = new Float32Array(cap);
      }

      grains = 0;
      const half = (DENSITY / 2) | 0;

      for (let row = 0; row < lines; row++) {
        const top = row * DENSITY;

        for (let col = 0; col < cols; col++) {
          const left = col * DENSITY;

          // The strongest pixel in the cell, not its centre sample: a thin
          // glyph stem mostly lands on partial coverage, and centre-sampling
          // turns solid type into pale speckle.
          let i = 0;
          let a = 0;
          for (let cy = 0; cy < DENSITY; cy++) {
            const base = (top + cy) * stripWidth * 4;
            for (let cx = 0; cx < DENSITY; cx++) {
              const at = base + (left + cx) * 4;
              if (data[at + 3] > a) { a = data[at + 3]; i = at; }
            }
          }
          if (a < ALPHA_MIN) continue;

          const docX = left + half;
          const docY = stripTop + top + half;

          // Hashed on the document-space cell, so a grain keeps its own
          // scatter no matter when the strip was last rasterised.
          const key = docX * 0.618 + docY * 1.414;
          const h1 = hash(key);
          const h2 = hash(key + 1.7);
          const h3 = hash(key + 5.5);
          const h4 = hash(key + 8.4);

          let dirX = h2 - 0.5;
          let dirY = h3 - 0.5;
          const len = Math.hypot(dirX, dirY) || 1;
          dirX /= len; dirY /= len;
          const reach = 0.08 + 0.92 * h4 ** 2.4;

          const n = grains++;
          gx[n] = docX; gy[n] = docY;
          gr[n] = data[i]; gg[n] = data[i + 1]; gb[n] = data[i + 2]; ga[n] = a;
          gDelay[n] = h1 * STAGGER;
          gOffX[n] = dirX * SPREAD * reach;
          gOffY[n] = dirY * SPREAD * reach + GRAVITY * SPREAD * (0.25 + 0.75 * h4);
          gSwX[n] = -dirY * (h2 - 0.5) * 2 * SWIRL;
          gSwY[n] = dirX * (h2 - 0.5) * 2 * SWIRL;
          gDrA[n] = 4 + 5 * h2; gDrB[n] = 3.5 + 5.5 * h3;
          gPhA[n] = h3 * 40; gPhB[n] = h2 * 40;
          gJx[n] = (h4 - 0.5) * DENSITY * 3;
          gJy[n] = (h1 - 0.5) * DENSITY * 3;
          gLagK[n] = 0.5 + 0.5 * h4;
        }
      }
    };

    const sizeCanvas = () => {
      const w = document.documentElement.clientWidth;
      const h = document.documentElement.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        image = ctx.createImageData(w, h);
        pixels = image.data;                       // per-channel, for blending
        buffer = new Uint32Array(pixels.buffer);   // one word per pixel, for clearing
      }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    const invalidate = () => {
      clearTimeout(remeasure);
      remeasure = setTimeout(() => { stripValid = false; sizeCanvas(); }, 120);
    };

    const rowCount = () => Math.ceil(document.documentElement.scrollHeight / DENSITY) + 2;

    return {
      start() {
        if (reduceMotion.matches) return;

        canvas = document.createElement('canvas');
        canvas.className = 'fx-dust';
        canvas.setAttribute('aria-hidden', 'true');
        ctx = canvas.getContext('2d');
        document.body.append(canvas);
        sizeCanvas();

        collect();
        rows = new Float32Array(rowCount()).fill(1); // start assembled, then crumble
        scrollSmooth = window.scrollY;
        lastScroll = window.scrollY;
        last = performance.now();

        observer = new ResizeObserver(invalidate);
        observer.observe(document.body);
        window.addEventListener('resize', invalidate);
      },

      frame() {
        if (!ctx || !sources.length) return;

        const now = performance.now();
        const dt = Math.min((now - last) / 1000, 1 / 30);
        last = now;
        time += dt;

        const width = canvas.width;
        const height = canvas.height;
        const scroll = window.scrollY;

        // Damped scroll: the cloud lags the page, which is most of why it
        // reads as something physical rather than a scroll-linked tween.
        const k = SMOOTHING <= 0 ? 1 : 1 - Math.exp(-dt / SMOOTHING);
        scrollSmooth += (scroll - scrollSmooth) * k;
        if (Math.abs(scroll - scrollSmooth) < 0.5) scrollSmooth = scroll;

        lag += scroll - lastScroll;
        lastScroll = scroll;
        lag *= Math.exp(-dt / 0.22);
        lag = Math.min(Math.max(lag, -400), 400);
        if (Math.abs(lag) < 0.1) lag = 0;

        if (rows.length !== rowCount()) {
          const next = new Float32Array(rowCount()).fill(1);
          next.set(rows.subarray(0, Math.min(rows.length, next.length)));
          rows = next;
        }

        // Near the end of the document the line drops past the bottom, so
        // the last screenful can finish assembling instead of being stranded.
        const max = document.documentElement.scrollHeight - height;
        let line = POINT * height;
        if (max <= 1) {
          line = height + BAND;
        } else {
          const endP = Math.min(Math.max((scrollSmooth - (max - height * 0.5)) / (height * 0.5), 0), 1);
          line += (height + BAND - line) * endP * endP;
        }

        // Only the zone that actually produces grains gets rasterised:
        // everything above the formation line is settled and drawn by the
        // page itself. That is a ~650px window rather than the whole
        // viewport, which is what makes a re-cut affordable. The strip then
        // carries 500px of slack either way, so scrolling re-cuts it about
        // once a screen rather than once a frame.
        const docHeight = document.documentElement.scrollHeight;
        const needTop = Math.max(0, scroll + line - BAND * 0.5);
        const needBottom = Math.min(docHeight, scroll + height + SPREAD);

        if (!stripValid || needTop < stripTop || needBottom > stripTop + stripHeight) {
          const slack = 500;
          const top = Math.max(0, needTop - slack);
          rasterise(top, Math.ceil(Math.min(needBottom + slack, docHeight) - top));
        }

        const up = dt / SETTLE;
        const down = dt / (SETTLE * 0.6);
        const first = Math.max(0, Math.floor((scroll - BAND) / DENSITY));
        const stop = Math.min(rows.length, Math.ceil((scroll + height + BAND) / DENSITY));

        for (let r = first; r < stop; r++) {
          const vy = (r + 0.5) * DENSITY - scrollSmooth;
          const target = Math.min(Math.max((line + BAND - vy) / BAND, 0), 1);
          const p = rows[r];
          if (p < target) rows[r] = Math.min(p + up, target);
          else if (p > target) rows[r] = Math.max(p - down, target);
        }

        // An element and the grains that came from it share one progress
        // value, taken at its middle row. Letting each row run on its own
        // schedule is what produced the blocky stage: rows that had landed
        // were rebuilt at grain resolution while the element stayed hidden
        // for the rows that hadn't. Locked together, an element is either
        // dust or itself, and the two cross-fade.
        if (!override || override.length !== rows.length) override = new Float32Array(rows.length);
        override.fill(1);

        for (const entry of sources) {
          const rect = entry.el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;

          const top = rect.top + scroll;
          const firstRow = Math.max(0, (top / DENSITY) | 0);
          const lastRow = Math.min(rows.length - 1, ((top + rect.height) / DENSITY) | 0);
          // Taken at the element's TOP, not its middle. An element dissolves
          // as one unit, so reading the middle meant a tall figure whose
          // centre had crossed the line took its whole body with it —
          // throwing dust far above the line. Reading the top means nothing
          // starts dissolving until it is wholly past the line.
          const p = rows[Math.min(rows.length - 1, (top / DENSITY) | 0)];

          for (let r = firstRow; r <= lastRow; r++) {
            if (p < override[r]) override[r] = p;
          }

          if (entry.word) entry.word.settled = p >= 0.9995;

          // Fades in exactly as its dust fades out, so the low-resolution
          // rebuild in between is never the thing you're looking at.
          const visible = smoothstep(0.72, 1, p);
          const quantised = Math.round(visible * 20) / 20;
          if (shown.get(entry.el) === quantised) continue;
          shown.set(entry.el, quantised);
          entry.el.style.opacity = quantised >= 1 ? '' : `${quantised}`;
        }

        buffer.fill(0);

        const tt = time * DRIFT;
        let painted = 0;

        for (let n = 0; n < grains; n++) {
          const home = gy[n];
          const r = (home / DENSITY) | 0;
          const p = r < rows.length ? override[r] : 1;
          const delay = gDelay[n];
          const t = Math.min(Math.max((p - delay) / Math.max(1 - delay, 1e-3), 0), 1);
          const dust = 1 - smoothstep(0.72, 1, t);
          if (dust <= 0.004) continue; // the page is drawing this one now

          const e = 1 - (1 - t) ** 3;
          const rest = 1 - e;
          const arc = Math.sin(e * Math.PI);
          const amp = rest * (SPREAD * 0.05 + 2.5);
          const jitter = 1 - smoothstep(0.5, 0.85, t);

          const x = gx[n] + gOffX[n] * rest + gSwX[n] * arc
            + Math.sin(tt * gDrA[n] + gPhA[n]) * amp
            + gJx[n] * jitter;
          const y = home - scroll + gOffY[n] * rest + gSwY[n] * arc
            + Math.cos(tt * gDrB[n] + gPhB[n]) * amp
            + gJy[n] * jitter
            + lag * rest * gLagK[n];

          if (x < -4 || y < -4 || x >= width + 4 || y >= height + 4) continue;

          const alpha = (ga[n] / 255) * (FADE + (1 - FADE) * e) * dust;
          if (alpha < 0.004) continue;

          // Grains stay round and grain-sized the whole way. The shader grows
          // them to `density * 1.3` and squares them off so they tile back
          // into the source image — which is precisely the chunky low-res
          // stage to avoid here. The element itself fades back in instead.
          const side = SIZE;
          const merge = 0;
          const radius = side / 2;
          const cxp = x + radius;
          const cyp = y + radius;
          const half = Math.ceil(radius);
          const cr = gr[n], cg = gg[n], cb = gb[n];

          for (let dy = -half; dy <= half; dy++) {
            const py = (cyp + dy) | 0;
            if (py < 0 || py >= height) continue;
            const row4 = py * width;

            for (let dx = -half; dx <= half; dx++) {
              const pxx = (cxp + dx) | 0;
              if (pxx < 0 || pxx >= width) continue;

              const dist = Math.sqrt(dx * dx + dy * dy) / side;
              const circle = 1 - smoothstep(0.25, 0.5, dist);
              const cover = circle + (1 - circle) * merge;
              const a = alpha * cover;
              if (a < 0.004) continue;

              const o = (row4 + pxx) * 4;
              const da = pixels[o + 3] / 255;

              if (da === 0) {
                pixels[o] = cr; pixels[o + 1] = cg; pixels[o + 2] = cb;
                pixels[o + 3] = a * 255;
              } else {
                const outA = a + da * (1 - a);
                const w1 = a / outA;
                const w2 = 1 - w1;
                pixels[o] = cr * w1 + pixels[o] * w2;
                pixels[o + 1] = cg * w1 + pixels[o + 1] * w2;
                pixels[o + 2] = cb * w1 + pixels[o + 2] * w2;
                pixels[o + 3] = outA * 255;
              }
            }
          }
          painted++;
        }

        ctx.putImageData(image, 0, 0);
        this.painted = painted;
      },

      stop() {
        clearTimeout(remeasure);
        if (observer) observer.disconnect();
        observer = null;
        window.removeEventListener('resize', invalidate);
        for (const el of shown.keys()) el.style.opacity = '';
        shown.clear();
        for (const entry of sources) if (entry.word) entry.word.settled = true;
        if (canvas) canvas.remove();
        canvas = null; ctx = null; image = null; buffer = null; pixels = null;
        source = null; sctx = null; sources = []; grains = 0; stripValid = false;
        rows = null; override = null;
      },
    };
  })();


  /* ========================================================= effect: cloth */

  /* Ported from Canvas UI's <Cloth />, hung on the Work preview.

     This one ports faithfully rather than being reinterpreted: the component
     needs `drawElementImage` only because it wraps arbitrary live HTML, and
     the preview's content is a single image. An <img> uploads straight to
     WebGL with texImage2D, so the experimental API isn't needed at all. The
     simulation and both shaders are the originals.

     Two adaptations: the two crossfading preview layers are composited into
     one texture so a swap still dissolves, and the brush rides the pointer's
     y down the cloth's leading edge — your cursor is over the row list on
     the left, never over the preview itself, so a literal hit test would
     mean the fabric was never touched. */

  const clothPreview = (() => {
    const PIN = 'top';
    const WIND = 3;
    const SPEED = 0.5;
    const AMPLITUDE = 30;
    const DRAPE = 40;
    const BRUSH = 2.05;
    const BRUSH_SIZE = 150;
    const DAMPING = 1;
    const LIGHT = 0.5;
    const SHEEN = 0.1;
    const SHADOW = 0.25;
    const CORNER_RADIUS = 20;
    const PERSPECTIVE = 1200;

    const SEG = 96;
    const NODES = SEG + 1;
    const DT = 1 / 120;
    const WAVE_SPEED = 30;
    const STIFFNESS = 0.55;
    const FORCE_GAIN = 5.0;
    const BLEED = 48;

    const SDF = `
float fabricDist (vec2 p, vec2 size, float radius) {
  vec2 half_ = size * 0.5;
  float r = min(radius, min(half_.x, half_.y));
  vec2 q = abs(p - half_) - (half_ - vec2(r));
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}`;

    const CLOTH_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aGrid;
layout(location = 1) in vec4 aData;
layout(location = 2) in vec2 aOffset;
uniform vec2 uRes; uniform vec2 uOut; uniform float uBleed; uniform float uFocal;
out vec2 vUv; out vec3 vNormal; out float vFold; out vec2 vLocal;
void main () {
  vUv = aGrid;
  float z = aData.x;
  vec2 nxy = aData.yz;
  vNormal = vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.04)));
  vFold = aData.w;
  vLocal = aGrid * uRes;
  vec2 px = vLocal + aOffset + vec2(uBleed);
  vec2 ndc = (px / uOut) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  float w = (uFocal - z) / uFocal;
  gl_Position = vec4(ndc, -z / uFocal, w);
}`;

    const CLOTH_FRAG = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vNormal; in float vFold; in vec2 vLocal;
out vec4 outColor;
uniform sampler2D uContent; uniform float uMaxX; uniform float uLight;
uniform float uSheen; uniform vec3 uBacking; uniform vec2 uRes;
uniform float uRadius; uniform float uDark;
${SDF}
void main () {
  vec2 uv = clamp(vUv, vec2(0.001), vec2(uMaxX - 0.001, 0.999));
  vec4 tex = texture(uContent, uv);
  vec3 fabric = mix(uBacking, tex.rgb, tex.a);
  vec3 n = normalize(vNormal);
  vec3 lightDir = normalize(vec3(-0.3, 0.42, 0.86));
  float diffFlat = 0.58 + 0.42 * lightDir.z;
  float diff = 0.58 + 0.42 * dot(n, lightDir);
  float shade = mix(1.0, (diff / diffFlat) * vFold, uLight);
  vec3 lit = fabric * shade;
  vec3 halfway = normalize(lightDir + vec3(0.0, 0.0, 1.0));
  float specFlat = pow(halfway.z, 34.0);
  float spec = max(pow(max(dot(n, halfway), 0.0), 34.0) - specFlat, 0.0) / (1.0 - specFlat);
  lit += uSheen * spec * mix(vec3(1.0), fabric, 0.35);
  float broadFlat = pow(halfway.z, 6.0);
  float broad = max(pow(max(dot(n, halfway), 0.0), 6.0) - broadFlat, 0.0) / (1.0 - broadFlat);
  lit += uDark * uLight * 0.3 * broad * vec3(1.0);
  float d = fabricDist(vLocal, uRes, uRadius);
  float hemT = smoothstep(0.0, 6.0, -d);
  lit *= mix(1.0, mix(0.93, 1.0, hemT), uLight * (1.0 - uDark));
  lit += vec3(uDark * uLight * 0.08 * (1.0 - hemT));
  float alpha = clamp(0.5 - d, 0.0, 1.0);
  outColor = vec4(clamp(lit, 0.0, 1.0), 1.0) * alpha;
}`;

    const SHADOW_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aGrid;
layout(location = 1) in vec4 aData;
layout(location = 2) in vec2 aOffset;
uniform vec2 uRes; uniform vec2 uOut; uniform float uBleed;
out vec2 vLocal; out float vLift;
void main () {
  float z = aData.x;
  vLift = z;
  vLocal = aGrid * uRes;
  vec2 px = vLocal + aOffset + vec2(uBleed) + vec2(10.0, 14.0) + vec2(0.3, 0.42) * z;
  vec2 ndc = (px / uOut) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

    const SHADOW_FRAG = `#version 300 es
precision highp float;
in vec2 vLocal; in float vLift;
out vec4 outColor;
uniform float uShadow; uniform vec2 uRes; uniform float uRadius; uniform float uDark;
${SDF}
void main () {
  float d = fabricDist(vLocal, uRes, uRadius);
  float a = uShadow * smoothstep(0.0, 30.0, -d);
  a *= mix(1.0, 0.55, clamp(vLift / 50.0, 0.0, 1.0));
  a *= mix(1.0, 0.55, uDark);
  outColor = vec4(vec3(uDark) * a, a);
}`;

    let preview = null, frame = null, layers = [];
    let canvas = null, gl = null, cloth = null, shadowProg = null;
    let vao = null, gridBuffer = null, dataBuffer = null, offsetBuffer = null, indexBuffer = null;
    let texture = null, compo = null, cctx = null;
    let indexCount = 0;

    let hCur, hPrev, hNext, vertexData, offsetData, zField, rowForce, colForce, hangCurve;
    let simTime = Math.random() * 60;
    let gust = 0.5;
    let lastFrame = 0, simDebt = 0;
    let backing = [1, 1, 1];
    let signature = '';
    let observer = null;
    const bitmaps = new Map();  // rasterised previews, one per src

    const pointer2 = { x: -1e5, y: -1e5, inside: false };
    const touch = { x: -1e5, y: -1e5, vx: 0, vy: 0, s: 0 };

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('Cloth shader:', gl.getShaderInfoLog(sh));
      }
      return sh;
    };

    const link = (vertSrc, fragSrc) => {
      const vert = compile(gl.VERTEX_SHADER, vertSrc);
      const frag = compile(gl.FRAGMENT_SHADER, fragSrc);
      const program = gl.createProgram();
      gl.attachShader(program, vert);
      gl.attachShader(program, frag);
      gl.linkProgram(program);
      const uniforms = {};
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(program, i);
        uniforms[info.name] = gl.getUniformLocation(program, info.name);
      }
      return { program, vert, frag, uniforms };
    };

    const axisFor = (x, y) => (PIN === 'top' ? [y, x] : [x, y]);

    const stepSim = (dt) => {
      simTime += dt * SPEED;
      const t = simTime;
      const windAmp = FORCE_GAIN * WIND * gust;
      const kb1 = (Math.PI * 2) / (SEG / 1.5);
      const kb2 = (Math.PI * 2) / (SEG / 3.8);
      const ka = (Math.PI * 2) / (SEG / 2.2);
      const w1 = WAVE_SPEED * kb1;
      const w2 = WAVE_SPEED * kb2;
      const drift = 1.8 * Math.sin(0.23 * t);

      for (let b = 0; b < NODES; b++) {
        rowForce[b] = Math.sin(kb1 * b - w1 * t + drift) + 0.45 * Math.sin(kb2 * b + w2 * t * 0.8 + 3.0);
      }
      for (let a = 0; a < NODES; a++) {
        colForce[a] = (0.7 + 0.3 * Math.sin(ka * a - 1.7 * t)) * hangCurve[a];
      }

      const c2 = WAVE_SPEED * WAVE_SPEED;
      const dt2 = dt * dt;
      const decay = Math.exp(-DAMPING * dt);

      for (let y = 0; y < NODES; y++) {
        const up = Math.max(y - 1, 0) * NODES;
        const down = Math.min(y + 1, SEG) * NODES;
        const row = y * NODES;
        for (let x = 0; x < NODES; x++) {
          const i = row + x;
          const l = row + Math.max(x - 1, 0);
          const r = row + Math.min(x + 1, SEG);
          const h = hCur[i];
          const lap = hCur[l] + hCur[r] + hCur[up + x] + hCur[down + x] - 4 * h;
          const [a, b] = axisFor(x, y);
          const acc = c2 * lap - STIFFNESS * h + windAmp * rowForce[b] * colForce[a];
          const next = 2 * h - hPrev[i] + dt2 * acc;
          let value = h + (next - h) * decay;
          if (value > 3.5) value = 3.5;
          else if (value < -3.5) value = -3.5;
          hNext[i] = value;
        }
      }

      for (let b = 0; b < NODES; b++) hNext[b] = 0; // pinned top edge

      const spent = hPrev;
      hPrev = hCur;
      hCur = hNext;
      hNext = spent;
    };

    const touchImprint = (delta, width, height) => {
      if (BRUSH <= 0 || touch.s < 0.01) return;
      const cellW = width / SEG;
      const cellH = height / SEG;
      const rx = BRUSH_SIZE / cellW;
      const ry = BRUSH_SIZE / cellH;
      const gx = touch.x / cellW;
      const gy = touch.y / cellH;
      const bx0 = Math.max(Math.ceil(gx - 2.5 * rx), 0);
      const bx1 = Math.min(Math.floor(gx + 2.5 * rx), SEG);
      const by0 = Math.max(Math.ceil(gy - 2.5 * ry), 0);
      const by1 = Math.min(Math.floor(gy + 2.5 * ry), SEG);
      const lift = 1.1 * Math.min(BRUSH, 3) * touch.s;
      const rate = Math.min(delta * 4, 1);

      for (let y = by0; y <= by1; y++) {
        const oy = (y - gy) / ry;
        const row = y * NODES;
        for (let x = bx0; x <= bx1; x++) {
          const ox = (x - gx) / rx;
          const g = Math.exp(-(ox * ox + oy * oy));
          if (g < 0.02) continue;
          const i = row + x;
          const pull = rate * g;
          const goal = lift * g;
          hCur[i] += (goal - hCur[i]) * pull;
          hPrev[i] += (goal - hPrev[i]) * pull;
        }
      }
    };

    const foreshorten = (axisStride, lineStride, ds, anchor, comp) => {
      const ds2 = ds * ds;
      for (let l = 0; l < NODES; l++) {
        const base = l * lineStride;
        offsetData[(base + anchor * axisStride) * 2 + comp] = 0;
        let cum = 0;
        for (let k = anchor + 1; k < NODES; k++) {
          const i = base + k * axisStride;
          const dz = zField[i] - zField[i - axisStride];
          cum += ds - Math.sqrt(Math.max(ds2 - dz * dz, 0));
          offsetData[i * 2 + comp] = -cum;
        }
        cum = 0;
        for (let k = anchor - 1; k >= 0; k--) {
          const i = base + k * axisStride;
          const dz = zField[i] - zField[i + axisStride];
          cum += ds - Math.sqrt(Math.max(ds2 - dz * dz, 0));
          offsetData[i * 2 + comp] = cum;
        }
      }
    };

    const composeVertices = (width, height) => {
      const drape = DRAPE * (0.3 + 0.7 * gust);
      const cellW = width / SEG;
      const cellH = height / SEG;

      for (let y = 0; y < NODES; y++) {
        const row = y * NODES;
        for (let x = 0; x < NODES; x++) {
          const i = row + x;
          const [a] = axisFor(x, y);
          zField[i] = AMPLITUDE * Math.tanh(hCur[i]) + drape * hangCurve[a];
        }
      }

      for (let y = 0; y < NODES; y++) {
        const up = Math.max(y - 1, 0) * NODES;
        const down = Math.min(y + 1, SEG) * NODES;
        const row = y * NODES;
        for (let x = 0; x < NODES; x++) {
          const i = row + x;
          const l = row + Math.max(x - 1, 0);
          const r = row + Math.min(x + 1, SEG);
          const dzdx = (zField[r] - zField[l]) / (2 * cellW);
          const dzdy = (zField[down + x] - zField[up + x]) / (2 * cellH);
          const inv = 1 / Math.hypot(dzdx, dzdy, 1);
          const curve = zField[l] + zField[r] + zField[up + x] + zField[down + x] - 4 * zField[i];
          let fold = 1 - curve * 0.01;
          if (fold < 0.86) fold = 0.86;
          else if (fold > 1.06) fold = 1.06;
          const o = i * 4;
          vertexData[o] = zField[i];
          vertexData[o + 1] = -dzdx * inv;
          vertexData[o + 2] = -dzdy * inv;
          vertexData[o + 3] = fold;
        }
      }

      foreshorten(NODES, 1, cellH, 0, 1);
      foreshorten(1, NODES, cellW, SEG >> 1, 0);
    };

    // Each preview is rasterised once and kept. Re-rasterising an SVG is the
    // expensive part, and the frame morphs its size on every swap — pinning
    // the texture to the image's own resolution rather than the frame's
    // keeps a morph from re-rasterising on every frame of it.
    const bitmapFor = (img) => {
      const src = img.getAttribute('src');
      if (!src) return null;
      const cached = bitmaps.get(src);
      if (cached) return cached;
      if (!img.naturalWidth) return null;

      const scale = Math.min(1024 / Math.max(img.naturalWidth, img.naturalHeight), 1);
      const bitmap = document.createElement('canvas');
      bitmap.width = Math.max(1, Math.round(img.naturalWidth * scale));
      bitmap.height = Math.max(1, Math.round(img.naturalHeight * scale));
      bitmap.getContext('2d').drawImage(img, 0, 0, bitmap.width, bitmap.height);
      bitmaps.set(src, bitmap);
      return bitmap;
    };

    // The two crossfading layers become one texture, so swapping previews
    // still dissolves rather than cutting.
    const uploadTexture = () => {
      const parts = [];
      for (const layer of layers) {
        const img = layer.querySelector('img');
        const alpha = parseFloat(getComputedStyle(layer).opacity) || 0;
        if (alpha < 0.01) continue;
        const bitmap = bitmapFor(img);
        if (!bitmap) continue;
        parts.push({ bitmap, alpha, on: layer.hasAttribute('data-on') });
      }
      if (!parts.length) return;

      const next = parts.map((p) => `${p.bitmap.width}x${p.bitmap.height}@${p.alpha.toFixed(2)}`).join('|');
      if (next === signature) return;
      signature = next;

      const lead = parts.find((p) => p.on) || parts[0];
      compo.width = lead.bitmap.width;
      compo.height = lead.bitmap.height;
      cctx.clearRect(0, 0, compo.width, compo.height);

      for (const part of parts) {
        // cover-fit, matching how the layers sit in the frame
        const scale = Math.max(compo.width / part.bitmap.width, compo.height / part.bitmap.height);
        const w = part.bitmap.width * scale;
        const h = part.bitmap.height * scale;
        cctx.globalAlpha = part.alpha;
        cctx.drawImage(part.bitmap, (compo.width - w) / 2, (compo.height - h) / 2, w, h);
      }
      cctx.globalAlpha = 1;

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, compo);
    };

    let probeCtx = null;

    const syncBacking = () => {
      const css = getComputedStyle(root).getPropertyValue('--bg').trim() || '#fff';
      if (!probeCtx) {
        const probe = document.createElement('canvas');
        probe.width = probe.height = 1;
        probeCtx = probe.getContext('2d', { willReadFrequently: true });
      }
      const pctx = probeCtx;
      pctx.fillStyle = css;
      pctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
      backing = [r / 255, g / 255, b / 255];
    };

    const sizeCanvas = (width, height) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round((width + BLEED * 2) * dpr));
      const h = Math.max(1, Math.round((height + BLEED * 2) * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    return {
      start() {
        if (reduceMotion.matches) return;

        preview = document.querySelector('.preview');
        frame = preview && preview.querySelector('.preview-frame');
        if (!frame) return;
        layers = [...preview.querySelectorAll('.preview-layer')];

        canvas = document.createElement('canvas');
        canvas.className = 'fx-cloth';
        canvas.setAttribute('aria-hidden', 'true');
        gl = canvas.getContext('webgl2', {
          alpha: true, depth: false, stencil: false,
          antialias: true, premultipliedAlpha: true,
        });
        if (!gl) { canvas = null; return; }
        preview.append(canvas);
        preview.setAttribute('data-cloth', '');

        cloth = link(CLOTH_VERT, CLOTH_FRAG);
        shadowProg = link(SHADOW_VERT, SHADOW_FRAG);

        const grid = new Float32Array(NODES * NODES * 2);
        for (let y = 0; y < NODES; y++) {
          for (let x = 0; x < NODES; x++) {
            const i = (y * NODES + x) * 2;
            grid[i] = x / SEG;
            grid[i + 1] = y / SEG;
          }
        }
        const indices = new Uint32Array(SEG * SEG * 6);
        let o = 0;
        for (let y = 0; y < SEG; y++) {
          for (let x = 0; x < SEG; x++) {
            const a = y * NODES + x, b = a + 1, c = a + NODES, d = c + 1;
            indices[o++] = a; indices[o++] = c; indices[o++] = b;
            indices[o++] = b; indices[o++] = c; indices[o++] = d;
          }
        }
        indexCount = indices.length;

        vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gridBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        dataBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, dataBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, NODES * NODES * 16, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        offsetBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, NODES * NODES * 8, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
        indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
        gl.bindVertexArray(null);

        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

        compo = document.createElement('canvas');
        cctx = compo.getContext('2d');

        hCur = new Float32Array(NODES * NODES);
        hPrev = new Float32Array(NODES * NODES);
        hNext = new Float32Array(NODES * NODES);
        vertexData = new Float32Array(NODES * NODES * 4);
        offsetData = new Float32Array(NODES * NODES * 2);
        zField = new Float32Array(NODES * NODES);
        rowForce = new Float32Array(NODES);
        colForce = new Float32Array(NODES);
        hangCurve = new Float32Array(NODES);
        for (let a = 0; a < NODES; a++) hangCurve[a] = (a / SEG) ** 1.3;

        lastFrame = performance.now();
        syncBacking();
        observer = new MutationObserver(syncBacking);
        observer.observe(root, { attributes: true, attributeFilter: ['data-fx', 'style', 'class'] });
      },

      frame() {
        if (!gl || !preview.hasAttribute('data-visible')) {
          lastFrame = performance.now();
          return;
        }

        const width = Math.max(frame.clientWidth, 1);
        const height = Math.max(frame.clientHeight, 1);
        const now = performance.now();
        const delta = Math.min((now - lastFrame) / 1000, 1 / 20);
        lastFrame = now;

        sizeCanvas(width, height);
        uploadTexture();

        const t = simTime;
        const target = Math.max(
          0.55 + 0.35 * Math.sin(t * 0.31 + 1.3) + 0.25 * Math.sin(t * 0.83) * (0.5 + 0.5 * Math.sin(t * 0.17)),
          0.15
        );
        gust += (target - gust) * Math.min(delta * 2, 1);

        // The cursor lives over the row list, never over the preview, so the
        // brush rides its y down the cloth's leading edge instead.
        const box = frame.getBoundingClientRect();
        pointer2.inside = pointer.y > box.top - 200 && pointer.y < box.bottom + 200;
        pointer2.x = width * 0.12;
        pointer2.y = Math.min(Math.max(pointer.y - box.top, 0), height);

        const sTarget = pointer2.inside ? 1 : 0;
        touch.s += (sTarget - touch.s) * Math.min(delta * (pointer2.inside ? 8 : 2.5), 1);

        const omega = 14;
        touch.vx += ((pointer2.x - touch.x) * omega * omega - 2 * omega * touch.vx) * delta;
        touch.vy += ((pointer2.y - touch.y) * omega * omega - 2 * omega * touch.vy) * delta;
        touch.x += touch.vx * delta;
        touch.y += touch.vy * delta;
        touchImprint(delta, width, height);

        simDebt = Math.min(simDebt + delta, DT * 5);
        while (simDebt >= DT) {
          stepSim(DT);
          simDebt -= DT;
        }

        composeVertices(width, height);

        const outW = width + BLEED * 2;
        const outH = height + BLEED * 2;
        const lum = 0.299 * backing[0] + 0.587 * backing[1] + 0.114 * backing[2];
        const dark = Math.min(Math.max((0.5 - lum) / 0.35, 0), 1);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, dataBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertexData);
        gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, offsetData);

        gl.useProgram(shadowProg.program);
        gl.uniform2f(shadowProg.uniforms.uRes, width, height);
        gl.uniform2f(shadowProg.uniforms.uOut, outW, outH);
        gl.uniform1f(shadowProg.uniforms.uBleed, BLEED);
        gl.uniform1f(shadowProg.uniforms.uShadow, SHADOW);
        gl.uniform1f(shadowProg.uniforms.uRadius, CORNER_RADIUS);
        gl.uniform1f(shadowProg.uniforms.uDark, dark);
        gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);

        gl.useProgram(cloth.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(cloth.uniforms.uContent, 0);
        gl.uniform2f(cloth.uniforms.uRes, width, height);
        gl.uniform2f(cloth.uniforms.uOut, outW, outH);
        gl.uniform1f(cloth.uniforms.uBleed, BLEED);
        gl.uniform1f(cloth.uniforms.uFocal, PERSPECTIVE);
        gl.uniform1f(cloth.uniforms.uMaxX, 1);
        gl.uniform1f(cloth.uniforms.uLight, LIGHT);
        gl.uniform1f(cloth.uniforms.uSheen, SHEEN);
        gl.uniform1f(cloth.uniforms.uRadius, CORNER_RADIUS);
        gl.uniform1f(cloth.uniforms.uDark, dark);
        gl.uniform3f(cloth.uniforms.uBacking, backing[0], backing[1], backing[2]);
        gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
        gl.bindVertexArray(null);
      },

      stop() {
        if (observer) observer.disconnect();
        observer = null;
        if (preview) preview.removeAttribute('data-cloth');
        if (gl) {
          gl.deleteTexture(texture);
          for (const p of [cloth, shadowProg]) {
            if (!p) continue;
            gl.deleteProgram(p.program);
            gl.deleteShader(p.vert);
            gl.deleteShader(p.frag);
          }
          for (const b of [gridBuffer, dataBuffer, offsetBuffer, indexBuffer]) gl.deleteBuffer(b);
          gl.deleteVertexArray(vao);
        }
        if (canvas) canvas.remove();
        canvas = null; gl = null; cloth = null; shadowProg = null;
        texture = null; compo = null; cctx = null; signature = ''; bitmaps.clear();
        preview = null; frame = null; layers = [];
      },
    };
  })();


  /* ================================================== effect: page snap */

  /* Navigating turns the page to dust and rebuilds the next one out of it.

     Same grains as the scroll effect — the page is redrawn with fillText and
     sampled on a grid — but driven by one global clock instead of per-row
     scroll progress. A link click is intercepted, the page dissolves, and
     only then does the navigation happen; the next page arrives already
     hidden (an inline <head> script sets data-fx-snap before first paint)
     and assembles itself out of the same dust.

     Grains stay dust-sized the whole way and the page cross-fades underneath
     them, so there is never a moment where the canvas is showing a
     2px-resolution rebuild of the page. */

  const pageSnap = (() => {
    const OUT_MS = 540;
    const IN_MS = 700;
    const DENSITY = 2;
    const SIZE = 1.25;
    const SPREAD = 260;
    const GRAVITY = -0.5;   // negative: the dust lifts away
    const SWIRL = 70;
    const STAGGER = 0.6;
    const DRIFT = 0.9;
    const ALPHA_MIN = 24;
    const SWEEP = 0.65;     // how much of the delay is positional vs random

    let canvas = null, ctx = null, image = null, pixels = null, buffer = null;
    let source = null, sctx = null;
    let gx, gy, gr, gg, gb, ga, gDelay, gOffX, gOffY, gSwX, gSwY, gDrA, gDrB, gPhA, gPhB;
    let grains = 0;
    let phase = null;       // 'out' | 'in'
    let started = 0;
    let destination = null;
    let onClick = null;
    let stalled = 0;

    const hash = (n) => {
      const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
      return x - Math.floor(x);
    };

    const smooth = (a, b, x) => {
      const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
      return t * t * (3 - 2 * t);
    };

    const build = () => {
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;

      if (!source) {
        source = document.createElement('canvas');
        sctx = source.getContext('2d', { willReadFrequently: true });
      }
      source.width = width;
      source.height = height;
      sctx.clearRect(0, 0, width, height);
      paintSources(sctx, collectSources(), window.scrollY, height);

      const data = sctx.getImageData(0, 0, width, height).data;
      const cols = Math.floor(width / DENSITY);
      const lines = Math.floor(height / DENSITY);
      const cap = cols * lines;

      gx = new Float32Array(cap); gy = new Float32Array(cap);
      gr = new Uint8Array(cap); gg = new Uint8Array(cap); gb = new Uint8Array(cap);
      ga = new Uint8Array(cap);
      gDelay = new Float32Array(cap);
      gOffX = new Float32Array(cap); gOffY = new Float32Array(cap);
      gSwX = new Float32Array(cap); gSwY = new Float32Array(cap);
      gDrA = new Float32Array(cap); gDrB = new Float32Array(cap);
      gPhA = new Float32Array(cap); gPhB = new Float32Array(cap);
      grains = 0;

      const half = (DENSITY / 2) | 0;

      for (let row = 0; row < lines; row++) {
        const top = row * DENSITY;
        for (let col = 0; col < cols; col++) {
          const left = col * DENSITY;

          let at = 0;
          let a = 0;
          for (let cy = 0; cy < DENSITY; cy++) {
            const base = (top + cy) * width * 4;
            for (let cx = 0; cx < DENSITY; cx++) {
              const i = base + (left + cx) * 4;
              if (data[i + 3] > a) { a = data[i + 3]; at = i; }
            }
          }
          if (a < ALPHA_MIN) continue;

          const px = left + half;
          const py = top + half;
          const key = px * 0.618 + py * 1.414;
          const h1 = hash(key);
          const h2 = hash(key + 1.7);
          const h3 = hash(key + 5.5);
          const h4 = hash(key + 8.4);

          let dirX = h2 - 0.5;
          let dirY = h3 - 0.5;
          const len = Math.hypot(dirX, dirY) || 1;
          dirX /= len; dirY /= len;
          const reach = 0.08 + 0.92 * h4 ** 2.4;

          // Delay is mostly positional, so the page sweeps rather than
          // dissolving everywhere at once.
          const sweep = (px / width) * 0.45 + (py / height) * 0.55;

          const n = grains++;
          gx[n] = px; gy[n] = py;
          gr[n] = data[at]; gg[n] = data[at + 1]; gb[n] = data[at + 2]; ga[n] = a;
          gDelay[n] = STAGGER * (SWEEP * sweep + (1 - SWEEP) * h1);
          gOffX[n] = dirX * SPREAD * reach;
          gOffY[n] = dirY * SPREAD * reach + GRAVITY * SPREAD * (0.25 + 0.75 * h4);
          gSwX[n] = -dirY * (h2 - 0.5) * 2 * SWIRL;
          gSwY[n] = dirX * (h2 - 0.5) * 2 * SWIRL;
          gDrA[n] = 4 + 5 * h2; gDrB[n] = 3.5 + 5.5 * h3;
          gPhA[n] = h3 * 40; gPhB[n] = h2 * 40;
        }
      }

      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'fx-snap';
        canvas.setAttribute('aria-hidden', 'true');
        ctx = canvas.getContext('2d');
        document.body.append(canvas);
      }
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        image = ctx.createImageData(width, height);
        pixels = image.data;
        buffer = new Uint32Array(pixels.buffer);
      }
    };

    const clear = () => {
      clearTimeout(stalled);
      stalled = 0;
      if (canvas) canvas.remove();
      canvas = null; ctx = null; image = null; pixels = null; buffer = null;
      source = null; sctx = null; grains = 0; phase = null;
      root.removeAttribute('data-fx-snapping');
      root.style.removeProperty('--fx-snap-op');
    };

    const begin = (next, url) => {
      phase = next;
      destination = url || null;
      root.setAttribute('data-fx-snapping', '');
      root.style.setProperty('--fx-snap-op', next === 'out' ? '1' : '0');
      build();
      root.removeAttribute('data-fx-snap');   // the head script's hold
      started = performance.now();
    };

    return {
      start() {
        if (reduceMotion.matches) return;

        // Arriving from a snap, or from the back/forward buttons.
        //
        // The attribute is the good path: the inline <head> script sets it
        // before first paint, so the page never shows itself before
        // assembling. But a visitor can be holding a cached copy of the HTML
        // from before that script existed, and then the attribute never
        // arrives. Falling back to the flag itself means they still get the
        // transition — just with a frame of the page visible first, which
        // beats the effect silently not happening.
        let arriving = root.hasAttribute('data-fx-snap');
        try {
          if (!arriving && sessionStorage.getItem('fxsnap') === '1') arriving = true;
          sessionStorage.removeItem('fxsnap');
        } catch { /* private window */ }

        if (arriving) requestAnimationFrame(() => begin('in'));

        onClick = (event) => {
          if (phase || event.defaultPrevented) return;
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

          const link = event.target.closest('a[href]');
          if (!link || link.target === '_blank' || link.hasAttribute('download')) return;

          const raw = link.getAttribute('href');
          if (!raw || raw === '#' || raw.startsWith('#')) return;   // placeholder or same-page

          let url;
          try { url = new URL(link.href, location.href); } catch { return; }
          if (url.origin !== location.origin) return;
          if (url.pathname === location.pathname) return;           // same document

          event.preventDefault();
          try { sessionStorage.setItem('fxsnap', '1'); } catch { /* private window */ }

          // Warm the next page while this one dissolves, so the wait is
          // spent on the animation rather than after it.
          fetch(url.href, { credentials: 'same-origin' }).catch(() => {});

          begin('out', url.href);
        };

        document.addEventListener('click', onClick);
      },

      frame() {
        if (!phase || !ctx) return;

        const out = phase === 'out';
        const span = out ? OUT_MS : IN_MS;
        const t = Math.min((performance.now() - started) / span, 1);

        if (t >= 1) {
          if (out) {
            const url = destination;
            phase = null;

            // Deliberately NOT clear() here. clear() drops the --fx-snap-op
            // hold, which snaps the page back to full opacity — and the
            // navigation does not commit for another frame or more, so the
            // page flashes back into view before vanishing again. The page
            // is about to be replaced; leave it hidden.
            if (!url) { clear(); return; }

            // Unless the navigation never happens. Then give the page back.
            stalled = setTimeout(clear, 4000);
            location.href = url;
            return;
          }
          clear();
          return;
        }

        // The page itself cross-fades under the dust, so the canvas never has
        // to stand in for it at grain resolution.
        root.style.setProperty('--fx-snap-op', out
          ? (1 - smooth(0, 0.3, t)).toFixed(3)
          : smooth(0.72, 1, t).toFixed(3));

        const width = canvas.width;
        const height = canvas.height;
        buffer.fill(0);

        const tt = (performance.now() - started) / 1000 * DRIFT;

        for (let n = 0; n < grains; n++) {
          const delay = gDelay[n];
          const local = Math.min(Math.max((t - delay) / Math.max(1 - delay, 1e-3), 0), 1);
          // 'in' runs the same journey backwards
          const k = out ? local : 1 - local;

          // How far from home: 0 at home, 1 fully scattered.
          const away = 1 - (1 - k) ** 2.2;
          if (away <= 0.0001 && !out) continue;

          const arc = Math.sin((1 - away) * Math.PI);
          const amp = away * 6;

          const x = gx[n] + gOffX[n] * away + gSwX[n] * arc
            + Math.sin(tt * gDrA[n] + gPhA[n]) * amp;
          const y = gy[n] + gOffY[n] * away + gSwY[n] * arc
            + Math.cos(tt * gDrB[n] + gPhB[n]) * amp;

          if (x < -3 || y < -3 || x >= width + 3 || y >= height + 3) continue;

          // Visible once it has left the page behind, gone once it is spent.
          const alpha = (ga[n] / 255)
            * smooth(0, 0.22, out ? t : 1 - t)
            * (1 - smooth(0.55, 1, away));
          if (alpha < 0.004) continue;

          const cr = gr[n], cg = gg[n], cb = gb[n];
          const radius = SIZE / 2;
          const cxp = x + radius;
          const cyp = y + radius;
          const reach = Math.ceil(radius);

          for (let dy = -reach; dy <= reach; dy++) {
            const py = (cyp + dy) | 0;
            if (py < 0 || py >= height) continue;
            const rowBase = py * width;

            for (let dx = -reach; dx <= reach; dx++) {
              const pxx = (cxp + dx) | 0;
              if (pxx < 0 || pxx >= width) continue;

              const cover = 1 - smooth(0.25, 0.5, Math.sqrt(dx * dx + dy * dy) / SIZE);
              const a = alpha * cover;
              if (a < 0.004) continue;

              const o = (rowBase + pxx) * 4;
              const da = pixels[o + 3] / 255;
              if (da === 0) {
                pixels[o] = cr; pixels[o + 1] = cg; pixels[o + 2] = cb;
                pixels[o + 3] = a * 255;
              } else {
                const outA = a + da * (1 - a);
                const w1 = a / outA;
                const w2 = 1 - w1;
                pixels[o] = cr * w1 + pixels[o] * w2;
                pixels[o + 1] = cg * w1 + pixels[o + 1] * w2;
                pixels[o + 2] = cb * w1 + pixels[o + 2] * w2;
                pixels[o + 3] = outA * 255;
              }
            }
          }
        }

        ctx.putImageData(image, 0, 0);
      },

      stop() {
        if (onClick) document.removeEventListener('click', onClick);
        onClick = null;
        root.removeAttribute('data-fx-snap');
        clear();
      },
    };
  })();

  /* ============================================================== runner */

  const EFFECTS = [textGrid, pointerLight, variableProximity, clickSpark, particleScroll, clothPreview, pageSnap];

  let running = false;
  let rafId = 0;

  const loop = () => {
    for (const effect of EFFECTS) if (effect.frame) effect.frame();
    pointer.moved = false;
    rafId = requestAnimationFrame(loop);
  };

  const sync = () => {
    const on = root.hasAttribute('data-fx');
    if (on === running) return;
    running = on;

    if (on) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      for (const effect of EFFECTS) if (effect.start) effect.start();
      rafId = requestAnimationFrame(loop);
    } else {
      window.removeEventListener('pointermove', onPointerMove);
      cancelAnimationFrame(rafId);
      rafId = 0;
      for (let i = EFFECTS.length - 1; i >= 0; i--) {
        if (EFFECTS[i].stop) EFFECTS[i].stop();
      }
    }
  };

  new MutationObserver(sync).observe(root, {
    attributes: true,
    attributeFilter: ['data-fx'],
  });

  sync();
})();
