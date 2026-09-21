<script setup>
/**
 * Guided backflush/descale/transport: prep instructions -> on-screen Start
 * (the one other on-screen-start exception besides Skip, per the design log
 * -- this is supervised maintenance, not a drink) -> watches the real machine
 * state for the maintenance state, then auto-closes once it returns to idle.
 *
 * Forward flush is a fourth mode with its own multi-step flow: it runs as a
 * real espresso profile (state `espresso`), so starting it is hardware-only
 * like any other shot -- Start here only LOADS the profile
 * (loadForwardFlush), landing on an "armed" step that tells the user to press
 * the machine's espresso button. Once the machine actually enters `espresso`,
 * this shows a cleaning-specific run screen (frame/step/timer/pressure/flow +
 * Skip step/Stop) instead of the normal LiveShotOverlay graph --
 * useLiveShot.js suppresses that overlay for the whole session via
 * flushSession.active (useCleaningSession.js).
 *
 * ── Two passes, like NSX ────────────────────────────────────────────────────
 * The forward-flush profile is a backflush: it is run TWICE, first with
 * detergent in the blind basket and then, after rinsing the basket, without --
 * and it ends on an instruction to flush the group by hand, which the skin
 * cannot drive (the flush button is on the machine). NSX's cleaning wizard
 * does exactly this (app.js's _cleaningMultiPass / _cleaningFinishPass), and
 * running the cycle only once left detergent in the machine, so Nova now
 * follows the same flow rather than closing after the first pass.
 *
 * Pass 2 re-pushes the profile through loadForwardFlush() rather than assuming
 * it is still on the machine: the previous recipe is auto-restored the moment
 * the machine goes idle after a pass (useMachineFunctions.js), so by the time
 * the user is ready for the second run the flush profile is gone.
 *
 * There is no real progress feed for backflush/descale/transport (unlike
 * heating's time-to-ready) -- that bar is honestly indeterminate, not a
 * fabricated percent.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { machine, liveShot, currentWorkflow } from '../composables/useCore.js';
import { showToast } from '../composables/useToast.js';
import { loadForwardFlush, cancelForwardFlush } from '../composables/useMachineFunctions.js';
import { flushSession } from '../composables/useCleaningSession.js';
import { frameName } from '../composables/useProfileDisplay.js';

const props = defineProps({ mode: { type: String, required: true } }); // 'forwardFlush' | 'backflush' | 'descale' | 'transport'
const emit = defineEmits(['close']);
const { t } = useI18n();
const { NSXApi, NSXCore } = window;

// Each guided flow just drives the machine into its maintenance state; the
// gateway runs the cycle and returns to idle when done. Transport = air purge,
// same command streamline's Transport Mode uses (setMachineState('airPurge')).
// Forward flush runs as a real shot, so its "running" state is `espresso`.
const STATE_FOR_MODE = { forwardFlush: 'espresso', backflush: 'cleaning', descale: 'descaling', transport: 'airPurge' };
const targetState = computed(() => STATE_FOR_MODE[props.mode]);
const running = computed(() => machine.state === targetState.value);

/**
 * Where the forward-flush flow stands (ignored by the other three modes):
 *   'prep'  — instructions for this pass, Start loads the profile
 *   'armed' — profile pushed, waiting for the machine's espresso button
 *   'rinse' — pass 1 is done: rinse the basket, reinsert it without detergent
 *   'done'  — both passes are done: flush the group by hand, then Done
 * The RUN screen isn't a step here — it is driven by the machine's own state
 * (`running`), so it can't disagree with what the machine is doing.
 */
const step = ref('prep');
const pass = ref(1);
// Kept as its own name because the template and cancel() both read it, and
// "is a loaded-but-unrun profile sitting on the machine" is the question they
// are actually asking.
const armed = computed(() => step.value === 'armed');

const ICONS = {
  forwardFlush: '<path d="M4 12a8 8 0 0 1 14-5m2-3v5h-5"/><path d="M20 12a8 8 0 0 1-14 5m-2 3v-5h5"/>',
  backflush: '<path d="M4 12a8 8 0 0 1 14-5m2-3v5h-5"/><path d="M20 12a8 8 0 0 1-14 5m-2 3v-5h5"/>',
  descale: '<path d="M12 3.5s5.5 6.3 5.5 10a5.5 5.5 0 0 1-11 0c0-3.7 5.5-10 5.5-10z"/><path d="M8 13l8-.01M10 16l4-.01"/>',
  transport: '<path d="M3 6h11v9H3z"/><path d="M14 9h3.5L21 12.5V15h-7z"/><circle cx="7.5" cy="17.5" r="1.6"/><circle cx="16.5" cy="17.5" r="1.6"/>',
};

