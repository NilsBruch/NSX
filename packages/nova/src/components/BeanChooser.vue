<script setup>
/** First half of "new recipe": pick the bean — or add one right here, so starting a
 *  recipe for a coffee you just opened doesn't mean bailing out to the Diary
 *  first. A bean added here is a real Diary bean (BeanEditor writes it); this
 *  screen just carries it straight on to the profile instead of making the
 *  user find it again in the list.
 *
 *  No step counter: the flow is two screens with a Back button, which is its
 *  own progress indicator, and the same component is also used on its own to
 *  swap an existing recipe's bean — where "Step 1 of 2" was simply untrue. */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { beans, shots } from '../composables/useCore.js';
import { shotMatchesBean } from '../composables/useDiary.js';
import { vScrollEdges } from '../composables/useScrollEdges.js';
import { openTextField } from '../composables/useModals.js';
import BeanEditor from './BeanEditor.vue';

const emit = defineEmits(['pick', 'back']);
const { t } = useI18n();
const { NSXCore } = window;

const showEditor = ref(false);

function onBeanSaved(bean) {
  showEditor.value = false;
  if (bean) emit('pick', bean); // straight on to the profile step
}

// Same search pattern as RecipePicker/Diary — a text-field modal rather than
// a live inline input, matching every other list-with-search screen in Nova.
const query = ref('');

/**
 * Roaster first, then that roaster's beans — the Diary's browse structure, on
 * the screen you reach from "+ recipe". A flat "Roaster – Bean" list made the
 * roaster a prefix repeated down the page; here it is the thing you pick
 * first, and the second screen is short enough to read at a glance.
 *
 * Archived beans stay out: they are bags you are done with, and starting a new
 * recipe on one is not what the button was pressed for. (The Diary is where an
 * archived bean is still reachable, via "Show all".)
 */
const activeBeans = computed(() => beans.value.filter((b) => !b.archived));

const matches = (bean, q) =>
  [bean.roaster, bean.name, bean.country, bean.processing]
    .some((v) => String(v || '').toLowerCase().includes(q));

const foundBeans = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? activeBeans.value.filter((b) => matches(b, q)) : activeBeans.value;
});

/**
 * The three beans most recently brewed, above the library — starting a recipe
 * is usually about the bag already open, and finding it meant a roaster tap
 * and then a bean tap every time. Read from the shot history (core's
 * recentFromShots), not from the recipes, so it follows what was actually
 * pulled. Archived beans are out for the same reason they are out of the list
 * below. Hidden while searching: a search is already a narrower question.
 */
const recentBeans = computed(() => {
  if (query.value.trim()) return [];
  return NSXCore.recentFromShots(
    shots.value,
    (shot) => activeBeans.value.find((b) => shotMatchesBean(shot, b)) ?? null,
  );
});

const roasterGroups = computed(() => {
  const byRoaster = new Map();
  for (const bean of foundBeans.value) {
    // '—' for a bean with no roaster, exactly as the Diary groups them: the
    // preset arrives as one of the Diary's own group names, and a translated
    // "No roaster" here would simply never match it.
    const key = bean.roaster || '—';
    if (!byRoaster.has(key)) byRoaster.set(key, []);
    byRoaster.get(key).push(bean);
  }
  return [...byRoaster.entries()].map(([name, list]) => ({ name, beans: list }));
});

// Seeded from wherever the caller already was — the Diary's "+" hands over the
// roaster the user is standing in, so the wizard doesn't ask them to find it
// again. An unknown or now-empty roaster falls back to the list via the watch
// below, so a stale name can't strand anyone on an empty screen.
const props = defineProps({ presetRoaster: { type: String, default: '' } });
const roaster = ref(props.presetRoaster || null); // null = showing roasters
const beansInRoaster = computed(() =>
  roasterGroups.value.find((g) => g.name === roaster.value)?.beans ?? []
);
// A search that empties the open roaster drops back to the list rather than
// leaving the user on a screen with nothing on it.
watch(foundBeans, () => {
  if (roaster.value && !beansInRoaster.value.length) roaster.value = null;
});

