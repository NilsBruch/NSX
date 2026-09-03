<script setup>
/**
 * Phone shell: a single scrollable content area plus a bottom tab bar,
 * swapped in for the tablet `.stage` by App.vue when useLayout.js's `isPhone`
 * is true. `phoneTab` (usePhoneNav.js) is module-level rather than a local
 * ref, so useAccent.js and any screen that wants to jump tabs can reach it.
 *
 * <KeepAlive> keeps each tab's own local state (an open search field, a
 * scroll position) alive across a tab switch — every screen's real data
 * (recipes, shots, diary drill-down) is already module-level state in its
 * composable and would survive regardless.
 */
import { watch } from 'vue';
import RecipesTab from './tabs/RecipesTab.vue';
import MachineTab from './tabs/MachineTab.vue';
import DiaryTab from './tabs/DiaryTab.vue';
import SettingsTab from './tabs/SettingsTab.vue';
import PhoneTabBar from './PhoneTabBar.vue';
import { phoneTab } from '../../composables/usePhoneNav.js';
import { diaryState, setView } from '../../composables/useDiary.js';

const TAB_COMPONENTS = { recipes: RecipesTab, machine: MachineTab, diary: DiaryTab, settings: SettingsTab };

// Recipes and Diary are two separate phone tabs built on the SAME tablet
// state (diaryState.view: 'recipes' | 'browse' | 'full') — the tablet has
// them as one page's segmented control, the phone splits them by tab
// instead. Whichever one is the active phone tab has to own that value, so
// switching tabs keeps recipeRows/cycleSort resolving against the right
// vocabulary (RECIPE_SORTS vs the browse/full sort set — see useDiary.js).
// Lives here rather than in either tab so it applies whether or not
// <KeepAlive> has already mounted the target tab.
// Trade-off accepted: leaving Diary's 'full' history for Recipes and back
// resets Diary to 'browse' rather than restoring 'full' — remembering the
// diary sub-view across a trip through another tab is more state than this
// is worth.
watch(
  phoneTab,
  (tab) => {
    if (tab === 'recipes') { if (diaryState.view !== 'recipes') setView('recipes'); }
    else if (tab === 'diary' && diaryState.view === 'recipes') setView('browse');
  },
  { immediate: true }
);
</script>

<template>
  <div class="phone-shell">
    <main class="phone-main">
      <KeepAlive>
        <component :is="TAB_COMPONENTS[phoneTab]" />
      </KeepAlive>
    </main>
    <PhoneTabBar />
  </div>
</template>