// ── Forward-flush run screen: frame/step readout ─────────────────────────────
const frameList = computed(() => {
  const p = flushSession.profile ?? currentWorkflow.value?.profile;
  return p?.steps ?? p?.frames ?? [];
});
const frameIdx = computed(() => liveShot.profileFrame ?? 0);
const totalFrames = computed(() => frameList.value.length);
const currentFrame = computed(() => frameList.value[frameIdx.value] ?? null);
const frameTitle = computed(() => (currentFrame.value ? frameName(currentFrame.value, frameIdx.value, t) : ''));
const stepLabel = computed(() =>
  totalFrames.value
    ? t('cleaning.stepProgress', { x: Math.min(frameIdx.value + 1, totalFrames.value), y: totalFrames.value })
    : ''
);
// "Step n of 5" for forward flush (prep, run, rinse, run, hand flush) so the
// two passes read as one procedure rather than two identical cycles; the
// other modes keep their own 1-of-2 labels.
const FLUSH_STEP_LABEL = { prep: 'cleaning.forwardFlushStep1', armed: 'cleaning.forwardFlushStep2', rinse: 'cleaning.forwardFlushStep4', done: 'cleaning.forwardFlushStep5' };
const flushStepLabel = computed(() => t(FLUSH_STEP_LABEL[step.value] ?? FLUSH_STEP_LABEL.prep));

const stepPct = computed(() => (totalFrames.value ? Math.min(100, ((frameIdx.value + 1) / totalFrames.value) * 100) : 0));

// Gauges scaled to a DE1's practical range -- purely visual movement, not a
// calibrated meter.
const PRESSURE_MAX = 12; // bar
const FLOW_MAX = 10; // ml/s
const pressurePct = computed(() => Math.min(100, Math.max(0, (liveShot.pressure / PRESSURE_MAX) * 100)));
const flowPct = computed(() => Math.min(100, Math.max(0, (liveShot.flow / FLOW_MAX) * 100)));

// ── Forward-flush run timer (counts up from when the machine actually enters
// `espresso`, same pattern as SimpleLiveOverlay's steam timer) ───────────────
let timerHandle = null;
let startMs = 0;
const elapsedSec = ref(0);
function tick() { elapsedSec.value = (Date.now() - startMs) / 1000; }
function startTimer() { startMs = Date.now(); elapsedSec.value = 0; tick(); timerHandle = setInterval(tick, 250); }
function stopTimer() { if (timerHandle) { clearInterval(timerHandle); timerHandle = null; } }
const timeLabel = computed(() => {
  const s = Math.floor(elapsedSec.value);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});

// Auto-close shortly after the machine reports it's done (idle again) —
// running -> not-running is the real completion signal, not a timer.
let wasRunning = false;
watch(
  () => running.value,
  (isRunning) => {
    if (props.mode === 'forwardFlush') {
      if (isRunning && !wasRunning) startTimer();
      if (!isRunning && wasRunning) {
        stopTimer();
        // A finished pass hands over to the next instruction instead of
        // closing: pass 1 to the basket rinse, pass 2 to the hand-flush note.
        // Nothing auto-closes here — both are things the user has to DO, and
        // a screen that vanishes on its own is exactly how the detergent
        // stage got skipped.
        if (pass.value === 1) { pass.value = 2; step.value = 'rinse'; }
        else step.value = 'done';
      }
      wasRunning = isRunning;
      return;
    }
    if (wasRunning && !isRunning) setTimeout(() => emit('close'), 900);
    wasRunning = isRunning;
  }
);
onUnmounted(() => { stopTimer(); });

async function start() {
  if (props.mode === 'forwardFlush') {
    const ok = await loadForwardFlush();
    if (ok) step.value = 'armed';
    return;
  }
  // setState is disallowed only while an espresso shot is hardware-running
  // (ALLOWED_OPERATIONS in machine.js) — the template's `!running` guard alone
  // doesn't cover that case.
  if (!NSXCore.canExecuteOperation('setState')) {
    showToast(t('cleaning.blockedByShot'));
    return;
  }
  await NSXApi.setMachineState(targetState.value);
}

// Back/cancel: only shown while !running. For forward flush, backing out of
// the armed step must restore the recipe that was loaded before it, so the
// machine isn't left holding a cleaning profile.
async function cancel() {
  if (props.mode === 'forwardFlush' && armed.value) await cancelForwardFlush();
  emit('close');
}

// The last step's Done: the recipe was already restored when the machine went
// idle after the pass, so there is nothing to undo here — just leave.
function finish() { emit('close'); }

