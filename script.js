/* =========================================================================
   Temuujin Batbold — portfolio
   Three behaviours: the section tabs, the row hover (glass + preview),
   and the Ulaanbaatar clock.
   ========================================================================= */

(() => {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /* --------------------------------------------------------- effects */

  // The attribute is already set (or not) by the inline script in <head>;
  // this only handles the button. effects.js watches the attribute itself.
  const fx = document.querySelector('.fx');

  if (fx) {
    const label = fx.querySelector('.fx-text');

    const render = () => {
      const on = document.documentElement.hasAttribute('data-fx');
      label.textContent = on ? 'Turn off effects' : 'Turn on effects';
    };

    fx.addEventListener('click', () => {
      const on = document.documentElement.toggleAttribute('data-fx');
      try {
        localStorage.setItem('fx', on ? 'on' : 'off');
      } catch { /* private window, blocked site data */ }
      render();
    });

    render();
  }

  // Assigned by the hover section below; called when a tab changes so the
  // glass and the preview never outlive the list they belong to.
  let clearHover = () => {};

  /* ------------------------------------------------------------- tabs */

  const tablist = document.querySelector('.tabs');

  if (tablist) {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const indicator = tablist.querySelector('.tab-indicator');
    const panelOf = (tab) => document.getElementById(tab.getAttribute('aria-controls'));

    const moveIndicator = (tab) => {
      indicator.style.setProperty('--x', `${tab.offsetLeft}px`);
      indicator.style.setProperty('--w', tab.offsetWidth);
    };

    // `animate` is false for keyboard navigation: arrow keys fire in quick
    // succession, and motion on a keyboard action only makes it feel slower.
    const select = (tab, { animate = true, focus = false, record = true } = {}) => {
      clearHover();

      // Kept in the URL rather than in history: switching tabs shouldn't
      // stack up entries, but an article's back link needs to know which
      // list it came from, and so does the browser's own Back button.
      if (record) {
        try {
          history.replaceState(null, '', `#${tab.id.replace('tab-', '')}`);
        } catch { /* file:// and the like */ }
      }

      for (const other of tabs) {
        const isActive = other === tab;
        const panel = panelOf(other);

        other.setAttribute('aria-selected', String(isActive));
        other.tabIndex = isActive ? 0 : -1;
        if (panel) panel.hidden = !isActive;
      }

      const panel = panelOf(tab);
      if (panel) {
        panel.removeAttribute('data-enter');
        if (animate) {
          // Index each entry so the stagger reads top-to-bottom.
          panel
            .querySelectorAll('.row, .writing-row, .bento > li, .prose > *')
            .forEach((item, i) => item.style.setProperty('--i', i));
          void panel.offsetWidth; // restart the animation
          panel.setAttribute('data-enter', '');
        }
      }

      moveIndicator(tab);
      if (focus) tab.focus();
    };

    tablist.addEventListener('click', (event) => {
      const tab = event.target.closest('[role="tab"]');
      if (tab) select(tab);
    });

    tablist.addEventListener('keydown', (event) => {
      const current = tabs.indexOf(document.activeElement);
      if (current === -1) return;

      const next = {
        ArrowLeft:  current - 1,
        ArrowRight: current + 1,
        Home:       0,
        End:        tabs.length - 1,
      }[event.key];

      if (next === undefined) return;
      event.preventDefault();
      select(tabs[(next + tabs.length) % tabs.length], { animate: false, focus: true });
    });

    const tabFromHash = () =>
      tabs.find((tab) => tab.id === `tab-${location.hash.slice(1)}`);

    // Landing on /#games, or coming back to it, opens Games.
    const landed = tabFromHash();
    if (landed) select(landed, { animate: false, record: false });

    window.addEventListener('hashchange', () => {
      const tab = tabFromHash();
      if (tab) select(tab, { animate: false, record: false });
    });

    // Place the underline before transitions are enabled, so it does not
    // slide in from the left edge on first paint.
    const active = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0];
    moveIndicator(active);
    requestAnimationFrame(() => tablist.setAttribute('data-ready', ''));

    // Tab widths shift once Inter replaces the fallback font, and again on
    // resize — keep the underline attached to the tab it belongs to.
    const reposition = () => moveIndicator(
      tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') || tabs[0]
    );
    if (document.fonts) document.fonts.ready.then(reposition);
    window.addEventListener('resize', reposition);
  }

  /* ------------------------------- Work rows: the glass and the preview */

  /* Scoped to the Work panel on purpose. Writing dims its siblings instead,
     and the card tabs have no hover state of their own. */
  const workPanel = document.getElementById('panel-work');
  const preview = document.querySelector('.preview');

  if (workPanel) {
    const glass = document.createElement('div');
    glass.className = 'row-glass';

    const section = workPanel.closest('.work');
    const column = workPanel.closest('.column');
    const frame = preview && preview.querySelector('.preview-frame');
    const layers = preview ? [...preview.querySelectorAll('.preview-layer')] : [];
    const roomForPreview = matchMedia('(min-width: 1240px)');

    let currentLink = null;
    let currentSrc = null;
    let front = 0;

    /* ----- glass ----- */

    const showGlass = (link, { travel = true } = {}) => {
      const list = link.closest('.rows');
      const firstShow = !glass.hasAttribute('data-visible') || glass.parentElement !== list;

      if (glass.parentElement !== list) list.appendChild(glass);

      // The row hugs its title, so the pane has to match each row's own
      // width, not just its vertical position. Walk the offset chain up to
      // the list rather than trusting a single offsetParent — the <li> is
      // positioned, so the link's own offsets are relative to it.
      const place = () => {
        let x = 0;
        let y = 0;
        for (let node = link; node && node !== list; node = node.offsetParent) {
          x += node.offsetLeft;
          y += node.offsetTop;
        }
        glass.style.setProperty('--x', `${x}px`);
        glass.style.setProperty('--y', `${y}px`);
        glass.style.setProperty('--w', `${link.offsetWidth}px`);
        glass.style.setProperty('--h', `${link.offsetHeight}px`);
      };

      if (firstShow || !travel) {
        // Land in place untransitioned, so the glass never slides in from
        // the top of the list — then re-arm travel for the next row.
        glass.removeAttribute('data-travel');
        place();
        void glass.offsetWidth;
        glass.setAttribute('data-travel', '');
      } else {
        place();
      }

      glass.setAttribute('data-visible', '');
    };

    const hideGlass = () => {
      glass.removeAttribute('data-visible');
      glass.removeAttribute('data-travel');
    };

    /* ----- preview ----- */

    // How much room the preview actually has: the band beside the tab
    // section (never beside the bio), starting just right of whichever is
    // wider — the longest row title or the tab row itself. Both are measured,
    // not guessed, so they stay correct as titles change.
    const room = () => {
      const margin = 24;
      const gap = 64;
      const band = section.getBoundingClientRect();
      const top = Math.max(margin, band.top);
      const bottom = Math.min(window.innerHeight - margin, band.bottom);

      const titles = [...workPanel.querySelectorAll('.row-link')].map((l) => l.offsetWidth);
      const columnLeft = (window.innerWidth - column.offsetWidth) / 2;
      const widest = Math.max(...titles, tablist ? tablist.offsetWidth : 0, 0);
      const left = columnLeft + widest + gap;

      return {
        left,
        centerY: (top + bottom) / 2,
        maxH: Math.max(bottom - top, 180),
        maxW: Math.max(Math.min(520, window.innerWidth - left - margin), 180),
      };
    };

    // Fit the image inside that room without cropping it, so a portrait
    // screenshot stays portrait and a wide one stays wide.
    const fitFrame = (img, morph) => {
      const w = img.naturalWidth || 16;
      const h = img.naturalHeight || 10;
      const { left, centerY, maxW, maxH } = room();
      const scale = Math.min(maxW / w, maxH / h);

      frame.toggleAttribute('data-morph', Boolean(morph));
      frame.style.setProperty('--w', `${Math.round(w * scale)}px`);
      frame.style.setProperty('--h', `${Math.round(h * scale)}px`);
      preview.style.setProperty('--top', `${Math.round(centerY)}px`);
      preview.style.setProperty('--left', `${Math.round(left)}px`);
    };

    const showPreview = (src) => {
      if (!preview || !roomForPreview.matches || !src) return hidePreview();
      if (src === currentSrc) return preview.setAttribute('data-visible', '');

      const morph = preview.hasAttribute('data-visible');
      const next = layers[front ^ 1];
      const img = next.querySelector('img');

      const reveal = () => {
        fitFrame(img, morph);
        layers[front].removeAttribute('data-on');
        next.setAttribute('data-on', '');
        front ^= 1;
        preview.setAttribute('data-visible', '');
      };

      img.onerror = () => { if (currentSrc === src) hidePreview(); };
      currentSrc = src;

      if (img.getAttribute('src') === src && img.complete && img.naturalWidth) {
        reveal();
      } else {
        img.onload = () => { if (currentSrc === src) reveal(); };
        img.setAttribute('src', src);
      }
    };

    const hidePreview = () => {
      if (preview) preview.removeAttribute('data-visible');
      currentSrc = null;
    };

    /* ----- wiring ----- */

    const enter = (link, { travel = true } = {}) => {
      if (link === currentLink) return;
      currentLink = link;
      showGlass(link, { travel });
      showPreview(link.dataset.preview);
    };

    const leave = () => {
      currentLink = null;
      hideGlass();
      hidePreview();
    };

    clearHover = leave;

    workPanel.addEventListener('pointerover', (event) => {
      const link = event.target.closest('.row-link');
      if (link) enter(link); else leave();
    });

    workPanel.addEventListener('pointerleave', leave);

    // Keyboard users get the same preview — without the travel animation,
    // since tabbing through the list fires in bursts.
    workPanel.addEventListener('focusin', (event) => {
      const link = event.target.closest('.row-link');
      if (link) enter(link, { travel: false });
    });

    workPanel.addEventListener('focusout', (event) => {
      if (!workPanel.contains(event.relatedTarget)) leave();
    });

    const remeasure = () => {
      if (!roomForPreview.matches) hidePreview();
      if (!currentLink) return;
      showGlass(currentLink, { travel: false });
      const img = layers[front ^ 1] && layers[front ^ 1].querySelector('img');
      if (img && img.naturalWidth) fitFrame(img, false);
    };

    window.addEventListener('resize', remeasure);

    // Scrolling moves the band the preview is centred on.
    let scrollQueued = 0;
    window.addEventListener('scroll', () => {
      if (scrollQueued || !currentLink) return;
      scrollQueued = requestAnimationFrame(() => { scrollQueued = 0; remeasure(); });
    }, { passive: true });

    /* ----- the moving sheen ----- */

    if (!reduceMotion.matches) {
      let queued = 0;
      let pointer = null;

      workPanel.addEventListener('pointermove', (event) => {
        pointer = event;
        if (queued || !currentLink) return;

        queued = requestAnimationFrame(() => {
          queued = 0;
          const box = glass.getBoundingClientRect();
          // The visible pane is the ::before box: 20px wider each side,
          // 4px shorter top and bottom.
          const x = ((pointer.clientX - box.left + 20) / (box.width + 40)) * 100;
          const y = ((pointer.clientY - box.top - 4) / Math.max(box.height - 8, 1)) * 100;
          glass.style.setProperty('--mx', `${x.toFixed(1)}%`);
          glass.style.setProperty('--my', `${y.toFixed(1)}%`);
        });
      });
    }

    /* ----- warm the cache so the first hover is never an empty frame ----- */

    const preload = () => {
      for (const link of workPanel.querySelectorAll('.row-link[data-preview]')) {
        new Image().src = link.dataset.preview;
      }
    };
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 400)))(preload);
  }

  /* ------------------------------------------------------------ clock */

  const clock = document.querySelector('.clock');

  if (clock) {
    const format = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ulaanbaatar',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const tick = () => {
      const now = new Date();
      // "10:10 PM" -> "10:10pm"
      clock.textContent = `${format.format(now).replace(/\s*([AP])M/i, (_, half) => `${half.toLowerCase()}m`)} in `;
      clock.hidden = false;

      // Re-run on the next minute boundary rather than polling every second.
      setTimeout(tick, (60 - now.getSeconds()) * 1000 + 50);
    };

    tick();
  }
})();
