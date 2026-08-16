<script setup>
/** Step 1 of "new recipe": pick the bean — or add one right here, so starting a
 *  recipe for a coffee you just opened doesn't mean bailing out to the Diary
 *  first. A bean added here is a real Diary bean (BeanEditor writes it); this
 *  screen just carries it straight into step 2 instead of making the user find
 *  it again in the list. */
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { beans } from '../composables/useCore.js';
import { openTextField } from '../composables/useModals.js';
import BeanEditor from './BeanEditor.vue';

// The "Step 1" badge only makes sense inside the new-recipe wizard; swapping
// the bean of an existing recipe (the Espresso page's bean tile) is a
// one-step action, so that caller turns it off.
defineProps({ showStep: { type: Boolean, default: true } });
const emit = defineEmits(['pick', 'back']);
const { t } = useI18n();

const showEditor = ref(false);

function onBeanSaved(bean) {
  showEditor.value = false;
  if (bean) emit('pick', bean); // straight on to the profile step
}

// Same search pattern as RecipePicker/Diary — a text-field modal rather than
// a live inline input, matching every other list-with-search screen in Nova.
const query = ref('');
const visibleBeans = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return beans.value;
  return beans.value.filter((bean) =>
    [bean.roaster, bean.name, bean.country, bean.processing].some((v) => String(v || '').toLowerCase().includes(q))
  );
});
async function openSearch() {
  const value = await openTextField({ title: t('recipePicker.search'), value: query.value, placeholder: t('recipePicker.searchPlaceholder') });
  if (value !== null) query.value = value;
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="emit('back')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('common.back') }}
      </button>
      <span class="ov-title">{{ t('recipePicker.chooseBean') }}</span>
      <span v-if="showStep" class="ov-title" style="flex: 0; color: var(--accent)">{{ t('recipePicker.step1') }}</span>
    </div>
    <div class="list">
      <button v-for="bean in visibleBeans" :key="bean.id" class="list-row" @click="emit('pick', bean)">
        <span class="rmeta">
          {{ bean.roaster || t('recipePicker.noRoaster') }} – {{ bean.name }}
          <span class="rsub">{{ [bean.country, bean.processing].filter(Boolean).join(' · ') }}</span>
        </span>
        <span class="chev">›</span>
      </button>
      <div v-if="beans.length && !visibleBeans.length" class="list-row"><span class="rsub">{{ t('diary.noResults') }}</span></div>
      <div v-if="!beans.length" class="list-row"><span class="rsub">{{ t('recipePicker.noBeansYet') }}</span></div>
    </div>

    <div class="prep-bottom">
      <button class="btn" @click="showEditor = true">+ {{ t('diary.newBean') }}</button>
      <button v-if="query" class="filter-chip" @click="query = ''">
        {{ t('diary.filteredBy', { q: query }) }}<span class="x">×</span>
      </button>
      <button class="rbtn" :aria-label="t('recipePicker.search')" @click="openSearch">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></svg>
      </button>
    </div>

    <BeanEditor v-if="showEditor" :bean="null" @close="showEditor = false" @saved="onBeanSaved" />
  </div>
</template>
