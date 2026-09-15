<script setup>
/**
 * A custom calendar-grid date picker (Monday-first), modeled on NSX's
 * batch-date-picker — so tapping a roast date opens THIS sheet instead of the
 * device's native OS calendar (which varies per Android build and ignored our
 * theme). Same contract as before: v-model in via modelValue, emits 'confirm'
 * with a 'YYYY-MM-DD' string or 'cancel'. Future dates are disabled (a bean
 * can't be roasted in the future).
 */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({ modelValue: { type: String, default: null } });
const emit = defineEmits(['confirm', 'cancel']);
const { t } = useI18n();

const pad = (n) => String(n).padStart(2, '0');
const toIso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

const today = new Date();
const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());

// Parse the incoming value (or default to today) into the selected date and the
// month the grid opens on.
function parse(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return { y: today.getFullYear(), mo: today.getMonth(), d: today.getDate() };
  return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
}

const init = parse(props.modelValue);
const selected = ref(toIso(init.y, init.mo, init.d)); // 'YYYY-MM-DD'
const viewYear = ref(init.y);
const viewMonth = ref(init.mo); // 0-11

const MONTHS = computed(() => t('datePicker.months').split(','));
const WEEKDAYS = computed(() => t('datePicker.weekdays').split(','));
const monthLabel = computed(() => `${MONTHS.value[viewMonth.value]} ${viewYear.value}`);

// Monday-first grid: JS getDay() is Sunday=0, so shift so Monday=0.
// Always render 6 rows (42 cells) to keep widget height consistent.
const cells = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate();
  const out = [];
  for (let i = 0; i < startOffset; i += 1) out.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const iso = toIso(viewYear.value, viewMonth.value, d);
    out.push({ d, iso, future: iso > todayIso, today: iso === todayIso, selected: iso === selected.value });
  }
  // Fill remaining cells to ensure 6 rows (42 cells total)
  while (out.length < 42) {
    out.push(null);
  }
  return out;
});

function shiftMonth(delta) {
  let m = viewMonth.value + delta;
  let y = viewYear.value;
  if (m < 0) { m = 11; y -= 1; }
  else if (m > 11) { m = 0; y += 1; }
  viewMonth.value = m;
  viewYear.value = y;
}
function shiftYear(delta) { viewYear.value += delta; }
function pick(cell) { if (cell && !cell.future) selected.value = cell.iso; }
</script>

<template>
  <div class="scrim" @click.self="emit('cancel')">
    <div class="modal dp-modal">
      <span class="m-title">{{ t('espresso.setRoastDate') }}</span>

      <div class="dp-head">
        <!-- SVG chevrons, not «‹›» glyphs: those carry their own asymmetric side
             bearings, so the ink sat left of centre in the button's square no
             matter how the box was centred. Drawn on the same 24x24 grid as
             the app's other icons (see .ov-back's own back chevron). -->
        <button class="dp-nav" :aria-label="t('datePicker.prevYear')" @click="shiftYear(-1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.5 5l-7 7 7 7M12.5 5l-7 7 7 7" /></svg>
        </button>
        <button class="dp-nav" :aria-label="t('datePicker.prevMonth')" @click="shiftMonth(-1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5l-7 7 7 7" /></svg>
        </button>
        <span class="dp-month">{{ monthLabel }}</span>
        <button class="dp-nav" :aria-label="t('datePicker.nextMonth')" @click="shiftMonth(1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5l7 7-7 7" /></svg>
        </button>
        <button class="dp-nav" :aria-label="t('datePicker.nextYear')" @click="shiftYear(1)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5l7 7-7 7M11.5 5l7 7-7 7" /></svg>
        </button>
      </div>

      <div class="dp-grid dp-weekdays">
        <span v-for="w in WEEKDAYS" :key="w" class="dp-wd">{{ w }}</span>
      </div>
      <div class="dp-grid dp-days">
        <template v-for="(cell, i) in cells" :key="i">
          <span v-if="!cell" class="dp-day empty"></span>
          <button
            v-else
            class="dp-day"
            :class="{ sel: cell.selected, today: cell.today }"
            :disabled="cell.future"
            @click="pick(cell)"
          >{{ cell.d }}</button>
        </template>
      </div>

      <div class="modal-actions">
        <button class="cancel" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button class="confirm" @click="emit('confirm', selected)">{{ t('common.confirm') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dp-modal { min-width: 440px; }
.dp-head { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 8px 0 16px; width: 440px; }
.dp-month { width: 200px; text-align: center; font-size: var(--fs-lg); font-weight: 700; letter-spacing: 0.04em; }
.dp-nav {
  flex: none; width: 52px; height: 52px; border: none; border-radius: 14px;
  display: flex; align-items: center; justify-content: center;
  background: var(--card-bg); color: var(--accent); cursor: pointer;
}
.dp-nav svg {
  width: 22px; height: 22px; stroke: currentColor; fill: none;
  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
}
.dp-grid { display: grid; grid-template-columns: repeat(7, 56px); gap: 8px; justify-content: center; }
.dp-weekdays { margin-bottom: 8px; }
.dp-wd { text-align: center; font-size: var(--fs-sm); font-weight: 600; color: var(--muted); text-transform: uppercase; min-width: 56px; }
.dp-day {
  aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 14px; background: var(--card-bg); color: var(--text);
  font-family: inherit; font-size: var(--fs-lg); font-weight: 600; cursor: pointer;
  min-width: 56px; min-height: 56px;
}
.dp-day.empty { background: none; }
.dp-day:disabled { opacity: 0.28; cursor: default; }
.dp-day.today { box-shadow: inset 0 0 0 2px var(--muted); }
.dp-day.sel { background: var(--accent); color: var(--on-accent); }
</style>
