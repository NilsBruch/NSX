/**
 * v-scroll-edges — what a scroll container does at its limits: fade the edge
 * that hides something, and give when pulled past it.
 *
 * A static mask cannot know that: it dims the first item even when the list
 * fits entirely on screen, which reads as "disabled", not as "scrollable". So
 * the state is measured and exposed as two classes; app.css decides what they
 * look like.
 *
 * The bottom edge is the honest place for a permanent-looking hint anyway —
 * with more below, a faded cut is what tells you to scroll — while the top
 * should be flush until you have actually moved away from it.
 *
 * Measured on scroll, on every re-render of the owning component (the `updated`
 * hook — expanding a row changes scrollHeight without resizing anything), and
 * on resize. No animation-timeline/scroll() here: the DE1 tablet's WebView is
 * Chromium ~96, generations before either.
 */
function measure(el) {
  // 1px slack: fractional scroll offsets and zoom rounding otherwise leave a
  // container that IS at the top reporting 0.5 and fading anyway.
  const atTop = el.scrollTop <= 1;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  el.classList.toggle('fade-top', !atTop);
  el.classList.toggle('fade-bottom', !atBottom);
}

/**
 * Rubber band. Dragging past a limit — including a list too short to scroll at
 * all, where BOTH limits are the same place — moves the content by a damped
 * fraction of the finger, then springs back on release. Without it a short
 * list is inert under the finger and gives no sign it is a scroller at all.
 *
 * Only ever engages when the native scroll cannot take the movement, so it
 * never competes with it: the browser scrolls while there is room, this takes
 * over exactly at the end. The 8px threshold and the fact that nothing is
 * captured or default-prevented is what keeps taps and the rows' own
 * press-and-hold working — a drag that bounces has already travelled past the
 * hold's own 10px slop, so the two agree about what a drag is.
 */
const PULL_DAMPING = 0.35;   // fraction of the finger's travel the content moves
const PULL_MAX = 48;         // px, so a hard pull still stops somewhere sane
const PULL_START = 8;        // px before anything moves, so a tap stays a tap

/* The INNER element is what moves — never the scroller. A transform on the
   scroller drags its overflow clip along with it, so pulling up slid the whole
   list, still clipped to its own moved box, straight over the title above it.
   Moving the content inside a stationary clip box is the whole point. */
const inner = (el) => el.firstElementChild;

function springBack(el) {
  const box = inner(el);
  if (!box) return;
  box.style.transition = 'transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)';
  box.style.transform = '';
}

export const vScrollEdges = {
  mounted(el) {
    el._edges = () => measure(el);
    el.addEventListener('scroll', el._edges, { passive: true });
    el._edgesRO = new ResizeObserver(el._edges);
    el._edgesRO.observe(el);
    measure(el);

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let startY = 0;
    let pulling = false;

    el._down = (evt) => {
      startY = evt.clientY;
      pulling = false;
      if (inner(el)) inner(el).style.transition = '';
    };
    el._move = (evt) => {
      if (evt.buttons === 0 && evt.pointerType === 'mouse') return;
      const dy = evt.clientY - startY;
      if (!pulling && Math.abs(dy) < PULL_START) return;

      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      // Pulling INTO content the scroller can still show is its job, not ours.
      if ((dy > 0 && !atTop) || (dy < 0 && !atBottom)) {
        if (pulling) { pulling = false; springBack(el); }
        return;
      }
      pulling = true;
      const pull = Math.sign(dy) * Math.min(PULL_MAX, Math.abs(dy) * PULL_DAMPING);
      if (inner(el)) inner(el).style.transform = `translateY(${pull}px)`;
    };
    el._up = () => {
      if (!pulling) return;
      pulling = false;
      springBack(el);
    };

    el.addEventListener('pointerdown', el._down);
    el.addEventListener('pointermove', el._move);
    el.addEventListener('pointerup', el._up);
    el.addEventListener('pointercancel', el._up);
    el.addEventListener('pointerleave', el._up);
  },
  updated(el) {
    measure(el);
  },
  unmounted(el) {
    el.removeEventListener('scroll', el._edges);
    el._edgesRO?.disconnect();
    for (const [type, fn] of [['pointerdown', el._down], ['pointermove', el._move],
                              ['pointerup', el._up], ['pointercancel', el._up],
                              ['pointerleave', el._up]]) {
      if (fn) el.removeEventListener(type, fn);
    }
    delete el._edges; delete el._edgesRO;
    delete el._down; delete el._move; delete el._up;
  },
};
