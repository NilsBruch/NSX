<script setup>
/**
 * Wraps where a full-screen page (one with a Back button) is opened:
 *
 *   <PageTransition><BagsPanel v-if="showBags" … /></PageTransition>
 *
 * The page slides in from the right while the screen it covers slides out to
 * the left, side by side, and Back runs it in reverse (usePageStack.js).
 *
 * Teleported to <body> so the page is never INSIDE the screen being pushed
 * away: that screen moves by a transform, and a transform on an ancestor
 * carries its fixed overlays with it — the new page would slide off along
 * with the old one.
 *
 * `name` other than 'page' (the live shot, which must appear at once) turns
 * the push off but still closes out properly, so an overlay that opened
 * without a push can never leave the app pushed when it goes.
 */
import { pageEnter, pageLeave, pageLeft } from '../composables/usePageStack.js';

const props = defineProps({ name: { type: String, default: 'page' } });

function onEnter(el) { if (props.name === 'page') pageEnter(el); }
</script>

<template>
  <Teleport to="body">
    <Transition :name="name" @enter="onEnter" @before-leave="pageLeave" @after-leave="pageLeft">
      <slot />
    </Transition>
  </Teleport>
</template>
