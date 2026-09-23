<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { grinders, singleGrinder, formatGrinderLabel } from '../composables/useCore.js';
import { skinSettings } from '../composables/useSettings.js';
import StarRating from './StarRating.vue';
import { fmtTemp } from '../composables/useUnits.js';

/**
 * One recipe card's markup, lifted out of RecipeOverlay.vue so RecipeBrowser.vue
 * (the coffee page's graph layout) renders the identical card design instead of
 * a second copy that would drift from it. Pointer/press handlers are the
 * caller's own concern — they land on this component's single root element
 * (.rp-card) via Vue's normal attribute fallthrough, so RecipeOverlay's
 * long-press-for-menu gesture works unchanged with no props for it here.
 */
const props = defineProps({
  entry: { type: Object, required: true },
  current: { type: Boolean, default: false },
});
const { t } = useI18n();

function grinderDisplay(entry) {
  const model = entry.grinderModel;
  if (!model || model === '—') return model;
  const g = grinders.value.find((x) => x.id === entry.grinderId) ?? grinders.value.find((x) => x.model === model);
  return g ? formatGrinderLabel(g) : model;
}
const num = (v, digits = 1) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '—');
const ratio = (entry) => window.NSXCore.calcRatio(Number(entry.targetDoseWeight) || 0, Number(entry.targetYield) || 0);
const tags = computed(() => (Array.isArray(props.entry.tags) ? props.entry.tags : []));
</script>

<template>
  <div class="rp-card" :class="{ current }">
    <div class="rp-head">
      <!-- The roaster's line carries the card's markers at its right edge:
           the pin, then the rating as one star plus the number ("4.5"). Both
           live INSIDE the line rather than above it because .rp-head is a
           COLUMN — a sibling would take a row of its own and make a marked
           card taller than its neighbours. Putting the rating here instead of
           beside the coffee name gives the name the whole width back; five
           stars beside it cropped every name to a few letters. -->
      <span class="rp-roaster">
        <span class="rp-roaster-text">{{ entry.coffeeRoaster }}</span>
        <svg v-if="entry.pinned" class="rp-pin" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" /><path d="M12 14v7" />
        </svg>
        <StarRating
          v-if="Number(entry.rating) > 0"
          class="rp-rating"
          :model-value="Number(entry.rating)"
          readonly
          compact
          :size="15"
        />
      </span>
      <span class="rp-name">{{ entry.coffeeName }}</span>
    </div>
    <div class="rp-rows">
      <div v-if="!singleGrinder" class="rp-row-duo">
        <div class="rp-row">
          <span class="rp-label">{{ t('recipePicker.lGrinder') }}</span>
          <span class="rp-val">{{ grinderDisplay(entry) }}</span>
        </div>
        <div class="rp-row">
          <span class="rp-label">{{ t('recipePicker.lGrind') }}</span>
          <span class="rp-val">{{ entry.grinderSetting }}</span>
        </div>
      </div>
      <div v-else class="rp-row">
        <span class="rp-label">{{ t('recipePicker.lGrind') }}</span>
        <span class="rp-val">{{ entry.grinderSetting }}</span>
      </div>
      <div class="rp-row-duo">
        <div class="rp-row">
          <span class="rp-label">{{ t('recipePicker.lBeverage') }}</span>
          <span class="rp-val">{{ num(entry.targetDoseWeight) }} → {{ num(entry.targetYield) }} g <span class="rp-ratio">({{ ratio(entry) }})</span></span>
        </div>
        <div class="rp-row">
          <span class="rp-label">{{ t('recipePicker.lTemp') }}</span>
          <span class="rp-val">{{ fmtTemp(entry.groupTemp) }}</span>
        </div>
      </div>
    </div>
    <div class="rp-row rp-profile">
      <span class="rp-label">{{ t('recipePicker.lProfile') }}</span>
      <!-- Plain .rp-val, not a pill: the profile is one of the card's FACTS,
           like the grinder or the dose, so it's read the same way. The pill it
           used to be made it look like a control, and put a third shape on a
           card that already carries label/value pairs and (accented) tags. -->
      <span class="rp-val">{{ entry.profileTitle }}</span>
    </div>
    <!-- The recipe's CURRENT tags (the hold menu edits them). A shot shows the
         tags it was pulled with instead, off its own record — see useRecipe's
         `tags`, and the shot view's own row.
         Only rendered when there ARE tags. It used to render empty so every
         card matched height whether tagged or not, which bought that
         evenness with a band of nothing under every untagged card — and most
         are untagged, so the list paid for it everywhere to look tidy in the
         rare case. A tagged card simply being taller reads fine. -->
    <div v-if="skinSettings.showTags && tags.length" class="rp-tags">
      <span v-for="tag in tags" :key="tag" class="rp-tag">{{ tag }}</span>
    </div>
  </div>
</template>
