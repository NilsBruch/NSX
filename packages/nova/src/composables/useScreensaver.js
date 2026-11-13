/**
 * Sleep and lock are two different things: pressing the power button sleeps the
 * DE1 AND locks the screen, but unlocking (tapping the screensaver) does not have
 * to wake the DE1 back up — see nova_wake_on_unlock in SkinPanel. This composable
 * owns `locked` as skin-local UI state (not core: no other skin needs it).
 *
 * `locked` is NOT derived from NSXCore's 'machineState' event. That event fires
 * on every machine snapshot (~every 250ms) for as long as the DE1 stays
 * asleep, not just on the transition into sleep, and it fires identically
 * whether sleep was triggered by the lock button or by the machine power
 * button. Locking off of it caused two bugs: the power button (which must
 * NEVER lock — the whole point is browsing the skin without heating the
 * machine) locked the screen anyway, and unlocking without waking
 * (wakeOnUnlock off) got re-locked by the very next heartbeat.
 *
 * What it does lock on is the TRANSITION into sleep that this device did not
 * ask for: the machine's own auto-sleep, a schedule, or another device (the
 * phone) putting it to sleep. Then nobody is standing at the tablet, so the
 * screensaver is what should come up. This device's own sleep requests call
 * markOwnSleepRequest() first and are left alone — the lock button locks by
 * itself, the power button deliberately doesn't. A transition fires once, so
 * neither of the two bugs above can come back through it.
 */
import { ref } from 'vue';

const { NSXCore, NSXApi } = window;

export const locked = ref(false);

// Set by every sleep request THIS device sends, so the transition it causes is
// recognised as ours. A window rather than a flag: the gateway takes a moment
// to report the new state, and a flag left set by a request that never took
// effect would swallow the next genuine auto-sleep.
const OWN_SLEEP_WINDOW_MS = 10000;
let _ownSleepUntil = 0;
export function markOwnSleepRequest() {
  _ownSleepUntil = Date.now() + OWN_SLEEP_WINDOW_MS;
}

// "Keep screen awake" (nova_wakelock) holds a display wake-lock override while
// the skin is in use AND the machine is awake. On the lockscreen, and whenever
// the DE1 is asleep (switched off here and still browsed, too), it is RELEASED
// so the tablet's own screen timeout can turn the display off — a sleeping
// machine is nothing to keep a screen lit for. applyWakelock() is the one place
// that decides; everything else just calls it.
const wakelockOn = () => NSXCore.getStore().nova_wakelock !== false; // default true

// Latest machine state, from the 'machineState' handler at the bottom.
let _lastState = null;
let _lastStateAt = 0;

/**
 * Every request/release call funnels through here, chained onto the previous
 * one, so the gateway is guaranteed to see them in the order they were
 * ISSUED — not the order their network responses happen to land in.
 *
 * Without this, lock()/unlock()/the boot sync/the Settings toggle each fired
 * requestWakeLockOverride()/releaseWakeLockOverride() independently, with no
 * ordering between them. A release fired right after an in-flight request
 * (e.g. unlock's request + a quick re-lock's release, or the boot sync racing
 * an interactive lock()) could have its response land FIRST if the request
 * happened to be the slower round-trip — leaving the gateway's wakelock
 * override actually HELD even though the skin shows the lockscreen and
 * `locked` is true. That's the "screensaver stays on, tablet never times out,
 * only fixed by toggling the Settings switch off and on" bug: toggling it
 * works because that path is `await`ed sequentially — exactly what every
 * other call site was missing.
 */
let _wakelockChain = Promise.resolve();
export function setWakelockOverride(active) {
  // A host that can't hold a wake lock turns every one of these into a no-op
  // round-trip (NSXCore.getDisplaySupport, filled in by main.js at boot).
  if (!NSXCore.getDisplaySupport().wakeLock) return _wakelockChain;
  _wakelockChain = _wakelockChain.then(
    () => (active ? NSXApi.requestWakeLockOverride() : NSXApi.releaseWakeLockOverride())
  ).catch((err) => {
    console.error('[Nova] wakelock override failed', err);
  });
  return _wakelockChain;
}

/** Whether the override should be held right now. */
function _wantWakelock() {
  return wakelockOn() && !locked.value && _lastState !== 'sleeping';
}

