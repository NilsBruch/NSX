/**
 * Global error visibility. Nova had none at all — no app.config.errorHandler,
 * no onErrorCaptured anywhere, no window.onerror/unhandledrejection — which is
 * exactly the state that made NSX's keyboard bugs invisible: an exception
 * thrown inside any handler is swallowed by the browser/Vue and the button
 * just "does nothing", with nothing to diagnose from on a tablet that has no
 * reachable console. Mirrors NSX's _reportRuntimeError (packages/nsx/src/
 * modules/app.js) using Nova's existing toast pipe (useToast.js / core's
 * 'toast' event) instead of NSX's own showToast().
 *
 * Also exports reportSilentFailure() for the codebase's other class of
 * invisible failure: not a thrown exception, but a guard clause that quietly
 * gives up (e.g. useRecipe.js's `if (idx < 0) return;` when a background
 * refresh removed the recipe a dial edit was about to persist into). Same
 * dedup, same pipe, different entry point — that one already has a message,
 * not a raw error object.
 */
const { NSXCore } = window;

let lastMessage = '';
let lastAt = 0;
const REPEAT_WINDOW_MS = 10_000;

/** Toast `message` unless the identical message already fired within the
 *  repeat window — a watcher re-running on every reactive tick, or a user
 *  spinning a dial against a since-deleted recipe, must not bury the UI in
 *  copies of the same toast. */
function reportOnce(message) {
  const now = Date.now();
  if (message === lastMessage && now - lastAt < REPEAT_WINDOW_MS) return;
  lastMessage = message;
  lastAt = now;
  try {
    NSXCore.emit('toast', message);
  } catch {
    /* the toast pipe itself is broken — the console still has it */
  }
}

// The message is deliberately the raw error text, since its audience is
// whoever is diagnosing, not the end user reading a friendly sentence.
function reportRuntimeError(where, err) {
  const message = `${where}: ${err?.message || err}`;
  console.error('[Nova]', message, err);
  reportOnce(message);
}

/** For a guard clause that gives up rather than throwing. `message` should
 *  already be a complete, user-presentable sentence (translated if the
 *  call site has i18n available) — this does not template a "where: " prefix
 *  onto it the way reportRuntimeError does for raw exceptions. */
export function reportSilentFailure(message) {
  console.warn('[Nova]', message);
  reportOnce(message);
}

/** Call once, right after createApp(), before .mount(). */
export function installErrorReporting(app) {
  // Vue-thrown errors: render, watcher, and lifecycle-hook exceptions across
  // every component. `info` is Vue's own description of where (e.g. "watcher
  // callback"), which is more useful here than the component instance.
  app.config.errorHandler = (err, _instance, info) => reportRuntimeError(info || 'Vue', err);

  // Everything Vue's errorHandler does NOT see: a rejected promise from a bare
  // .then() chain, an event listener registered outside Vue, a timer callback.
  window.addEventListener('unhandledrejection', (e) => reportRuntimeError('Promise', e.reason));
  window.addEventListener('error', (e) => reportRuntimeError('Error', e.error || e.message));
}
