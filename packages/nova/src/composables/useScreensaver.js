/**
 * Sleep and lock are two different things: pressing the power button sleeps the
 * DE1 AND locks the screen, but unlocking (tapping the screensaver) does not have
 * to wake the DE1 back up — see nova_wake_on_unlock in SkinPanel. This composable
 * owns `locked` as skin-local UI state (not core: no other skin needs it).
 *
 * `locked` is set ONLY by explicit lock()/unlock() calls (PowerButton.vue is the
 * one caller of lock()) — it does NOT watch NSXCore's 'machineState' event.
 * That event fires on every machine snapshot (~every 250ms) for as long as the
 * DE1 stays asleep, not just on the transition into sleep, and it fires
 * identically whether sleep was triggered by the power button or by the
 * Settings machine-toggle. Locking off of it caused two bugs: the Settings
 * toggle (which must NEVER lock — the whole point is browsing the skin
 * without heating the machine) locked the screen anyway, and unlocking
 * without waking (wakeOnUnlock off) got re-locked by the very next heartbeat.
 */
import { ref } from 'vue';

const { NSXCore, NSXApi } = window;

export const locked = ref(false);

// "Keep screen awake" (nova_wakelock) holds a display wake-lock override during
// normal use. On the lockscreen we RELEASE it so the tablet's own screen timeout
// can turn the display off — otherwise the lockscreen would stay lit forever with
// keep-awake on. It's re-acquired on unlock (below).
const wakelockOn = () => NSXCore.getStore().nova_wakelock !== false; // default true

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
  _wakelockChain = _wakelockChain.then(
    () => (active ? NSXApi.requestWakeLockOverride() : NSXApi.releaseWakeLockOverride())
  ).catch((err) => {
    console.error('[Nova] wakelock override failed', err);
  });
  return _wakelockChain;
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
 * The release below is issued ONCE, at the moment of locking — nothing
 * re-checks it for as long as the lockscreen is up, and setWakelockOverride
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
    if (!locked.value) { _stopWakelockWatchdog(); return; }
    try {
      const state = await NSXApi.fetchDisplayState();
      if (state?.wakeLockOverride) {
        console.warn('[Nova] wakelock override still held on the lockscreen — releasing again');
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
  if (wakelockOn()) setWakelockOverride(false);
  _startWakelockWatchdog();
}

export async function unlock() {
  locked.value = false;
  _stopWakelockWatchdog();
  // Restore the normal brightness the slider was last set to, regardless of
  // whether the machine itself wakes up below.
  _restoreNormalBrightness();
  // Re-acquire the keep-awake override released on lock, so the screen stays on
  // during normal use again.
  if (wakelockOn()) setWakelockOverride(true);

  const wakeOnUnlock = NSXCore.getStore().nova_wake_on_unlock !== false; // default true
  if (!wakeOnUnlock) return;
  try {
    await NSXApi.setMachineState('idle');
  } catch (err) {
    console.error('[Nova] failed to wake the machine', err);
  }
}

// Boot-only ground-truth sync: if the DE1 is already asleep when Nova loads
// (e.g. a page reload), the screen should start locked too — and vice versa.
// This does NOT become a subscription that keeps firing — see the note above
// about why watching 'machineState' continuously is exactly the bug this file
// exists to avoid. First event only, then never touched again.
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
NSXCore.on('machineState', ({ state }) => {
  if (sawFirstState) return;
  sawFirstState = true;
  if (state === 'sleeping') {
    locked.value = true;
    _dimForLock();
    if (wakelockOn()) setWakelockOverride(false);
    _startWakelockWatchdog(); // a reload lands here instead of lock(), same risk
  } else {
    _restoreNormalBrightness();
    if (wakelockOn()) setWakelockOverride(true);
  }
});
