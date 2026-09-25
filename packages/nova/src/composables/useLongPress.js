/**
 * Tap vs press-and-hold on the same element.
 *
 * Built from pointer events rather than @click, because the tap has to be
 * SUPPRESSED once a hold has fired — with @click the browser would deliver
 * both, and every long press would also trigger the tap action underneath it.
 *
 * The move threshold is what makes this usable in a scrolling list: a finger
 * dragging the list past a row travels across it while still down, and without
 * a slop check that reads as a hold on whatever it happened to start on.
 *
 * Firing on pointerup has one consequence that has to be handled: the browser
 * still sends a compatibility `click` afterwards, and by then the tap may have
 * put something NEW under the finger — which then receives it. That is not
 * hypothetical here. Tapping the recipe title opens the recipe overlay, whose
 * identity bubbles are deliberately placed at the title's own offset so it
 * "appears to stay put and split"; the click landed on the middle bubble and
 * opened the grinder picker every single time. See swallowGhostClick.
 *
 * Usage — one instance per list, the row passed in at press time:
 *
 *   const press = useLongPress({ tap: load, hold: openMenu });
 *   <button @pointerdown="press.down($event, row)" @pointermove="press.move"
 *           @pointerup="press.up(row)" @pointercancel="press.cancel"
 *           @pointerleave="press.cancel">
 */
/**
 * Eat the one compatibility click that follows this gesture.
 *
 * Deliberately narrow, because a document-wide capture listener is a blunt
 * thing to leave armed: it only swallows a click landing within `slop` of
 * where the finger came up (a real second tap somewhere else passes straight
 * through), only the first one, and only for 300ms — the compat click is
 * dispatched within the same frame, so anything later is the user acting
 * again. Anything it doesn't match, it lets through and disarms itself.
 */
function swallowGhostClick(at, slop) {
  if (typeof document === 'undefined') return;
  const onClick = (evt) => {
    if (Math.abs(evt.clientX - at.x) > slop || Math.abs(evt.clientY - at.y) > slop) { done(); return; }
    evt.stopPropagation();
    evt.preventDefault();
    done();
  };
  const done = () => {
    clearTimeout(timer);
    document.removeEventListener('click', onClick, true);
  };
  const timer = setTimeout(done, 300);
  document.addEventListener('click', onClick, true);
}

export function useLongPress({ tap, hold, ms = 450, slop = 10 }) {
  let timer = null;
  let fired = false;
  let start = { x: 0, y: 0 };

  function clear() {
    clearTimeout(timer);
    timer = null;
  }

  return {
    down(evt, payload) {
      fired = false;
      start = { x: evt.clientX, y: evt.clientY };
      clear();
      timer = setTimeout(() => { fired = true; hold?.(payload); }, ms);
    },
    move(evt) {
      if (timer === null) return;
      if (Math.abs(evt.clientX - start.x) > slop || Math.abs(evt.clientY - start.y) > slop) clear();
    },
    up(payload) {
      const wasHold = fired;
      clear();
      fired = false;
      // Armed for a hold too: that opens a menu, which is just as capable of
      // catching the click as an overlay is.
      swallowGhostClick(start, slop);
      if (!wasHold) tap?.(payload);
    },
    cancel: clear,
  };
}
