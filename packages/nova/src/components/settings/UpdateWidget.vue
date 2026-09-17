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
 *    on the live ws/v1/update state); everywhere else there is no in-app path
 *    and the button says so rather than pretending.
 *
 * ONE button, at the bottom, for both columns: it asks while there is nothing
 * to do and downloads once there is. Per-column buttons appearing the moment a
 * release landed made the card grow and shoved the rest of the page down — a
 * layout that moves because someone else published something. The columns are
 * now status only, and their lines hold their space whether or not they have
 * anything to say, so this card is always the same height.
 *
 * Release notes are deliberately not shown: a changelog is reading material,
 * and this card is a status line with one action.
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
  sendAppUpdateCheck, requestAppInstall, runSkinUpdate,
} from '../../composables/useSettings.js';
import { showToast } from '../../composables/useToast.js';

const { t } = useI18n();

const checking = ref(false);
const updatingSkin = ref(false);
const installingApp = ref(false);
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

/**
 * The press once something is new: update whatever has an update, both if both
 * do. The skin goes first — it is the one that always works — and the app
 * install follows, because on a host that can install one the app restarts and
 * takes this page with it (hence `reload: false`: the restart is the reload).
 */
async function download() {
  if (busyWithUpdate.value) return;
  const wantApp = appNew.value;
  const wantSkin = skinNew.value;
  let appInstalling = false;

  if (wantApp) {
    installingApp.value = true;
    try {
      // 'unavailable' is the honest desktop answer: no in-app path exists, so
      // say where the build does come from instead of opening a page nobody
      // asked for.
      appInstalling = (await requestAppInstall()) === 'installing';
      if (!appInstalling) showToast(t('settingsPage.appNotInstallable'), { position: 'top' });
    } finally {
      installingApp.value = false;
    }
  }

  if (wantSkin) await updateSkin({ reload: !appInstalling });
}

/** Download the newer skin files and reload into them (see runSkinUpdate). */
async function updateSkin({ reload = true } = {}) {
  if (updatingSkin.value) return;
  updatingSkin.value = true;
  skinNote.value = t('settingsPage.skinUpdating');
  try {
    const { updated, version } = await runSkinUpdate({ reload });
    skinNote.value = updated
      ? t(reload ? 'settingsPage.skinUpdated' : 'settingsPage.skinUpdatedNoReload', { version })
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
const appVersion = computed(() => gatewayInfo.value?.fullVersion || appRelease.value?.current || '');

// ── Skin ──
const skinNew = computed(() => !!skinRelease.value?.updateAvailable);
// The gateway's on-disk version when it knows it, else this bundle's own build
// constant (a skin served straight from a dev server is not in its list).
const skinVersion = computed(() => skinRelease.value?.installed || SKIN_VERSION);

// ── The one button ──
// Nothing new -> it asks. Something new -> it downloads. Never both questions
// at once, so the card never has to grow a second control.
const anythingNew = computed(() => appNew.value || skinNew.value);
const busyWithUpdate = computed(() => installingApp.value || updatingSkin.value || busy.value);
const buttonLabel = computed(() => {
  if (checking.value) return t('settingsPage.checking');
  if (busyWithUpdate.value) return `${t('settingsPage.updating')}${busy.value ? ` ${progressPct.value}%` : '…'}`;
  return anythingNew.value ? t('settingsPage.download') : t('settingsPage.checkUpdates');
});
</script>

<template>
  <div class="swidget">
    <!-- App and skin side by side: the same question asked about two things,
         so they read as one comparison split by a hairline rather than as two
         stacked sections. The button below spans both — it acts on both. -->
    <div class="sw-upd-cols">
      <div class="sw-upd-col">
        <span class="sw-title">{{ t('settingsPage.appTitle') }}</span>
        <span class="sw-upd-ver">{{ appVersion || '—' }}</span>

        <!-- Always rendered, empty when there is nothing to report: the line
             keeps its space so a new release can't change the card's height.
             "Up to date" is still not said here — that belongs to the check the
             user asked for, not to the card standing there. -->
        <p class="sw-upd-line" :class="{ 'sw-accent': appNew }">
          {{ appNew ? t('settingsPage.updateAvailable', { version: appRelease.latest }) : '' }}
        </p>

        <div v-if="phase === 'downloading'" class="sw-progress"><span :style="{ width: progressPct + '%' }"></span></div>
      </div>

      <div class="sw-upd-col">
        <span class="sw-title">{{ t('settingsPage.skinTitle') }}</span>
        <span class="sw-upd-ver">{{ skinVersion || '—' }}</span>

        <!-- skinNote is this column's own running commentary while an update
             downloads, so it outranks the version line underneath it. -->
        <p class="sw-upd-line" :class="{ 'sw-accent': skinNew && !skinNote }">
          {{ skinNote || (skinNew ? t('settingsPage.updateAvailable', { version: skinRelease.latest }) : '') }}
        </p>
      </div>
    </div>

    <!-- The one button, in both of its jobs: it asks where the two stand
         (re-asking GitHub rather than re-reading what it knew), and once
         something is newer the same button is what downloads it. -->
    <button
      class="tile sw-update"
      :class="{ 'sw-accent': anythingNew && !checking && !busyWithUpdate }"
      :disabled="checking || busyWithUpdate"
      @click="anythingNew ? download() : check()"
    >{{ buttonLabel }}</button>
  </div>
</template>
