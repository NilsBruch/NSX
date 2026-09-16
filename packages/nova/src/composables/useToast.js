/**
 * Nova never wired up core's existing 'toast' event (push.js's debounced
 * settings-save failures, schedule.js's schedule-sync failures already emit
 * it — NSX's app.js has always had a showToast() subscriber; Nova had none,
 * so those failures were silently swallowed). One small shared banner,
 * subscribed at module load like every other core-event bridge in useCore.js.
 */
import { reactive } from 'vue';

const { NSXCore } = window;

export const toastState = reactive({ message: '', visible: false, position: 'bottom' });

let hideTimer = null;
/**
 * @param {string} message
 * @param {{position?: 'bottom'|'top'}} [opts] Bottom by default — where every
 *   core-bridged toast has always appeared. 'top' is for an answer to something
 *   the user just pressed further down the screen, which at the bottom would
 *   land under their own hand.
 */
export function showToast(message, { position = 'bottom' } = {}) {
  toastState.message = message;
  toastState.position = position;
  toastState.visible = true;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { toastState.visible = false; }, 3200);
}

NSXCore.on('toast', showToast);
