<script setup>
/**
 * One shot in a Diary list. `scope` names what the surrounding list has
 * already established, and therefore what this row can leave out rather than
 * repeat on every line:
 *   'history' — nothing. The flat history mixes every coffee, so name them all.
 *   'profile' — one bean + one profile (the Browse drill-down). The grinder
 *               still varies shot to shot there, so it stays.
 *   'recipe'  — a whole recipe. findShotsForWorkflow matches on a key that
 *               INCLUDES the grinder, so every shot here has the same one by
 *               construction — printing it per row is pure noise.
 *
 * All the per-shot resolvers are core's (mapShotToWorkflow, resolveActualDose,
 * enjoymentToStars); the measured yield/ratio/duration come from useDiary's
 * lazily-filled shotMetrics cache, so they appear once the full shot arrives.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { shotMetrics } from '../composables/useDiary.js';
import { singleGrinder } from '../composables/useCore.js';

const props = defineProps({
  shot: { type: Object, required: true },
  scope: { type: String, default: 'history' }, // 'history' | 'profile' | 'recipe'
});

const showIdentity = computed(() => props.scope === 'history');
const showGrinder = computed(() => props.scope !== 'recipe' && !singleGrinder.value);

const { t } = useI18n();
const { NSXCore } = window;

const starLevel = (shot) => NSXCore.enjoymentToStars(shot?.annotations?.enjoyment);
const factsFor = (shot) => NSXCore.mapShotToWorkflow(shot);
const actualDose = (shot) => NSXCore.resolveActualDose(shot);
const metricsFor = (shot) => shotMetrics.get(shot.id) || null;
function durationLabel(shot) {
  const sec = metricsFor(shot)?.durationSec;
  return Number.isFinite(sec) ? `${Math.round(sec)}s` : '';
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}
</script>

<template>
  <span class="shot-body">
    <span class="shot-facts">
      <span class="fact"><b>{{ fmtDate(shot.timestamp) }}</b></span>
      <template v-if="showIdentity">
        <span class="fact">{{ factsFor(shot).coffeeRoaster }}</span>
        <span class="fact">{{ factsFor(shot).coffeeName }}</span>
      </template>
      <span v-else class="fact">
        <b>{{ actualDose(shot)?.toFixed(1) ?? '—' }}</b>g<template v-if="metricsFor(shot)"> → <b>{{ metricsFor(shot).yield?.toFixed(1) ?? '—' }}</b>{{ metricsFor(shot).yieldUnit }}{{ metricsFor(shot).estimated ? '*' : '' }}</template>
      </span>
    </span>
    <span class="shot-meta">
      <span v-if="showIdentity" class="rp-chip">{{ factsFor(shot).profileTitle }}</span>
      <span>{{ factsFor(shot).profileTemp }}</span>
      <span v-if="showGrinder"><b>{{ factsFor(shot).grinderModel }}</b></span>
      <span>{{ t('espresso.grindSize') }} <b>{{ factsFor(shot).grinderSetting }}</b></span>
      <span v-if="showIdentity">
        <b>{{ actualDose(shot)?.toFixed(1) ?? '—' }}</b>g<template v-if="metricsFor(shot)"> → <b>{{ metricsFor(shot).yield?.toFixed(1) ?? '—' }}</b>{{ metricsFor(shot).yieldUnit }}{{ metricsFor(shot).estimated ? '*' : '' }}
        (<b>{{ metricsFor(shot).ratio }}</b>)<template v-if="durationLabel(shot)">{{ ' ' + t('diary.in') + ' ' }}<b>{{ durationLabel(shot) }}</b></template></template>
      </span>
      <span v-else-if="metricsFor(shot)">
        (<b>{{ metricsFor(shot).ratio }}</b>)<template v-if="durationLabel(shot)">{{ ' ' + t('diary.in') + ' ' }}<b>{{ durationLabel(shot) }}</b></template>
      </span>
    </span>
  </span>
  <span class="stars">
    <svg v-for="n in 5" :key="n" viewBox="0 0 24 24" :class="{ on: n <= starLevel(shot) }" aria-hidden="true">
      <path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z" />
    </svg>
  </span>
</template>
