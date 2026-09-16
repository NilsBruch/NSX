<script setup>
/**
 * Every plugin the gateway has, and its settings — generated from the plugin's
 * own schema rather than written per plugin.
 *
 * A plugin describes its settings itself ({ type, label, description, secure,
 * default } per key, see core's getPluginSchema), so this page can configure a
 * plugin that did not exist when the skin was built. The Visualizer keeps its
 * hand-written panel: it is the one nearly everyone uses, and tailored copy is
 * worth it there — this is what the other dozen get instead of nothing.
 *
 * Secrets are never shown. From Decaid 0.7.17-beta.4 the gateway answers a
 * secure field with "a value is set" and not the value, so the row reads
 * "Saved" and a new entry replaces it; there is no pre-filling and no reveal.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { openNumberPad, openTextField } from '../../composables/useModals.js';
import {
  plugins, loadPlugins, setPluginEnabled,
  pluginValues, pluginSecrets, loadPluginDetail, savePluginDetailSetting,
} from '../../composables/useSettings.js';
import { showToast } from '../../composables/useToast.js';

const { NSXCore } = window;

defineEmits(['close']);
const { t } = useI18n();

// null = the list; otherwise the plugin being configured.
const open = ref(null);

onMounted(loadPlugins);

const ordered = computed(() => [...plugins.value].sort((a, b) =>
  String(a.name || a.id).localeCompare(String(b.name || b.id))));

const schemaOf = (plugin) => NSXCore.getPluginSchema(plugin);

const fields = computed(() => schemaOf(open.value).filter((f) => {
  const known = f.type === 'boolean' || f.type === 'number' || f.type === 'string';
  // A type this page has no control for is skipped rather than guessed at: a
  // wrong control would write a wrong value into someone's plugin.
  if (!known) console.warn(`[PluginsPanel] no control for ${open.value?.id}.${f.key} of type ${f.type}`);
  return known;
}));

const valueOf = (field) => NSXCore.pluginSettingValue(pluginValues.value, field);

function displayValue(field) {
  if (field.secure) return pluginSecrets[field.key] ? t('systemSettings.pluginSaved') : t('systemSettings.notSet');
  const v = valueOf(field);
  return v === undefined || v === '' ? t('systemSettings.notSet') : String(v);
}

async function openPlugin(plugin) {
  open.value = plugin;
  try {
    await loadPluginDetail(plugin.id);
  } catch (err) {
    showToast(err?.message || String(err));
  }
}

async function save(field, value) {
  try {
    await savePluginDetailSetting(open.value.id, field, value);
  } catch (err) {
    showToast(err?.message || String(err));
  }
}

async function editField(field) {
  if (field.type === 'number') {
    const v = await openNumberPad({ title: field.label, value: String(valueOf(field) ?? '') });
    if (v != null) save(field, Number(v));
    return;
  }
  const v = await openTextField({
    title: field.label,
    // A secure field starts empty every time — there is nothing to edit, only
    // something to replace.
    value: field.secure ? '' : String(valueOf(field) ?? ''),
    type: field.secure ? 'password' : 'text',
  });
  if (v != null) save(field, v);
}

async function toggleEnabled(plugin) {
  try {
    await setPluginEnabled(plugin.id, !plugin.loaded);
    // setPluginEnabled replaces the list; re-point at the new record so the
    // switch under the user's finger shows the state that was just written.
    if (open.value?.id === plugin.id) open.value = plugins.value.find((p) => p.id === plugin.id) || open.value;
  } catch (err) {
    showToast(err?.message || String(err));
  }
}
</script>

<template>
  <div class="overlay-full">
    <div class="ov-top balanced">
      <button class="ov-back" @click="open ? (open = null) : $emit('close')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        {{ open ? t('systemSettings.plugins') : t('settingsPage.back') }}
      </button>
      <span class="ov-title">{{ open ? (open.name || open.id) : t('systemSettings.plugins') }}</span>
    </div>

    <div class="settings-scroll">
      <template v-if="!open">
        <!-- The row opens the plugin; the switch that turns it on lives inside,
             as its first setting. A row that both navigated and toggled would
             make "did I just open it or disable it?" a question of which half
             of the row you hit. -->
        <button v-for="plugin in ordered" :key="plugin.id" class="setting-row as-btn" @click="openPlugin(plugin)">
          <span class="sr-main">
            <span class="sr-name">{{ plugin.name || plugin.id }}</span>
            <span class="sr-sub">{{ plugin.version ? `v${plugin.version}` : plugin.id }}</span>
          </span>
          <span class="sr-value muted">
            {{ plugin.loaded ? t('systemSettings.pluginOn') : t('systemSettings.pluginOff') }}<span class="sr-chev">›</span>
          </span>
        </button>
        <p v-if="!ordered.length" class="settings-note">{{ t('systemSettings.noPlugins') }}</p>
      </template>

      <template v-else>
        <div class="setting-row">
          <span class="sr-main">
            <span class="sr-name">{{ t('systemSettings.pluginEnabled') }}</span>
            <span v-if="open.description" class="sr-sub">{{ open.description }}</span>
          </span>
          <button
            class="switch"
            :class="{ on: open.loaded }"
            role="switch"
            :aria-checked="!!open.loaded"
            @click="toggleEnabled(open)"
          ></button>
        </div>
        <div v-for="field in fields" :key="field.key">
          <div v-if="field.type === 'boolean'" class="setting-row">
            <span class="sr-main">
              <span class="sr-name">{{ field.label }}</span>
              <span v-if="field.description" class="sr-sub">{{ field.description }}</span>
            </span>
            <button
              class="switch"
              :class="{ on: valueOf(field) === true }"
              role="switch"
              :aria-checked="valueOf(field) === true"
              @click="save(field, valueOf(field) !== true)"
            ></button>
          </div>
          <button v-else class="setting-row as-btn" @click="editField(field)">
            <span class="sr-main">
              <span class="sr-name">{{ field.label }}</span>
              <span v-if="field.description" class="sr-sub">{{ field.description }}</span>
            </span>
            <span class="sr-value">{{ displayValue(field) }}<span class="sr-chev">›</span></span>
          </button>
        </div>
        <p v-if="!fields.length" class="settings-note">{{ t('systemSettings.noPluginSettings') }}</p>
      </template>
    </div>
  </div>
</template>