/**
 * Bring the gateway's override in line with _wantWakelock(). Called on every
 * machine-state report, so it only sends when the answer CHANGES (null = never
 * sent, so the first call always goes out). While released, the watchdog below
 * re-checks that the release stuck.
 */
let _wakelockHeld = null;
export function applyWakelock() {
  const want = _wantWakelock();
  if (want === _wakelockHeld) return _wakelockChain;
  _wakelockHeld = want;
  if (want) _stopWakelockWatchdog();
  else _startWakelockWatchdog();
  return setWakelockOverride(want);
}

// Shared by the interactive lock()/unlock() below AND the boot-time sync
// handler at the bottom of this file — both need to apply the SAME dim/
// normal brightness for the state they've landed on, not just decide the
// `locked` flag. Skipping this on boot (i.e. only setting `locked` without
// actually pushing the matching brightness) is what used to leave the
// hardware brightness wherever it physically happened to be BEFORE a reload:
// a reload into an already-sleeping machine could come up locked but still
// bright, and a reload into an already-woken one could come up on the normal
// skin but still dim — see the boot-sync handler's comment.
// Same ordering hazard as the wakelock chain below, same fix: chain every
// setDisplayBrightness call — from HERE, and from the Settings slider's
// setBrightness() in useSettings.js, which calls this too — onto the
// previous one instead of firing them independently, so a dim-then-restore
// (or restore-then-dim, or a slider drag racing a lock/unlock) issued in
// quick succession can't have its responses land out of order and leave the
// display at the wrong brightness for whichever state the skin shows.
let _brightnessChain = Promise.resolve();
export function setBrightnessOverride(level) {
  // Same as the wakelock chain: nothing to drive on a host without backlight
  // control, so don't spend a request per lock/unlock/slider tick.
  if (!NSXCore.getDisplaySupport().brightness) return _brightnessChain;
  _brightnessChain = _brightnessChain.then(
    () => NSXApi.setDisplayBrightness(level)
  ).catch((err) => {
    console.error('[Nova] failed to set display brightness', err);
  });
  return _brightnessChain;
}
function _dimForLock() {
  // `!= null`, not `|| 30`: 0 is a legitimate value here (fully dark
  // lockscreen) and the number pad that sets it doesn't clamp, so a stored 0
  // must actually dim to 0 rather than silently jumping back to 30.
  const stored = NSXCore.getStore().nova_screensaver_brightness;
  setBrightnessOverride(stored != null ? Number(stored) : 30);
}
function _restoreNormalBrightness() {
  // `|| 80` is deliberate here, unlike the dim level above: 0 would leave the
  // normal UI a black screen with no visible way back (the Settings slider
  // enforces a min of 10 for the same reason), so a missing/0 value falls
  // back to a usable brightness rather than being honoured.
  setBrightnessOverride(Number(NSXCore.getStore().nsx_display_brightness) || 80);
}

/**
 * The release is issued ONCE, when it becomes due (locking, or the machine
 * falling asleep) — nothing else re-checks it while it should stay released,
 * and setWakelockOverride
 * only console.errors a rejection. So if that one call is lost (a failed
 * request, or the gateway re-acquiring the override behind our back), the
 * lockscreen keeps the display lit indefinitely: there is no later lock() to
 * correct it until the user unlocks and locks again. That is the intermittent
 * "screen stayed on while on the lockscreen" bug — it needs the release to be
 * LOST, not merely issued, which is why it only shows up occasionally.
 *
 * So while locked, verify against the gateway's real display state instead of
 * assuming the one-shot release stuck, and re-release if it didn't. Note this
 * deliberately never touches `locked` — the file header explains why deriving
 * that from machine state is its own bug; this only re-asserts the wakelock.
 */
const WAKELOCK_WATCHDOG_MS = 30000;
let _watchdogTimer = null;

function _stopWakelockWatchdog() {
  if (_watchdogTimer !== null) { clearInterval(_watchdogTimer); _watchdogTimer = null; }
}

