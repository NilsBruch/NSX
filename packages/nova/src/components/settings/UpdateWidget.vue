<script setup>
/**
 * What is installed — the Decent app and this skin — and whether either has
 * something newer waiting.
 *
 * Who answers what:
 *  - "is there something newer": GitHub release tags, via core's update domain.
 *    The gateway cannot answer it on desktop (its own checker reports phase
 *    "idle" with a null latestVersion there), so a badge driven off
 *    /api/v1/update was blank on exactly the platforms in use.
 *  - "install it": only the gateway can. For the skin that always works — it
 *    re-downloads from the source it recorded at install time, and the page
 *    reloads into the new files. For the app it is Android-only (`installable`
 *    on the live ws/v1/update state); everywhere else the release page is the
 *    only way through, so that is what the button offers.
 *
 * Release notes are deliberately not shown: a changelog is reading material,
 * and this card is a status line with one action each.
 *
 * Both gateway routes are missing on older builds; the loaders swallow that
 * (see useSettings), so an absent `gatewayInfo` just leaves the version blank.
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  gatewayInfo, loadGatewayInfo,
  appUpdate, loadAppUpdate, appRelease, skinRelease, SKIN_VERSION,
  loadReleaseChecks, startAppUpdateChannel, stopAppUpdateChannel,
  sendAppUpdateCheck, installAppUpdate, runSkinUpdate,
} from '../../composables/useSettings.js';
import { showToast } from '../../composables/useToast.js';

const { t } = useI18n();

const checking = ref(false);
const updatingSkin = ref(false);
const skinNote = ref('');

onMounted(() => {
  loadGatewayInfo();
  loadReleaseChecks();
  // The REST snapshot is the fallback for a gateway with no ws/v1/update: the
  // socket overwrites it the moment it connects, but without it there would be
  // no `installable` at all on an older build.
  loadAppUpdate();
  startAppUpdateChannel();
});

// The socket belongs to this card, not to the session: leaving Settings should
// not keep a command channel open behind the user's back.
onBeforeUnmount(stopAppUpdateChannel);

async function check() {
  if (checking.value) return;
  checking.value = true;
  skinNote.value = '';
  try {
    sendAppUpdateCheck();                       // the gateway's own view (installable/progress)
    await Promise.all([loadGatewayInfo(), loadReleaseChecks(true)]);
    // A press has to answer for itself. Something new answers in its own column,
    // so the toast covers the two answers the columns cannot show: nothing new,
    // and could not ask. At the top, because the button is at the bottom of the
    // card — under the user's own hand.
    if (appNew.value || skinNew.value) return;
    const reached = appRelease.value?.known || skinRelease.value?.known;
    showToast(reached ? t('settingsPage.upToDate') : t('settingsPage.checkFailed'), { position: 'top' });
  } finally {
    checking.value = false;
  }
}

/** Download the newer skin files and reload into them (see runSkinUpdate). */
async function updateSkin() {
  if (updatingSkin.value) return;
  updatingSkin.value = true;
  skinNote.value = t('settingsPage.skinUpdating');
  try {
    const { updated, version } = await runSkinUpdate();
    skinNote.value = updated
      ? t('settingsPage.skinUpdated', { version })
      : t('settingsPage.upToDate');
  } catch (err) {
    skinNote.value = err?.message || String(err);
  } finally {
    updatingSkin.value = false;
  }
}

// ── App ──
// `phase` is an open set the gateway defines, so this asks only the questions
// that matter and treats every unrecognised phase as "nothing to report".
const phase = computed(() => appUpdate.value?.phase);
const busy = computed(() => phase.value === 'downloading' || phase.value === 'installing');
const progressPct = computed(() => Math.round((appUpdate.value?.progress || 0) * 100));
const appNew = computed(() => !!appRelease.value?.updateAvailable);
// Android installs in place; everywhere else this links to the release page.
const canInstallApp = computed(() => appNew.value && !!appUpdate.value?.installable);
const appVersion = computed(() => gatewayInfo.value?.fullVersion || appRelease.value?.current || '');

// ── Skin ──
const skinNew = computed(() => !!skinRelease.value?.updateAvailable);
// Offered whenever this skin was installed from a release source at all — not
// only when GitHub confirmed something newer. Offline or rate-limited, the
// gateway can still be asked to look, which is the one update path that never
// depends on this tab reaching github.com.
const canUpdateSkin = computed(() => !!skinRelease.value?.repo);
// The gateway's on-disk version when it knows it, else this bundle's own build
// constant (a skin served straight from a dev server is not in its list).
const skinVersion = computed(() => skinRelease.value?.installed || SKIN_VERSION);
</script>

<template>
  <div class="swidget">
    <!-- App and skin side by side: the same question asked about two things,
         so they read as one comparison split by a hairline rather than as two
         stacked sections. The check below spans both — it answers both. -->
    <div class="sw-upd-cols">
      <div class="sw-upd-col">
        <span class="sw-title">{{ t('settingsPage.appTitle') }}</span>
        <span class="sw-upd-ver">{{ appVersion || '—' }}</span>

        <!-- Only a version worth acting on gets a line. "Up to date" belongs to
             the check the user asked for, not to the card standing there. -->
        <p v-if="appNew" class="sw-upd-line sw-accent">
          {{ t('settingsPage.updateAvailable', { version: appRelease.latest }) }}
        </p>

        <button
          v-if="busy"
          class="tile sw-update"
          disabled
        >{{ t('settingsPage.updating') }} {{ progressPct }}%</button>
        <button
          v-else-if="canInstallApp"
          class="tile sw-update sw-accent"
          @click="installAppUpdate"
        >{{ t('settingsPage.updateApp') }}</button>
        <a
          v-else-if="appNew"
          class="tile sw-update sw-accent"
          :href="appRelease.releasesUrl"
        >{{ t('settingsPage.download') }}</a>

        <div v-if="phase === 'downloading'" class="sw-progress"><span :style="{ width: progressPct + '%' }"></span></div>
      </div>

      <div class="sw-upd-col">
        <span class="sw-title">{{ t('settingsPage.skinTitle') }}</span>
        <span class="sw-upd-ver">{{ skinVersion || '—' }}</span>

        <!-- skinNote is this column's own running commentary while an update
             downloads, so it outranks the version line underneath it. -->
        <p v-if="skinNote || skinNew" class="sw-upd-line" :class="{ 'sw-accent': skinNew && !skinNote }">
          {{ skinNote || t('settingsPage.updateAvailable', { version: skinRelease.latest }) }}
        </p>

        <button
          v-if="canUpdateSkin"
          class="tile sw-update"
          :class="{ 'sw-accent': skinNew }"
          :disabled="updatingSkin"
          @click="updateSkin"
        >{{ t('settingsPage.updateSkin') }}</button>
      </div>
    </div>

    <!-- The one button that is always here: press it to find out where both
         stand. It re-asks GitHub rather than re-reading what it already knew. -->
    <button class="tile sw-update" :disabled="checking || updatingSkin" @click="check">
      {{ checking ? t('settingsPage.checking') : t('settingsPage.checkUpdates') }}
    </button>
  </div>
</template>
