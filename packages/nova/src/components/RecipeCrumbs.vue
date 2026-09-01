<script setup>
/**
 * What a recipe is made of, shown while one is being made: Bean · Grinder ·
 * Profile, each filling in as it is chosen.
 *
 * Deliberately the SAME bubbles the Coffee page's recipe browser splits its
 * title into (.rov-identity / .rov-bubble). A user meets this arrangement once
 * while creating a recipe and then again every time they switch one — telling
 * the same story twice in the same shape is what makes it stick, and it costs
 * no new styling.
 *
 * The grinder bubble follows the same rule as everywhere else: with one
 * grinder configured it is implicit and drops out entirely (useCore's
 * singleGrinder), because a step with a single possible answer is not a step.
 */
import { useI18n } from 'vue-i18n';
import { singleGrinder } from '../composables/useCore.js';

defineProps({
  bean: { type: Object, default: null },
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
