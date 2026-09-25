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
 * It is disarmed by the next POINTERDOWN, not by a timer. The first version
 * of this waited 300ms on the reasoning that the compat click is dispatched
 * within the same frame — true on a modern browser, and wrong on the old
 * Android tablet this skin actually runs on, where the WebView still holds
 * the click back by ~300ms waiting to see a double-tap. The timer and the
 * click were racing, and the bug came straight back.
 *
 * A pointerdown is the honest signal instead: a click can only ever follow
 * one, so the next gesture's click is the user's and this one's is not,
 * whenever either happens to arrive. The timeout that remains is a leak-stop
 * for a gesture whose click never comes at all (a cancelled touch), not part
 * of the logic.
 *
 * Still narrow: a document-wide capture listener is a blunt thing to leave
 * armed, so it only swallows a click landing near where the finger actually
 * came up, and only one.
 */
function swallowGhostClick(at, slop) {
  if (typeof document === 'undefined') return;
  const done = () => {
    clearTimeout(timer);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('pointerdown', onDown, true);
  };
  const onClick = (evt) => {
    // 2x slop: `at` is where the finger came up, but a tap is allowed to
    // travel up to slop before that, and the click can land anywhere in
    // between.
    if (Math.abs(evt.clientX - at.x) > slop * 2 || Math.abs(evt.clientY - at.y) > slop * 2) {
      done();
      return;
    }
    evt.stopPropagation();
    evt.preventDefault();
    done();
  };
  // A new gesture has begun, so whatever click follows belongs to it.
  const onDown = () => done();
  const timer = setTimeout(done, 2000);
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerdown', onDown, true);
}

export function useLongPress({ tap, hold, ms = 450, slop = 10 }) {
  let timer = null;
  let fired = false;
  let start = { x: 0, y: 0 };
  // Where the finger was last seen. The ghost click lands at the END of the
  // gesture, which a tap is allowed to have moved to (up to `slop`), so
  // matching against the pointerdown position alone sat right on the limit.
  let last = { x: 0, y: 0 };

  function clear() {
    clearTimeout(timer);
    timer = null;
  }

  return {
    down(evt, payload) {
      fired = false;
      start = { x: evt.clientX, y: evt.clientY };
      last = start;
      clear();
      timer = setTimeout(() => { fired = true; hold?.(payload); }, ms);
    },
    move(evt) {
      // Recorded before the timer check: a gesture that has already exceeded
      // the slop (timer cleared) still ends somewhere, and that somewhere is
      // where its click will land.
      last = { x: evt.clientX, y: evt.clientY };
      if (timer === null) return;
      if (Math.abs(evt.clientX - start.x) > slop || Math.abs(evt.clientY - start.y) > slop) clear();
    },
    up(payload) {
      const wasHold = fired;
      clear();
      fired = false;
      // Armed for a hold too: that opens a menu, which is just as capable of
      // catching the click as an overlay is.
      swallowGhostClick(last, slop);
      if (!wasHold) tap?.(payload);
    },
    cancel: clear,
  };
}
