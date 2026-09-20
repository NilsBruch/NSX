<script setup>
/**
 * Text entry for every field in Nova (bean names, diary search, …), with its
 * own on-screen QWERTY keyboard: the DE1's kiosk browser does NOT raise a
 * system keyboard, which is why NSX ships one too. The <input> keeps
 * inputmode="none" so a device that DOES have a native OSK never stacks a
 * second keyboard on top of this one, while a physical keyboard still types
 * into it normally.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { textFieldState, resolveTextField } from '../composables/useModals.js';

const { t } = useI18n();
const { NSXCore } = window;
const inputEl = ref(null);
const draft = ref('');
const shift = ref(false);
const numeric = ref(false);

const LETTERS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];
const SYMBOLS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '€', '&', '@', '"'],
  ['.', ',', '?', '!', "'", '%', '+', '#', '*'],
];

// Tag mode (textFieldState.tags): the field edits a comma-separated LIST.
// `tagList` holds the committed chips, `draft` only ever holds the entry being
// typed — so the user never types a comma themselves.
const tagList = ref([]);
const splitTags = (s) => String(s || '').split(',').map((v) => v.trim()).filter(Boolean);

watch(
  () => textFieldState.open,
  async (open) => {
    if (!open) return;
    // In tag mode the existing value seeds the chips, not the input line.
    tagList.value = textFieldState.tags ? splitTags(textFieldState.value) : [];
    draft.value = textFieldState.tags ? '' : textFieldState.value;
    shift.value = false;
    numeric.value = false;
    await nextTick();
    inputEl.value?.focus();
    inputEl.value?.select();
  }
);

const hasTag = (v) => tagList.value.some((x) => x.toLowerCase() === String(v).trim().toLowerCase());
function addTag(value) {
  const v = String(value || '').trim();
  if (!v || hasTag(v)) { draft.value = ''; return; }
  tagList.value = [...tagList.value, v];
  draft.value = '';
  // Keep typing straight into the field — the modal deliberately stays open.
  nextTick(() => inputEl.value?.focus());
}
function removeTag(v) { tagList.value = tagList.value.filter((x) => x !== v); }

// Insert/delete at the field's actual caret (or replace its selection),
// instead of always appending at the end — so tapping into the middle of a
// long note and typing/backspacing edits right there, like a real text field.
function caret() {
  const el = inputEl.value;
  const len = draft.value.length;
  return { start: el?.selectionStart ?? len, end: el?.selectionEnd ?? len };
}
function placeCaretAt(pos) {
  nextTick(() => inputEl.value?.setSelectionRange(pos, pos));
}
function insertAtCaret(text) {
  const { start, end } = caret();
  draft.value = draft.value.slice(0, start) + text + draft.value.slice(end);
  placeCaretAt(start + text.length);
}

function type(key) {
  const ch = !numeric.value && shift.value ? key.toUpperCase() : key;
  insertAtCaret(ch);
  shift.value = false; // one-shot shift, like a phone keyboard
}
function backspace() {
  const { start, end } = caret();
  if (start === end) {
    if (start === 0) return;
    draft.value = draft.value.slice(0, start - 1) + draft.value.slice(end);
    placeCaretAt(start - 1);
  } else {
    draft.value = draft.value.slice(0, start) + draft.value.slice(end);
    placeCaretAt(start);
  }
}
function space() { insertAtCaret(' '); }
function newline() { insertAtCaret('\n'); }
// Tag mode confirms the CHIPS, folding in whatever is still half-typed so a
// note isn't silently dropped by confirming without pressing ↵ first.
function confirm() {
  if (!textFieldState.tags) { resolveTextField(draft.value.trim()); return; }
  const pending = draft.value.trim();
  const all = pending && !hasTag(pending) ? [...tagList.value, pending] : tagList.value;
  resolveTextField(all.join(', '));
}
function cancel() { resolveTextField(null); }

// Press feedback for the keys. Every other control in the skin gets this from
// CSS :active (app.css), but the keys preventDefault() on pointerdown — which
// is load-bearing for focus and for not dropping keystrokes, see the template
// — and that suppresses the browser's own active state. So the class is set
// here instead. Delegated from the .kb container rather than bound on each of
// the ~40 keys, and released on leave/cancel too, so a finger that slides off
// a key can't leave it stuck looking pressed.
let pressedEl = null;
function pressKey(e) {
  const el = e.target.closest?.('.kb-key');
  if (!el || el.disabled) return;
  pressedEl = el;
  el.classList.add('is-pressed');
}
function releaseKey() {
  pressedEl?.classList.remove('is-pressed');
  pressedEl = null;
}

// Existing values that match what's been typed so far, so the user can tap
// one instead of re-typing — keeps roaster/origin/etc. consistent. Ranked by
// NSXCore.rankSuggestions rather than a plain substring test: typing "ris"
// used to be able to offer "Kristians Kaffe" ahead of "Risteriet" (the letters
// occur somewhere inside), since nothing distinguished that from an actual
// prefix match. Ties keep `all`'s incoming order, which callers (BeanEditor.vue)
// already provide newest-first.
const suggestions = computed(() => {
  const all = textFieldState.suggestions || [];
  if (!all.length) return [];
  const current = draft.value.trim().toLowerCase();
  const seen = new Set();
  const candidates = [];
  for (const s of all) {
    const val = String(s || '').trim();
    if (!val) continue;
    const low = val.toLowerCase();
    if (low === current) continue;    // don't suggest the exact current value
    if (seen.has(low)) continue;
    // Tag mode: an already-added note is not a useful suggestion.
    if (textFieldState.tags && hasTag(val)) continue;
    seen.add(low);
    candidates.push(val);
  }
  return NSXCore.rankSuggestions(candidates, draft.value).slice(0, 8);
});
// Plain mode: tapping a suggestion IS the answer — fill and confirm in one tap.
// Tag mode: it ADDS that note and leaves the modal open, so several can be
// picked in a row (the whole point — beans share notes, not note lists).
function pickSuggestion(s) {
  if (textFieldState.tags) addTag(s);
  else resolveTextField(s);
}
</script>

<template>
  <!-- kb-scrim bottom-anchors this modal (see app.css): the keys must not move
       while typing, so everything that can change height — the suggestion
       strip, the committed tags, a growing notes field — has to grow UPWARDS
       away from them, not push them around a centred box. -->
  <div v-if="textFieldState.open" class="scrim kb-scrim" @click.self="cancel">
    <div class="modal kb-modal">
      <span class="m-title">{{ textFieldState.title }}</span>
      <textarea
        v-if="textFieldState.multiline"
        ref="inputEl"
        v-model="draft"
        :placeholder="textFieldState.placeholder"
        class="text-field-input text-field-textarea"
        inputmode="none"
      ></textarea>
      <input
        v-else
        ref="inputEl"
        v-model="draft"
        :type="textFieldState.type"
        :placeholder="textFieldState.placeholder"
        class="text-field-input"
        inputmode="none"
        @keyup.enter="textFieldState.tags ? addTag(draft) : confirm()"
      />

      <!-- Committed notes. Tap a chip's × to drop it again. -->
      <div v-if="textFieldState.tags && tagList.length" class="tf-tags">
        <button
          v-for="tg in tagList"
          :key="tg"
          class="tf-tag"
          @mousedown.prevent
          @click="removeTag(tg)"
        >{{ tg }}<span class="tf-tag-x" aria-hidden="true">×</span></button>
      </div>

      <!-- Rendered whenever this field HAS a suggestion pool, not whenever the
           filtered list happens to be non-empty: the strip has a fixed height
           (app.css), so keeping it mounted is what stops the layout from
           jumping as typing narrows five suggestions down to one and then to
           none. That jump is what caused mis-taps at speed. -->
      <div v-if="textFieldState.suggestions?.length" class="tf-suggests">
        <button
          v-for="s in suggestions"
          :key="s"
          class="tf-suggest"
          @mousedown.prevent
          @click="pickSuggestion(s)"
        >{{ s }}</button>
      </div>

      <!-- Keys actuate on POINTERDOWN, not click. A click only fires when the
           press and release land on the same element having barely moved, so
           at typing speed — where a finger routinely slides a few pixels, or
           lifts over the gap between two keys — the browser cancels it and the
           keystroke is silently lost. That is touch-only: a mouse on a desktop
           never moves between press and release, which is why this looked fine
           there and dropped keys on the tablet. Typing slowly hid it by making
           every tap precise. Pressing on pointerdown is also what a real
           keyboard does, and it feels markedly faster. (.kb-key also sets
           touch-action: manipulation — see app.css.)

           `.prevent` is load-bearing for a second reason: it keeps focus on
           the <input>. Without it, tapping a key blurs the field, the kiosk
           browser resets selectionStart to 0, and every character is inserted
           at index 0 — text appears reversed. It also suppresses the
           compatibility mouse events, so no key can fire twice. -->
      <div
        class="kb"
        @pointerdown="pressKey"
        @pointerup="releaseKey"
        @pointercancel="releaseKey"
        @pointerleave="releaseKey"
      >
        <div v-for="(row, i) in (numeric ? SYMBOLS : LETTERS)" :key="i" class="kb-row">
          <!-- Shift and backspace are DRAWN, not typed: as the characters ⇧
               and ⌫ they depended on the kiosk browser's font having them, and
               a key that renders as a blank box is a key nobody presses — a
               user reported the keyboard had "no way to make capitals" with
               the shift key right there in front of them. Every other icon in
               the skin is an inline stroked svg for the same reason. -->
          <button
            v-if="i === 2"
            class="kb-key kb-wide"
            :class="{ on: shift }"
            :disabled="numeric"
            aria-label="Shift"
            @pointerdown.prevent="shift = !shift"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 4l7 7h-3.6v5.5H8.6V11H5l7-7z" />
              <path d="M8.6 19.5h6.8" />
            </svg>
          </button>
          <button v-for="k in row" :key="k" class="kb-key" @pointerdown.prevent="type(k)">
            {{ !numeric && shift ? k.toUpperCase() : k }}
          </button>
          <button v-if="i === 2" class="kb-key kb-wide" aria-label="Backspace" @pointerdown.prevent="backspace">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5h10.5v14H9L3 12 9 5z" />
              <path d="M12.5 9.5l5 5M17.5 9.5l-5 5" />
            </svg>
          </button>
        </div>
        <div class="kb-row">
          <button class="kb-key kb-wide" @pointerdown.prevent="numeric = !numeric">{{ numeric ? 'ABC' : '123' }}</button>
          <button class="kb-key kb-space" @pointerdown.prevent="space">{{ t('common.space') }}</button>
          <button v-if="textFieldState.multiline" class="kb-key kb-wide" @pointerdown.prevent="newline">↵</button>
          <!-- Tag mode's "add" key. The DE1's kiosk browser raises no system
               keyboard, so there is no hardware ↵ to rely on here. -->
          <button
            v-if="textFieldState.tags"
            class="kb-key kb-wide"
            :class="{ accent: draft.trim() }"
            :disabled="!draft.trim()"
            @pointerdown.prevent="addTag(draft)"
          >{{ t('textField.addTag') }}</button>
        </div>
      </div>

      <div class="modal-actions">
        <button class="cancel" @click="cancel">{{ t('common.cancel') }}</button>
        <button class="confirm" @click="confirm">{{ t('common.confirm') }}</button>
      </div>
    </div>
  </div>
</template>
