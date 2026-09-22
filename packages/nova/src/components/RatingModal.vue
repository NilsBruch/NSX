<script setup>
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ratingState, resolveRating } from '../composables/useModals.js';
import StarRating from './StarRating.vue';

const { t } = useI18n();
const draft = ref(0);
const fav = ref(false);
watch(() => ratingState.open, (open) => {
  if (!open) return;
  draft.value = ratingState.value;
  fav.value = ratingState.favorite;
});

const cancel = () => resolveRating(null);
// An object only when the heart was offered, so the recipe callers that never
// ask for it keep getting the plain number they always did.
const save = () => resolveRating(
  ratingState.withFavorite ? { rating: draft.value, favorite: fav.value } : draft.value,
);
// Clears the stars, not the heart: a shot you loved but no longer want scored
// is a real state, and the heart is its own answer.
const clear = () => { draft.value = 0; };
</script>

<template>
  <div v-if="ratingState.open" class="scrim" @click.self="cancel">
    <div class="modal rating-modal">
      <span class="m-title">{{ ratingState.title }}</span>
      <div class="rating-stars-row">
        <StarRating v-model="draft" :size="44" />
      </div>
      <div class="rating-value">{{ draft ? draft.toFixed(1) : t('rating.unrated') }}</div>
      <!-- Optional and separate from the stars: a favourite is not "five
           stars", it is the one you want to find again. -->
      <button
        v-if="ratingState.withFavorite" class="rating-fav" :class="{ on: fav }"
        role="switch" :aria-checked="fav" @click="fav = !fav"
      >
        <span class="rf-heart">{{ fav ? '♥' : '♡' }}</span>{{ t('rating.favorite') }}
      </button>
      <div class="modal-actions">
        <button class="cancel" @click="cancel">{{ t('common.cancel') }}</button>
        <button class="cancel" @click="clear">{{ t('rating.clear') }}</button>
        <button class="confirm" @click="save">{{ t('common.save') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rating-stars-row { display: flex; justify-content: center; padding: 10px 0 4px; }
.rating-value {
  text-align: center; font-size: var(--fs-md); font-weight: 700; color: var(--accent);
  font-variant-numeric: tabular-nums; min-height: 1.4em;
}
.rating-fav {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: 100%; margin: 10px 0 2px; padding: 10px;
  border: none; border-radius: var(--r-md); background: var(--card-bg);
  color: var(--muted); font-family: inherit; font-size: var(--fs-sm); font-weight: 600;
  cursor: pointer;
}
.rating-fav.on { color: var(--accent); }
.rf-heart { font-size: var(--fs-md); line-height: 1; }
</style>