function _startWakelockWatchdog() {
  _stopWakelockWatchdog();
  if (!wakelockOn()) return; // nothing was held, so nothing can leak
  _watchdogTimer = setInterval(async () => {
    if (_wantWakelock()) { _stopWakelockWatchdog(); return; }
    try {
      const state = await NSXApi.fetchDisplayState();
      if (state?.wakeLockOverride) {
        console.warn('[Nova] wakelock override still held while it should be released — releasing again');
        await setWakelockOverride(false);
      } else if (state?.wakeLockEnabled) {
        // Held, but not by US: the gateway's own machine-state rule keeps the
        // display awake and drops it when the DE1 sleeps — so this means the
        // machine isn't actually asleep. Nothing here to release (the override
        // is already clear); logged so the two causes stay distinguishable if
        // this is ever reported again.
        console.warn('[Nova] lockscreen display awake, but not via our override — machine likely not sleeping');
      }
    } catch (err) {
      console.error('[Nova] wakelock watchdog check failed', err);
    }
  }, WAKELOCK_WATCHDOG_MS);
}

export function lock() {
  locked.value = true;
  _dimForLock();
  applyWakelock();
}

export async function unlock() {
  locked.value = false;
  // Restore the normal brightness the slider was last set to, regardless of
  // whether the machine itself wakes up below.
  _restoreNormalBrightness();
  // Re-acquires keep-awake only if the machine is awake. Unlocked without
  // waking it stays released; waking it below re-acquires it through the
  // machine-state handler once the gateway reports the new state.
  applyWakelock();

  const wakeOnUnlock = NSXCore.getStore().nova_wake_on_unlock !== false; // default true
  if (!wakeOnUnlock) return;
  try {
    await NSXApi.setMachineState('idle');
  } catch (err) {
    console.error('[Nova] failed to wake the machine', err);
  }
}

// Boot-time ground-truth sync: if the DE1 is already asleep when Nova loads
// (e.g. a page reload), the screen should start locked too — and vice versa.
// After that first event the handler only acts on a TRANSITION into sleep
// (see the file header) — never on the steady stream of 'sleeping' reports,
// which is exactly the bug this file exists to avoid.
//
// This is also the ONE place that decides the wakelock's INITIAL state —
// main.js used to unconditionally request it on every boot, racing this
// handler: on a reload into an already-sleeping machine, whichever one ran
// last won, so roughly half the time the boot-time request clobbered the
// release below and the lockscreen kept the display awake forever (keep-awake
// only gets released again on the next explicit lock()). Owning both the
// locked flag AND the wakelock decision in the same handler removes the race.
//
// Brightness needs the identical treatment, and used to not get it: a reload
// only ever set `locked`/the wakelock, never re-pushed the matching
// brightness — so the display just stayed at whatever it physically was
// BEFORE the reload. That's what caused two distinct-looking symptoms from
// the one gap: reloading into an already-sleeping machine could come up
// showing the lockscreen but still bright (never dimmed), and reloading into
// an already-woken one could land on the normal skin but still dim (never
// restored) — reading as "the normal skin's brightness reacts to the
// lockscreen setting." Explicitly (re-)applying brightness in both branches
// here, exactly like lock()/unlock() already do, fixes both at once.
let sawFirstState = false;
// Reports normally arrive every ~250ms. A longer gap means the stream dropped
// and came back, and a 'sleeping' after that is a machine that was ALREADY
// asleep (say, switched off here and still browsed), not one that just fell
// asleep — so it must not lock.
const STATE_GAP_MS = 5000;
NSXCore.on('machineState', ({ state }) => {
  const now = Date.now();
  const prev = _lastState;
  const continuous = now - _lastStateAt < STATE_GAP_MS;
  _lastState = state;
  _lastStateAt = now;
  if (sawFirstState) {
    // Into sleep, not by this device's own request, and not already locked:
    // auto-sleep, a schedule, or the phone. Bring the screensaver up.
    if (state === 'sleeping' && prev !== 'sleeping' && continuous
        && !locked.value && now > _ownSleepUntil) {
      lock();
    }
    // Asleep -> released, awake -> held (unless locked). A no-op on the
    // steady stream of reports; it only sends when that answer changes.
    applyWakelock();
    return;
  }
  sawFirstState = true;
  if (state === 'sleeping') {
    locked.value = true;
    _dimForLock();
  } else {
    _restoreNormalBrightness();
  }
  applyWakelock();
});