// ── Forward-flush run controls ────────────────────────────────────────────
let skipInFlight = false;
let skipGuardFrame = null;
async function skipStep() {
  if (skipInFlight) return;
  if (!NSXCore.canExecuteOperation('skipStep', machine.state)) return;
  const idx = frameIdx.value;
  if (skipGuardFrame === idx) return; // already requested a skip for this frame
  skipInFlight = true;
  try {
    await NSXApi.setMachineState('skipStep');
    skipGuardFrame = idx;
  } catch {
    showToast(t('cleaning.skipStepFailed'));
  } finally {
    skipInFlight = false;
  }
}
async function stop() {
  if (!NSXCore.canExecuteOperation('stopShot', machine.state)) return;
  await NSXApi.setMachineState('idle');
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button v-if="!running" class="ov-back" @click="cancel">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('common.cancel') }}
      </button>
      <span class="ov-title">{{ t(`cleaning.${mode}`) }}</span>
    </div>

    <!-- Forward flush: dedicated run screen while the machine is actually brewing. -->
    <template v-if="mode === 'forwardFlush' && running">
      <div class="assist-body flush-run">
        <div class="assist-step">{{ t('cleaning.forwardFlushStep3', { pass }) }}</div>
        <div class="assist-step">{{ frameTitle }}</div>
        <div class="assist-step">{{ stepLabel }}</div>
        <div class="progress"><div class="bar" :style="{ width: `${stepPct}%` }"></div></div>

        <div class="flush-timer">{{ timeLabel }}</div>

        <div class="flush-metrics">
          <div class="flush-metric">
            <div class="fm-value">{{ liveShot.pressure.toFixed(1) }} <small>bar</small></div>
            <div class="fm-gauge"><div class="fm-fill" :style="{ width: `${pressurePct}%` }"></div></div>
          </div>
          <div class="flush-metric">
            <div class="fm-value">{{ liveShot.flow.toFixed(1) }} <small>ml/s</small></div>
            <div class="fm-gauge"><div class="fm-fill" :style="{ width: `${flowPct}%` }"></div></div>
          </div>
        </div>

        <p class="assist-text flush-warning">{{ t('cleaning.doNotRemovePortafilter') }}</p>
      </div>
      <div class="ov-bottom flush-buttons">
        <button class="rate-btn secondary" @click="skipStep">{{ t('cleaning.skipStep') }}</button>
        <button class="rate-btn stop" @click="stop">{{ t('common.stop') }}</button>
      </div>
    </template>

    <!-- Everyone else (and forward flush's prep/armed steps): the shared prep/indeterminate layout. -->
    <template v-else>
      <div class="assist-body">
        <span class="bigicon"><svg viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS[mode]"></svg></span>
        <div v-if="mode === 'forwardFlush' && !running">
          <div class="assist-step">{{ flushStepLabel }}</div>
          <!-- One paragraph per step of the flow: detergent in, press the
               button, rinse the basket for the second pass, flush by hand. -->
          <p class="assist-text">{{ t(`cleaning.forwardFlush${step === 'prep' ? 'Prep' : step === 'armed' ? 'Armed' : step === 'rinse' ? 'Rinse' : 'Final'}`) }}</p>
        </div>
        <div v-else-if="!running">
          <div class="assist-step">{{ t('cleaning.step1') }}</div>
          <p class="assist-text">{{ t(`cleaning.${mode}Prep`) }}</p>
        </div>
        <div v-else>
          <div class="assist-step">{{ t('cleaning.step2') }}</div>
          <p class="assist-text">{{ t('cleaning.running') }}</p>
          <div class="progress" style="margin-top: 18px"><div class="bar indeterminate"></div></div>
        </div>
      </div>

      <!-- Armed has no button of its own (the machine's espresso button is the
           control); the last step closes instead of starting anything. -->
      <div v-if="!running && mode === 'forwardFlush' && step === 'done'" class="ov-bottom">
        <button class="rate-btn" @click="finish">{{ t('common.done') }}</button>
      </div>
      <div v-else-if="!running && !armed" class="ov-bottom">
        <button class="rate-btn" :disabled="machine.state === 'espresso'" @click="start">{{ t('common.start') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bar.indeterminate {
  width: 40%;
  animation: indeterminate 1.2s ease-in-out infinite;
}
@keyframes indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(250%); }
}
@media (prefers-reduced-motion: reduce) {
  .bar.indeterminate { animation: none; width: 100%; opacity: 0.5; }
}

.flush-run { gap: 16px; }
.flush-timer { font-size: var(--fs-xl); font-weight: 700; font-variant-numeric: tabular-nums; }
.flush-metrics { display: flex; gap: 28px; }
.flush-metric { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 140px; }
.fm-value { font-size: var(--fs-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
.fm-value small { font-size: var(--fs-sm); font-weight: 600; color: var(--muted); }
.fm-gauge { width: 100%; height: 8px; border-radius: 99px; background: var(--well); overflow: hidden; }
.fm-fill { height: 100%; width: 0; background: var(--accent); border-radius: 99px; transition: width 0.2s linear; }
.flush-warning { color: var(--alert); font-weight: 700; }

.flush-buttons { gap: 16px; }
.rate-btn.secondary { background: var(--line); color: var(--text); }
.rate-btn.stop { background: var(--alert); color: var(--on-accent); }
</style>
