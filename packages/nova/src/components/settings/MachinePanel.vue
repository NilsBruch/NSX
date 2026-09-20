<script setup>
/**
 * Settings that belong to the DE1 itself — things that would survive swapping
 * the tablet. BLE/gateway concerns (connections, charging, updates) live in
 * AppPanel.vue instead; see the design log for why the split is drawn there.
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { openNumberPad, openChooser } from '../../composables/useModals.js';
import { machine } from '../../composables/useCore.js';
import { steam } from '../../composables/useMachineFunctions.js';
import SettingSlider from './SettingSlider.vue';
import { formatWaterLevel } from '../../utils/water.js';
import { showToast } from '../../composables/useToast.js';
import { dispTemp, toCelsius, tempRange, tempUnitLabel } from '../../composables/useUnits.js';
import {
  appSettings, loadAppSettings, saveAppSetting,
  machineSettings, loadMachineSettings, saveMachineSetting,
  advancedSettings, loadAdvancedSettings, saveAdvancedSetting,
  machineInfo, loadMachineInfo, pushRefillLevel,
  skinSettings, saveSkinSetting,
} from '../../composables/useSettings.js';

const emit = defineEmits(['close']);
const { t } = useI18n();
const { NSXCore } = window;

// 'main' | 'calibration' | 'heater' — the two adjustment groups live one level
// deeper (drill in from a row) so the main list stays short and scrollable.
const view = ref('main');
const viewTitle = () => (view.value === 'calibration' ? t('machineSettings.calibration')
  : view.value === 'heater' ? t('machineSettings.heater')
  : t('settingsPage.machine'));
function goBack() { if (view.value === 'main') emit('close'); else view.value = 'main'; }

async function editSteamTemp() {
  const v = await openNumberPad({ title: t('machineSettings.steamTemp'), unit: tempUnitLabel.value, value: dispTemp(steam.temp ?? 150) });
  if (v != null) NSXCore.setSteamTemp(toCelsius(Number(v)));
}

onMounted(() => {
  loadAppSettings();
  loadMachineSettings();
  loadAdvancedSettings();
  loadMachineInfo();
});

/**
 * The refill threshold is a tank DEPTH in millimetres — that is what the DE1
 * takes and what /machine/waterLevels reports — but the row labelled it "ml",
 * so 5 read as an absurd 5 millilitres. It says mm now, with the volume that
 * depth is worth in brackets (utils/water.js's conversion, the same one the
 * status island uses), since ml is what anyone actually thinks in when filling
 * a tank. Passed as SettingSlider's `format`, not `textValue`, so the brackets
 * stay put while the slider is being dragged — as textValue they vanished
 * under the finger and the row jumped on every drag.
 */
const refillLevelText = (mm) => `${Math.round(mm)} mm (${formatWaterLevel(mm, 'ml')})`;

/**
 * The slider shows machine.water.refillLevel, which is the gateway's own
 * waterLevels stream — so a POST the machine refuses silently snaps the row
 * back to whatever the machine still holds. That used to be invisible: the
 * @change handler was the bare push, and a rejected request became an
 * unhandled promise nobody sees. Saying so in a toast is the difference
 * between "the slider is broken" and "the machine said no, and why".
 */
async function setRefillLevel(mm) {
  try {
    await pushRefillLevel(mm);
  } catch (err) {
    showToast(`${t('machineSettings.refillAlert')}: ${err.message}`);
  }
}

async function editRefillLevel() {
  const v = await openNumberPad({ title: t('machineSettings.refillAlert'), unit: 'mm', value: machine.water.refillLevel ?? '' });
  if (v != null) setRefillLevel(Number(v));
}

