<script setup>
/**
 * A card holding a row of navigation tiles — the settings page's buttons, in
 * the groups they fall into. Untitled: the icons and labels say what each one
 * is, and a heading over three self-describing buttons only repeated them.
 * The grouping still reads, because each group is its own card.
 */
defineProps({
  // [{ id, label, icon (svg path d), wide? }] — `wide` spans both columns, for
  // a group with an odd number of tiles where one is the obvious one to widen
  // rather than leave a hole beside it.
  tiles: { type: Array, required: true },
});
defineEmits(['pick']);
</script>

<template>
  <div class="swidget swidget-tiles">
    <div class="sw-tiles">
      <button v-for="tile in tiles" :key="tile.id" class="tile" :class="{ 'tile-wide': tile.wide }" @click="$emit('pick', tile.id)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="tile.icon" /></svg>
        <span class="tl">{{ tile.label }}</span>
      </button>
    </div>
  </div>
</template>
