/**
 * The stack of full-screen pages that are open, for the push transition: a
 * page slides in from the right while whatever it covers slides out to the
 * left, side by side — and back again when it closes.
 *
 * The bottom of the stack is the app itself (.stage on the tablet,
 * .phone-shell on the phone); every page opened through <PageTransition> goes
 * on top. Every layer except the topmost carries `.page-pushed` (moved one
 * screen to the left, see app.css). A page opening pushes the layer below it;
 * a page closing un-pushes it, and both move on the same curve at once.
 *
 * DOM-fused on purpose, and skin-local: it moves elements, and another skin
 * would navigate in its own idiom. The pages live under <body>
 * (<PageTransition> teleports them) precisely so that pushing the app does not
 * drag them along — a transform on .stage would carry every fixed overlay
 * inside it.
 */
const stack = [];

const base = () => document.querySelector('.stage') || document.querySelector('.phone-shell');

/**
 * Re-derive every layer's class from the stack: all pushed but the top.
 * First drops any page no longer in the document — one removed without its
 * leave hook running (say, a page closed while a page it opened was still
 * up) would otherwise stay in the stack, and the app under it would stay
 * pushed off-screen with nothing on top. Every open, close and finished close
 * calls this, so a stale entry never outlives the next of them.
 */
function sync() {
  for (let j = stack.length - 1; j >= 0; j--) if (!stack[j].isConnected) stack.splice(j, 1);
  const layers = [base(), ...stack].filter(Boolean);
  layers.forEach((el, i) => el.classList.toggle('page-pushed', i < layers.length - 1));
}

/** A page has been inserted and is starting to slide in. */
export function pageEnter(el) {
  if (!stack.includes(el)) stack.push(el);
  sync();
}

/** A page is starting to slide out: the layer beneath slides back in with it. */
export function pageLeave(el) {
  const i = stack.indexOf(el);
  if (i >= 0) stack.splice(i, 1);
  el.classList.remove('page-pushed');
  sync();
}

/** A page has finished sliding out and left the document. */
export function pageLeft() {
  sync();
}
