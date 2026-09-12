/* =========================================================================
   Article pages — the side index, and jumping between a footnote and the
   line that called it.
   ========================================================================= */

(() => {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  /* ------------------------------------------------------- side index */

  const links = [...document.querySelectorAll('.side-index a')];

  if (links.length) {
    const sections = links
      .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
      .filter(Boolean);

    if (sections.length === links.length) {
      let active = -1;

      const mark = (index) => {
        if (index === active) return;
        if (active > -1) links[active].removeAttribute('aria-current');
        if (index > -1) links[index].setAttribute('aria-current', 'true');
        active = index;
      };

      // The section you are reading is the last heading you scrolled past,
      // which means measuring live positions — a cached IntersectionObserver
      // rect goes stale the moment you keep scrolling.
      const update = () => {
        const line = window.innerHeight * 0.4;
        let current = -1;
        sections.forEach((section, i) => {
          if (section.getBoundingClientRect().top <= line) current = i;
        });
        mark(current);
      };

      let queued = 0;
      const schedule = () => {
        if (queued) return;
        queued = requestAnimationFrame(() => { queued = 0; update(); });
      };

      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      update();
    }
  }

  /* -------------------------------------------------------- footnotes */

  const notes = document.querySelector('.notes');
  const article = document.querySelector('.article');
  if (!notes || !article) return;

  // Handled here rather than by the browser's own hash jump: this centres
  // the target, marks it so you can see which line you landed on, and works
  // the second time you click the same footnote.
  const jump = (id) => {
    const target = document.getElementById(id);
    if (!target) return;

    target.scrollIntoView({
      behavior: reduceMotion.matches ? 'auto' : 'smooth',
      block: 'center',
    });

    const host = target.closest('p, li') || target;
    host.classList.remove('is-flash');
    void host.offsetWidth; // restart the animation
    host.classList.add('is-flash');
    host.addEventListener('animationend', () => host.classList.remove('is-flash'), { once: true });
  };

  const idFrom = (href) => (href || '').split('#')[1];

  // Body → note.
  article.addEventListener('click', (event) => {
    const ref = event.target.closest('.note-ref');
    if (!ref || notes.contains(ref)) return;
    event.preventDefault();
    jump(idFrom(ref.getAttribute('href')));
  });

  // Note → body. The arrow is the visible affordance, but the whole note
  // works — unless you were selecting its text, or clicking a link in it.
  notes.addEventListener('click', (event) => {
    const inner = event.target.closest('a');
    if (inner && !inner.classList.contains('note-back')) return;

    const item = event.target.closest('li[id^="note-"]');
    if (!item) return;
    if (!inner && !window.getSelection().isCollapsed) return;

    event.preventDefault();
    jump(`ref-${item.id.slice(5)}`);
  });
})();
