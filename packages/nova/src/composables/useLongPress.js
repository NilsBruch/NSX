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
 * Usage — one instance per list, the row passed in at press time:
 *
 *   const press = useLongPress({ tap: load, hold: openMenu });
 *   <button @pointerdown="press.down($event, row)" @pointermove="press.move"
 *           @pointerup="press.up(row)" @pointercancel="press.cancel"
 *           @pointerleave="press.cancel">
 */
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
      if (!wasHold) tap?.(payload);
    },
    cancel: clear,
  };
}