// Flow multipliers are real app-level settings (POST /settings), not
// machine-advanced ones, despite the name — see NSX's settings.js: they're
// saveRea, not saveDe1Adv. Only the heater/fan fields below are actually
// machine-advanced / machine-level.
async function editAppMultiplier(key, label) {
  const v = await openNumberPad({ title: label, value: appSettings[key] ?? 1 });
  if (v != null) saveAppSetting(key, Number(v));
}
async function editHeaterFlow(key, label) {
  const v = await openNumberPad({ title: label, unit: 'ml/s', value: advancedSettings[key] ?? 0 });
  if (v != null) saveAdvancedSetting(key, Number(v));
}
// The idle target sits among the heater's flow settings but is a TEMPERATURE,
// so it needs its own editor: sharing editHeaterFlow labelled it 'ml/s'.
async function editHeaterIdleTemp() {
  const v = await openNumberPad({
    title: t('machineSettings.heaterIdle'), unit: tempUnitLabel.value,
    value: dispTemp(advancedSettings.heaterIdleTemp ?? 0, 1),
  });
  if (v != null) saveAdvancedSetting('heaterIdleTemp', toCelsius(Number(v)));
}
async function editFanThreshold() {
  const v = await openNumberPad({ title: t('machineSettings.fanThreshold'), unit: tempUnitLabel.value, value: dispTemp(machineSettings.fan ?? 0) });
  if (v != null) saveMachineSetting('fan', toCelsius(Number(v)));
}

async function editFlushTemp() {
  const v = await openNumberPad({ title: t('machineSettings.flushTemp'), unit: tempUnitLabel.value, value: dispTemp(machineSettings.flushTemp ?? 80) });
  if (v != null) saveMachineSetting('flushTemp', toCelsius(Number(v)));
}
async function editFlushTimeout() {
  const v = await openNumberPad({ title: t('machineSettings.flushTimeout'), unit: 's', value: machineSettings.flushTimeout ?? 10 });
  if (v != null) saveMachineSetting('flushTimeout', Number(v));
}
const purgeOpts = [[0, t('machineSettings.spAutoPurge')], [1, t('machineSettings.spTwoTap')]];
async function pickSteamPurgeMode() {
  const v = await openChooser({ title: t('machineSettings.steamPurgeMode'), options: purgeOpts, current: machineSettings.steamPurgeMode ?? 0 });
  if (v != null) saveMachineSetting('steamPurgeMode', Number(v));
}
const purgeLabel = () => purgeOpts.find(([value]) => value === (machineSettings.steamPurgeMode ?? 0))?.[1] ?? '';

const waterUnitOpts = [['ml', t('machineSettings.waterUnitMl')], ['pct', t('machineSettings.waterUnitPct')], ['mm', t('machineSettings.waterUnitMm')]];
async function pickWaterUnit() {
  const v = await openChooser({ title: t('machineSettings.waterUnit'), options: waterUnitOpts, current: skinSettings.waterUnit });
  if (v != null) saveSkinSetting('waterUnit', v);
}
const waterUnitLabel = () => waterUnitOpts.find(([value]) => value === skinSettings.waterUnit)?.[1] ?? '';

// -1 is the DE1's "not set" sentinel — the chooser only ever offers 120/230,
// so an existing -1 just shows as unset until the user picks one.
const heaterVoltageOpts = [[120, '120V'], [230, '230V']];
async function pickHeaterVoltage() {
  const v = await openChooser({ title: t('machineSettings.heaterVoltage'), options: heaterVoltageOpts, current: advancedSettings.heaterVoltage });
  if (v != null) saveAdvancedSetting('heaterVoltage', Number(v));
}
const heaterVoltageLabel = () => heaterVoltageOpts.find(([value]) => value === advancedSettings.heaterVoltage)?.[1] ?? '—';

