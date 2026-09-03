<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { TABS } from '../router/index.js';

const props = defineProps({
  side: { type: String, required: true }, // 'left' | 'right'
});

const route = useRoute();
const tabs = computed(() => TABS.filter((t) => t.side === props.side));
</script>

<template>
  <nav :class="['rail', `rail-${side}`]" :aria-label="`Main navigation ${side}`">
    <RouterLink
      v-for="(tab, i) in tabs"
      :key="tab.name"
      :to="tab.path"
      custom
      v-slot="{ navigate, isActive }"
    >
      <button
        class="tab"
        :class="{ active: isActive }"
        :style="{ '--accent': tab.accent, '--tab-i': i }"
        :aria-label="$t(`tab.${tab.name}`)"
        :title="$t(`tab.${tab.name}`)"
        @click="navigate"
      >
        <!-- The page-colored "liquid" that pours out of the page on select and
             drains back into it on deselect — see the rail section in app.css.
             --tab-i is this tab's row in the rail: app.css turns it into the
             tab's y on screen, so the island and the liquid pick up the right
             slice of the screen-wide light. -->
        <span class="tab-liquid" aria-hidden="true"></span>
        <svg viewBox="0 0 24 24" aria-hidden="true" v-html="tab.icon"></svg>
      </button>
    </RouterLink>
  </nav>
</template>
