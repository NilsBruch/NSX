<script setup>
/**
 * What a recipe is made of, shown while one is being made: Bean · Bag ·
 * Grinder · Profile, each filling in as it is chosen — same order as the
 * wizard's own steps (RecipePicker.vue).
 *
 * Deliberately the SAME bubbles the Coffee page's recipe browser splits its
 * title into (.rov-identity / .rov-bubble). A user meets this arrangement once
 * while creating a recipe and then again every time they switch one — telling
 * the same story twice in the same shape is what makes it stick, and it costs
 * no new styling. The Coffee page's own identity row has no Bag bubble (it
 * shows only Bean/Grinder/Profile — see RecipeIdentityBubbles.vue), so this is
 * the one place these four bubbles appear together.
 *
 * The grinder bubble follows the same rule as everywhere else: with one
 * grinder configured it is implicit and drops out entirely (useCore's
 * singleGrinder), because a step with a single possible answer is not a step.
 */
import { useI18n } from 'vue-i18n';
import { singleGrinder, formatShortDate } from '../composables/useCore.js';

defineProps({
  bean: { type: Object, default: null },
  batch: { type: Object, default: null }, // { id, roastDate } | null
  grinder: { type: Object, default: null },
  profile: { type: Object, default: null },
});

const { t } = useI18n();
const beanName = (b) => [b?.roaster, b?.name].filter(Boolean).join(' ');
</script>

<template>
  <div class="rov-identity crumbs">
    <div class="rov-bubble" :class="{ filled: bean }">
      <span class="rov-bubble-label">{{ t('espresso.bean') }}</span>
      <span class="rov-bubble-name">{{ beanName(bean) || '—' }}</span>
    </div>
    <div class="rov-bubble" :class="{ filled: batch }">
      <span class="rov-bubble-label">{{ t('espresso.bag') }}</span>
      <span class="rov-bubble-name">{{ batch?.roastDate ? formatShortDate(batch.roastDate) : (batch ? t('diary.empty') : '—') }}</span>
    </div>
    <div v-if="!singleGrinder" class="rov-bubble" :class="{ filled: grinder }">
      <span class="rov-bubble-label">{{ t('espresso.grinder') }}</span>
      <span class="rov-bubble-name">{{ grinder?.model || '—' }}</span>
    </div>
    <div class="rov-bubble" :class="{ filled: profile }">
      <span class="rov-bubble-label">{{ t('espresso.profile') }}</span>
      <span class="rov-bubble-name">{{ profile?.profile?.title || profile?.title || '—' }}</span>
    </div>
  </div>
</template>
