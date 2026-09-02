<script setup>
/**
 * What is installed, and one big button to ask whether something newer exists.
 * Read-only by design: the bridge exposes GET /api/v1/update and no documented
 * way to START an update, so this reports and the Decent app installs. The
 * button re-reads the endpoint rather than pretending to trigger a
 * server-side check.
 *
 * The answer lives in the button's own label rather than a row of its own —
 * you press it to find out, so that is where the finding-out belongs. Release
 * notes are deliberately not shown: a changelog is reading material, and this
 * card is a one-line status.
 *
 * Both routes are missing on older gateway builds; the loaders swallow that
 * (see useSettings), so an absent `gatewayInfo` just leaves the version blank.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { gatewayInfo, loadGatewayInfo, appUpdate, loadAppUpdate } from '../../composables/useSettings.js';

const { t } = useI18n();

const checking = ref(false);

onMounted(() => {
  loadGatewayInfo();
  loadAppUpdate();
});

async function check() {
  if (checking.value) return;
  checking.value = true;
  try {
    await Promise.all([loadGatewayInfo(), loadAppUpdate()]);
  } finally {
    checking.value = false;
  }
}

// `phase` is an open set the gateway defines, so this asks the one question
// that matters and treats every unrecognised phase as "nothing to report"
// rather than mapping strings it has never seen.
const available = computed(() => appUpdate.value?.phase === 'available' && !!appUpdate.value?.latestVersion);
</script>

<template>
  <div class="swidget">
    <div class="sw-head">
      <span class="sw-title">{{ t('settingsPage.appTitle') }}</span>
      <span v-if="gatewayInfo?.fullVersion" class="sw-title sw-readout">{{ gatewayInfo.fullVersion }}</span>
    </div>
    <button class="tile sw-update" :class="{ 'sw-accent': available }" :disabled="checking" @click="check">
      {{ available ? t('settingsPage.updateAvailable', { version: appUpdate.latestVersion }) : t('settingsPage.checkUpdates') }}
    </button>
  </div>
</template>
