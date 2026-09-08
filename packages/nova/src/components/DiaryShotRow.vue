<script setup>
/**
 * One shot in a Diary list, as a card: a date rail, then three lines that each
 * answer a different question, then a thumbnail plot of the extraction.
 *
 *   rail    WHEN  — day loud, month and time quiet (a list is mostly one month)
 *   title   WHAT  — the coffee
 *   setup   HOW   — profile, grinder, grind, temp: the settings, dimmed
 *   result  WHAT CAME OUT — dose -> yield, ratio, time, in the accent
 *   plot    WHAT IT DID — pressure/flow/weight curves, no axes
 *
 * The previous version put all of that on two lines at one weight, which read
 * as a wall of numbers: nothing to scan down, and the coffee's name had no
 * more presence than its brew temperature. Splitting by QUESTION is what makes
 * a column of these scannable — you read down the bold line to find a shot,
 * then across one card to judge it.
 *
 * `scope` names what the surrounding list has already established, and
 * therefore what this card can leave out rather than repeat on every row:
 *   'history' — nothing. The flat history mixes every coffee, so name them all.
 *   'profile' — one bean + one profile (the Browse drill-down). The grinder
 *               still varies shot to shot there, so it stays.
 *   'recipe'  — a whole recipe. findShotsForWorkflow matches on a key that
 *               INCLUDES the grinder, so every shot here has the same one by
 *               construction — printing it per row is pure noise.
 * Outside 'history' the title line has no coffee to carry (the list is already
 * one coffee), so the result moves up into it and the card keeps its shape.
 *
 * All the per-shot resolvers are core's (mapShotToWorkflow, resolveActualDose,
 * enjoymentToStars); the measured yield/ratio/duration and the plot come from
 * useDiary's lazily-filled shotMetrics cache, so they appear once the full
 * shot arrives.
 */
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { shotMetrics } from '../composables/useDiary.js';
import { singleGrinder, formatDateParts } from '../composables/useCore.js';
import ShotSparkline from './ShotSparkline.vue';

const props = defineProps({
  shot: { type: Object, required: true },
  scope: { type: String, default: 'history' }, // 'history' | 'profile' | 'recipe'
});

const showIdentity = computed(() => props.scope === 'history');
const showGrinder = computed(() => props.scope !== 'recipe' && !singleGrinder.value);

const { t } = useI18n();
const { NSXCore } = window;

const facts = computed(() => NSXCore.mapShotToWorkflow(props.shot));
const metrics = computed(() => shotMetrics.get(props.shot.id) || null);
const when = computed(() => formatDateParts(props.shot.timestamp));
const stars = computed(() => NSXCore.enjoymentToStars(props.shot?.annotations?.enjoyment));
const dose = computed(() => NSXCore.resolveActualDose(props.shot));

const duration = computed(() => {
  const sec = metrics.value?.durationSec;
  return Number.isFinite(sec) ? `${Math.round(sec)}s` : '';
});

/** "18.0g → 40.8g" — the yield half only once the full shot has landed. */
const yieldText = computed(() => {
  const d = dose.value?.toFixed(1) ?? '—';
  const m = metrics.value;
  if (!m) return `${d}g`;
  return `${d}g → ${m.yield?.toFixed(1) ?? '—'}${m.yieldUnit}${m.estimated ? '*' : ''}`;
});
</script>

<template>
  <span class="shot-card-in">
    <span class="sc-rail">
      <b class="sc-day">{{ when.day }}</b>
      <span class="sc-month">{{ when.month }}</span>
      <span class="sc-time">{{ when.time }}</span>
    </span>

    <span class="sc-body">
      <span class="sc-title">
        <template v-if="showIdentity">{{ facts.coffeeName }}<span class="sc-dash"> — </span>{{ facts.coffeeRoaster }}</template>
        <template v-else>{{ yieldText }}</template>
      </span>

      <span class="sc-setup">
        <span v-if="showIdentity">{{ facts.profileTitle }}</span>
        <span v-if="showGrinder">{{ facts.grinderModel }}</span>
        <span>{{ t('espresso.grindSize') }} {{ facts.grinderSetting }}</span>
        <span>{{ facts.profileTemp }}</span>
      </span>

      <span class="sc-result">
        <template v-if="showIdentity"><b>{{ yieldText }}</b></template>
        <!-- A shot the machine stopped without a weight has no ratio to print.
             calcRatio already returns an em dash for that, but on this line it
             lands next to the yield's own em dash ("18.0g → —g — 16s"), which
             reads as a typo rather than as missing data. Drop it instead. -->
        <b v-if="metrics && metrics.ratio !== '—'">{{ metrics.ratio }}</b>
        <span v-if="duration" class="sc-dur">{{ duration }}</span>
      </span>
    </span>

    <!-- Stars sit ABOVE the plot rather than beside the text: the reference
         this card follows has no rating at all, but Nova's history has always
         shown one and dropping it would lose information. Stacked here they
         share the card's right column with the plot — a "how it went" column,
         judged and measured — instead of competing with the numbers. -->
    <span class="sc-aside">
      <span class="stars">
        <svg v-for="n in 5" :key="n" viewBox="0 0 24 24" :class="{ on: n <= stars }" aria-hidden="true">
          <path d="M12 3l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3-5.6-3.3-5.6 3.3 1.4-6.3-4.8-4.3 6.4-.6z" />
        </svg>
      </span>
      <ShotSparkline :spark="metrics?.spark" />
    </span>
  </span>
</template>