const drill = ref('drill-fwd');
function enterRoaster(name) { drill.value = 'drill-fwd'; roaster.value = name; }
function leaveRoaster() { drill.value = 'drill-back'; roaster.value = null; }
function onBack() { roaster.value ? leaveRoaster() : emit('back'); }
async function openSearch() {
  const value = await openTextField({ title: t('recipePicker.search'), value: query.value, placeholder: t('recipePicker.searchPlaceholder') });
  if (value !== null) query.value = value;
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top">
      <button class="ov-back" @click="onBack">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('common.back') }}
      </button>
      <!-- The wizard puts its progress bubbles here, on the header's own row;
           used on its own (swapping an existing recipe's bean) the title
           stands instead — the bubbles would be telling a story of one step. -->
      <slot name="crumbs"><span class="ov-title">{{ t('recipePicker.chooseBean') }}</span></slot>
      <!-- Reserves exactly the width of the profile step's show-hidden button,
           so the progress bubbles sit in the same place on both screens instead
           of jumping sideways when the wizard advances. It carries the same
           classes and the same 15px glyph box as the real thing rather than a
           measured width, so it cannot drift out of step with it; hidden by
           visibility, which keeps the space it is there to hold. -->
      <span v-if="$slots.crumbs" class="sort-btn lg icon-only" aria-hidden="true" style="visibility: hidden">
        <svg viewBox="0 0 24 24"></svg>
      </span>
    </div>
    <!-- Two panes on one stage, sliding the same way the Diary's levels do. -->
    <div class="drill-stage">
      <Transition :name="drill">
        <div v-if="!roaster" key="roasters" v-scroll-edges class="list list-cards">
          <div class="lc-inner">
            <!-- Straight to the bean, skipping the roaster step: these are the
                 bags actually in use. A hairline, not a heading with a gap,
                 keeps them part of the same list rather than a second one. -->
            <template v-if="recentBeans.length">
              <span class="list-label">{{ t('common.recent') }}</span>
              <button v-for="bean in recentBeans" :key="`recent-${bean.id}`" class="list-row" @click="emit('pick', bean)">
                <span class="rmeta rmeta-inline">
                  <span class="bean-name">{{ bean.name }}</span>
                  <span class="rsub">{{ bean.roaster || '—' }}</span>
                </span>
                <span class="chev">›</span>
              </button>
              <div class="list-split"></div>
              <span class="list-label">{{ t('common.library') }}</span>
            </template>
            <button v-for="g in roasterGroups" :key="g.name" class="list-row" @click="enterRoaster(g.name)">
              <span class="rmeta">{{ g.name }}<span class="rsub">{{ g.beans.length }} bean{{ g.beans.length !== 1 ? 's' : '' }}</span></span>
              <span class="chev">›</span>
            </button>
            <div v-if="activeBeans.length && !roasterGroups.length" class="list-row"><span class="rsub">{{ t('diary.noResults') }}</span></div>
            <div v-if="!activeBeans.length" class="list-row"><span class="rsub">{{ t('recipePicker.noBeansYet') }}</span></div>
          </div>
        </div>
        <div v-else key="beans" v-scroll-edges class="list list-cards">
          <div class="lc-inner">
            <button v-for="bean in beansInRoaster" :key="bean.id" class="list-row" @click="emit('pick', bean)">
              <span class="rmeta rmeta-inline">
                <span class="bean-name">{{ bean.name }}</span>
                <span v-if="[bean.country, bean.processing].filter(Boolean).length" class="rsub">
                  {{ [bean.country, bean.processing].filter(Boolean).join(' · ') }}
                </span>
              </span>
              <span class="chev">›</span>
            </button>
          </div>
        </div>
      </Transition>
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

    <PageTransition>
      <BeanEditor v-if="showEditor" :bean="null" @close="showEditor = false" @saved="onBeanSaved" />
    </PageTransition>
  </div>
</template>
