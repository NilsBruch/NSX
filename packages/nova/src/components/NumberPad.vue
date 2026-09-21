<script setup>
/**
 * A single shared instance (mounted once in App.vue), driven by useModals.js's
 * numberPadState — see openNumberPad() for how views open it. Replaces the
 * scroll-wheel for genuine free numeric entry (dose, grind, yield, temp,
 * calibration values, brightness, …), matching NSX's real numeric keyboard
 * (openFieldPicker with inputMode: 'numeric') rather than its drum-wheel
 * openNumberPicker, which Nova's WheelPicker already covers for discrete
 * value lists (e.g. schedule time-of-day).
 */
import { useI18n } from 'vue-i18n';
import { computed, watch, ref } from 'vue';
import { numberPadState, resolveNumberPad } from '../composables/useModals.js';

const { t } = useI18n();

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

// Which field digits currently go into — only meaningful when
// numberPadState.linked is set; otherwise it's always 'primary'. `secondary`
// holds that field's own draft string (the primary field's draft lives
// directly on numberPadState.value, as before linked fields existed).
const active = ref('primary'); // 'primary' | 'secondary'
const secondary = ref('');

// The pre-filled value (the field's current value) is shown selected, like a
// desktop number input on focus: the first key press replaces it outright
// instead of appending to it — otherwise every edit needs a manual clear first.
const fresh = ref(true);
watch(() => numberPadState.open, (open) => {
  if (!open) return;
  fresh.value = true;
  active.value = 'primary';
  secondary.value = numberPadState.linked ? String(numberPadState.linked.value ?? '') : '';
});

// Tapping a field makes IT the one digits go into — mirrors a real number
// input's focus, and is the only way back to editing the primary field once
// the linked one has been tapped.
function selectField(which) {
  if (active.value === which) return;
  active.value = which;
  fresh.value = true;
}

function activeDraft() { return active.value === 'primary' ? numberPadState.value : secondary.value; }
function setActiveDraft(v) {
  if (active.value === 'primary') numberPadState.value = v;
  else secondary.value = v;
}

function press(key) {
  let v = activeDraft();
  if (fresh.value) {
    fresh.value = false;
    v = key === 'back' ? '' : key === '.' ? '0.' : key;
  } else if (key === 'back') {
    v = v.slice(0, -1);
  } else if (key === '.') {
    // A multiPoint field (a dotted grind setting like "1.2.4") takes as many
    // points as the grinder's scale has parts; every other field takes one.
    // Two in a ROW is refused either way — "1..2" is nobody's value.
    const allowed = numberPadState.multiPoint ? !v.endsWith('.') : !v.includes('.');
    if (!allowed) { setActiveDraft(v); return; }
    if (v === '') v = '0.';
    else v += '.';
  } else {
    v += key;
  }
  setActiveDraft(v);

  // Keep the OTHER field in sync — editing either one updates both, so the
  // resolved (primary) value is always current regardless of which field the
  // user actually typed into.
  const linked = numberPadState.linked;
  if (!linked) return;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return;
  if (active.value === 'primary') secondary.value = linked.toLinked(n);
  else numberPadState.value = linked.toPrimary(n);
}
function cancel() { resolveNumberPad(null); }
function confirm() {
  const raw = numberPadState.value;
  if (raw === '') { resolveNumberPad(null); return; }
  // Clamp only on confirm, and only when the caller asked for it — see
  // openNumberPad's min/max note. A half-typed value ("1" on its way to "100")
  // must not be clamped mid-entry.
  // A dotted value isn't a number to clamp — see openNumberPad's multiPoint.
  if (numberPadState.multiPoint) { resolveNumberPad(raw); return; }
  const { min, max } = numberPadState;
  const n = parseFloat(raw);
  if (Number.isFinite(n)) {
    let clamped = n;
    if (min != null) clamped = Math.max(min, clamped);
    if (max != null) clamped = Math.min(max, clamped);
    if (clamped !== n) { resolveNumberPad(String(clamped)); return; }
  }
  resolveNumberPad(raw);
}
const linkedLabel = computed(() => numberPadState.linked?.label ?? '');
</script>

<template>
  <div v-if="numberPadState.open" class="scrim" @click.self="cancel">
    <div class="modal">
      <span class="m-title">{{ numberPadState.title }}</span>
      <!-- Two fields when `linked` (e.g. target yield + brew ratio): tap
           either to make it the one digits go into (active class + the
           existing fresh-on-select tint); the other stays in sync live. -->
      <div class="npad-fields" :class="{ dual: numberPadState.linked }">
        <button
          class="npad-display"
          :class="{ fresh: fresh && active === 'primary', active: numberPadState.linked && active === 'primary' }"
          @click="selectField('primary')"
        >{{ numberPadState.value || '0' }}<span v-if="numberPadState.unit" class="u">{{ numberPadState.unit }}</span></button>

        <div v-if="numberPadState.linked" class="npad-linked">
          <span class="npad-linked-label">{{ linkedLabel }}</span>
          <button
            class="npad-display npad-secondary"
            :class="{ fresh: fresh && active === 'secondary', active: active === 'secondary' }"
            @click="selectField('secondary')"
          ><span v-if="numberPadState.linked.prefix" class="npad-linked-prefix">{{ numberPadState.linked.prefix }}</span>{{ secondary || '0' }}<span v-if="numberPadState.linked.unit" class="u">{{ numberPadState.linked.unit }}</span></button>
        </div>
      </div>
      <div class="npad-grid">
        <button v-for="k in KEYS" :key="k" class="npad-key" :class="{ back: k === 'back' }" @click="press(k)">
          <svg v-if="k === 'back'" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4H8l-6 8 6 8h13a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z" /><path d="M18 9l-6 6M12 9l6 6" /></svg>
          <template v-else>{{ k }}</template>
        </button>
      </div>
      <div class="modal-actions">
        <button class="cancel" @click="cancel">{{ t('common.cancel') }}</button>
        <button class="confirm" @click="confirm">{{ t('common.confirm') }}</button>
      </div>
    </div>
  </div>
</template>
