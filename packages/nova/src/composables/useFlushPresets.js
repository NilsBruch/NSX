/**
 * The rinse page's three save-slots: tap loads the stored flow+time pair,
 * press-and-hold (~600ms) overwrites the slot with the current one.
 *
 * A factory, not a module singleton (same convention as useRecipeDials.js):
 * the only state here is the per-key hold timer, which belongs to whichever
 * control row is on screen. Both renderings of this page — the tablet's
 * CleaningView with its orbs and slider, and the phone's CleaningPanel with
 * its settings rows — call it, so the hold behaviour exists in one place
 * regardless of which one you're looking at.
 *
 * A flush preset legitimately carries BOTH flow and duration, which is why
 * loading one goes through NSXCore.selectFlushPreset (it applies both and
 * sets the active highlight) rather than setting either on its own.
 */
export const FLUSH_PRESET_KEYS = ['kurz', 'normal', 'lang'];

const HOLD_MS = 600;

export function useFlushPresets(flush) {
  const { NSXCore } = window;
  const holdTimers = {};

  function onPresetDown(key) {
    holdTimers[key] = {
      held: false,
      timer: setTimeout(() => {
        holdTimers[key].held = true;
        NSXCore.setFlushPresets({
          ...flush.presets,
          [key]: { ...flush.presets[key], flow: flush.flow, duration: flush.duration },
        });
        NSXCore.selectFlushPreset(key);
      }, HOLD_MS),
    };
  }

  function onPresetUp(key) {
    const h = holdTimers[key];
    if (!h) return;
    clearTimeout(h.timer);
    // A hold has already saved AND selected by the time the finger lifts, so
    // only a plain tap still has anything to do.
    if (!h.held) NSXCore.selectFlushPreset(key);
    delete holdTimers[key];
  }

  function onPresetCancel(key) {
    if (holdTimers[key]) { clearTimeout(holdTimers[key].timer); delete holdTimers[key]; }
  }

  return { onPresetDown, onPresetUp, onPresetCancel };
}