// 0 force off · 1 force on · 2 auto — the DE1's optional auto-refill kit.
const refillKitOpts = [[0, t('machineSettings.refillKitOff')], [1, t('machineSettings.refillKitOn')], [2, t('machineSettings.refillKitAuto')]];
async function pickRefillKit() {
  const v = await openChooser({ title: t('machineSettings.refillKit'), options: refillKitOpts, current: advancedSettings.refillKitSetting ?? 2 });
  if (v != null) saveAdvancedSetting('refillKitSetting', Number(v));
}
const refillKitLabel = () => refillKitOpts.find(([value]) => value === (advancedSettings.refillKitSetting ?? 2))?.[1] ?? '';
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top balanced">
      <button class="ov-back" @click="goBack">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>{{ t('settingsPage.back') }}
      </button>
      <span class="ov-title">{{ viewTitle() }}</span>
    </div>

    <div class="settings-scroll machine-scroll">
      <template v-if="view === 'main'">
        <!-- Auto sleep (switch + cool-down time) is the settings page's Energy
             widget now; a second copy here would be two controls for one
             value, disagreeing whenever one of them is stale. -->
        <span class="setting-group-label">{{ t('machineSettings.scaleSafety') }}</span>
        <div class="setting-row">
          <span class="sr-main"><span class="sr-name">{{ t('machineSettings.blockOnNoScale') }}</span><span class="sr-sub">{{ t('machineSettings.blockOnNoScaleSub') }}</span></span>
          <button class="switch" :class="{ on: appSettings.blockOnNoScale }" role="switch" :aria-checked="!!appSettings.blockOnNoScale" @click="saveAppSetting('blockOnNoScale', !appSettings.blockOnNoScale)"></button>
        </div>
        <div class="setting-row">
          <span class="sr-main"><span class="sr-name">{{ t('machineSettings.stopHotWaterAtWeight') }}</span><span class="sr-sub">{{ t('machineSettings.stopHotWaterAtWeightSub') }}</span></span>
          <button class="switch" :class="{ on: appSettings.stopHotWaterAtWeight }" role="switch" :aria-checked="!!appSettings.stopHotWaterAtWeight" @click="saveAppSetting('stopHotWaterAtWeight', !appSettings.stopHotWaterAtWeight)"></button>
        </div>

        <span class="setting-group-label">{{ t('machineSettings.waterTank') }}</span>
        <SettingSlider
          :label="t('machineSettings.refillAlert')"
          :model-value="machine.water.refillLevel ?? null"
          :min="5" :max="43" :step="1" unit=" mm" :format="refillLevelText"
          @change="setRefillLevel" @edit="editRefillLevel"
        />
        <button class="setting-row as-btn" @click="pickWaterUnit">
          <span class="sr-name">{{ t('machineSettings.waterUnit') }}</span>
          <span class="sr-value">{{ waterUnitLabel() }}<span class="sr-chev">›</span></span>
        </button>
        <button class="setting-row as-btn" @click="pickRefillKit">
          <span class="sr-name">{{ t('machineSettings.refillKit') }}</span>
          <span class="sr-value">{{ refillKitLabel() }}<span class="sr-chev">›</span></span>
        </button>

        <span class="setting-group-label">{{ t('machineSettings.steamFlush') }}</span>
        <SettingSlider
          :label="t('machineSettings.steamTemp')"
          :model-value="steam.temp == null ? null : dispTemp(steam.temp)"
          v-bind="tempRange(130, 170)" :step="5" :unit="tempUnitLabel"
          @change="NSXCore.setSteamTemp(toCelsius($event))" @edit="editSteamTemp"
        />
        <button class="setting-row as-btn" @click="pickSteamPurgeMode">
          <span class="sr-name">{{ t('machineSettings.steamPurgeMode') }}</span>
          <span class="sr-value">{{ purgeLabel() }}<span class="sr-chev">›</span></span>
        </button>
        <SettingSlider
          :label="t('machineSettings.flushTemp')"
          :model-value="machineSettings.flushTemp == null ? null : dispTemp(machineSettings.flushTemp)"
          v-bind="tempRange(0, 105)" :unit="tempUnitLabel"
          @change="saveMachineSetting('flushTemp', toCelsius($event))" @edit="editFlushTemp"
        />
        <SettingSlider
          :label="t('machineSettings.flushTimeout')"
          :model-value="machineSettings.flushTimeout ?? null"
          :min="3" :max="120" :step="1" unit=" s"
          @change="saveMachineSetting('flushTimeout', $event)" @edit="editFlushTimeout"
        />

        <span class="setting-group-label">{{ t('machineSettings.adjustments') }}</span>
        <button class="setting-row as-btn" @click="view = 'calibration'">
          <span class="sr-name">{{ t('machineSettings.calibration') }}</span>
          <span class="sr-value"><span class="sr-chev">›</span></span>
        </button>
        <button class="setting-row as-btn" @click="view = 'heater'">
          <span class="sr-name">{{ t('machineSettings.heater') }}</span>
          <span class="sr-value"><span class="sr-chev">›</span></span>
        </button>

        <span class="setting-group-label">{{ t('machineSettings.info') }}</span>
        <div class="setting-row"><span class="sr-name">{{ t('machineSettings.model') }}</span><span class="sr-value muted">{{ machineInfo?.name ?? '—' }}</span></div>
        <div class="setting-row"><span class="sr-name">{{ t('machineSettings.firmware') }}</span><span class="sr-value muted">{{ machineInfo?.version ?? '—' }}</span></div>
        <div class="setting-row"><span class="sr-name">{{ t('machineSettings.serial') }}</span><span class="sr-value muted">{{ machineInfo?.serial ?? '—' }}</span></div>
      </template>

      <template v-else-if="view === 'calibration'">
        <SettingSlider
          :label="t('machineSettings.flowMult')"
          :hint="t('machineSettings.flowMultHint')"
          :model-value="appSettings.flowEstimationMultiplier ?? null"
          :min="0.13" :max="2" :step="0.01" :decimals="2"
          @change="saveAppSetting('flowEstimationMultiplier', $event)"
          @edit="editAppMultiplier('flowEstimationMultiplier', t('machineSettings.flowMult'))"
        />
        <SettingSlider
          :label="t('machineSettings.weightMult')"
          :hint="t('machineSettings.weightMultHint')"
          :model-value="appSettings.weightFlowMultiplier ?? null"
          :min="0" :max="5" :step="0.1" :decimals="1"
          @change="saveAppSetting('weightFlowMultiplier', $event)"
          @edit="editAppMultiplier('weightFlowMultiplier', t('machineSettings.weightMult'))"
        />
        <SettingSlider
          :label="t('machineSettings.volumeMult')"
          :hint="t('machineSettings.volumeMultHint')"
          :model-value="appSettings.volumeFlowMultiplier ?? null"
          :min="0" :max="2" :step="0.05" :decimals="2"
          @change="saveAppSetting('volumeFlowMultiplier', $event)"
          @edit="editAppMultiplier('volumeFlowMultiplier', t('machineSettings.volumeMult'))"
        />
      </template>

      <template v-else-if="view === 'heater'">
        <SettingSlider
          :label="t('machineSettings.fanThreshold')"
          :model-value="machineSettings.fan == null ? null : dispTemp(machineSettings.fan)"
          v-bind="tempRange(0, 100)" :unit="tempUnitLabel"
          @change="saveMachineSetting('fan', toCelsius($event))" @edit="editFanThreshold"
        />
        <SettingSlider
          :label="t('machineSettings.heaterIdle')"
          :model-value="advancedSettings.heaterIdleTemp == null ? null : dispTemp(advancedSettings.heaterIdleTemp, 1)"
          v-bind="tempRange(0, 99)" :step="0.5" :decimals="1" :unit="tempUnitLabel"
          @change="saveAdvancedSetting('heaterIdleTemp', toCelsius($event))"
          @edit="editHeaterIdleTemp"
        />
        <SettingSlider
          :label="t('machineSettings.heaterPh1')"
          :model-value="advancedSettings.heaterPh1Flow ?? null"
          :min="0.5" :max="6" :step="0.1" :decimals="1"
          @change="saveAdvancedSetting('heaterPh1Flow', $event)"
          @edit="editHeaterFlow('heaterPh1Flow', t('machineSettings.heaterPh1'))"
        />
        <SettingSlider
          :label="t('machineSettings.heaterPh2')"
          :model-value="advancedSettings.heaterPh2Flow ?? null"
          :min="0.5" :max="8" :step="0.1" :decimals="1"
          @change="saveAdvancedSetting('heaterPh2Flow', $event)"
          @edit="editHeaterFlow('heaterPh2Flow', t('machineSettings.heaterPh2'))"
        />
        <SettingSlider
          :label="t('machineSettings.heaterPh2Timeout')"
          :model-value="advancedSettings.heaterPh2Timeout ?? null"
          :min="1" :max="30" :step="1" unit=" s"
          @change="saveAdvancedSetting('heaterPh2Timeout', $event)"
          @edit="editHeaterFlow('heaterPh2Timeout', t('machineSettings.heaterPh2Timeout'))"
        />
        <button class="setting-row as-btn" @click="pickHeaterVoltage">
          <span class="sr-name">{{ t('machineSettings.heaterVoltage') }}</span>
          <span class="sr-value">{{ heaterVoltageLabel() }}<span class="sr-chev">›</span></span>
        </button>
      </template>
    </div>
  </div>
</template>
