/**
 * Imperative modal API backed by a single shared instance mounted once in
 * App.vue (see WheelPicker.vue) — callers just `await openWheel({...})` from
 * anywhere without managing their own modal component instance. More modal
 * kinds (chooser, keyboard, confirm) get added here as the phases that need
 * them arrive, following the same shape.
 */
import { reactive } from 'vue';

export const wheelState = reactive({
  open: false, title: '', unit: '', values: [], current: null, _resolve: null,
});

/**
 * @param {{ title: string, unit?: string, values: string[], current: string|number }} opts
 * @returns {Promise<string|null>} the confirmed value, or null if cancelled
 */
export function openWheel({ title, unit = '', values, current }) {
  return new Promise((resolve) => {
    wheelState.title = title;
    wheelState.unit = unit;
    wheelState.values = values;
    wheelState.current = String(current);
    wheelState._resolve = resolve;
    wheelState.open = true;
  });
}

export function resolveWheel(value) {
  wheelState.open = false;
  wheelState._resolve?.(value);
  wheelState._resolve = null;
}

/**
 * A single native <input> in the shared modal chrome — used for bean fields
 * and search. Kiosk browsers (Chrome OS/Android WebView) show their own
 * on-screen keyboard for a focused text input, so this needs no custom
 * QWERTY component of its own; a native input is the simpler correct choice,
 * the same reasoning RoastDatePicker.vue already applied to its date input.
 */
export const textFieldState = reactive({
  open: false, title: '', value: '', type: 'text', placeholder: '', multiline: false, tags: false, suggestions: [], _resolve: null,
});

/**
 * @param {{ title: string, value?: string, type?: 'text'|'number', placeholder?: string, multiline?: boolean, tags?: boolean, suggestions?: string[] }} opts
 *   multiline swaps the single-line <input> for a wrapped <textarea> (notes,
 *   anything that can run long) — see TextFieldModal.vue.
 *   tags turns the field into a comma-separated TAG LIST: each entry is added
 *   as its own chip (type + ↵, or tap a suggestion) and the modal stays open
 *   until confirmed, resolving to the chips joined by ', '. Used for bean
 *   tasting notes, where beans share individual notes but never the whole
 *   combination — so the suggestions have to be per-note, not per-bean.
 *   suggestions: existing values shown below the input, filtered as you type and
 *   tappable to fill+confirm — how the bean editor keeps roaster/origin/variety/
 *   process spellings consistent instead of re-typing them each time. In tags
 *   mode a tap ADDS the note and keeps the modal open instead of confirming.
 * @returns {Promise<string|null>} the confirmed (trimmed) value, or null if cancelled
 */
export function openTextField({ title, value = '', type = 'text', placeholder = '', multiline = false, tags = false, suggestions = [] }) {
  return new Promise((resolve) => {
    textFieldState.title = title;
    textFieldState.value = value;
    textFieldState.type = type;
    textFieldState.placeholder = placeholder;
    textFieldState.multiline = multiline;
    textFieldState.tags = tags;
    textFieldState.suggestions = Array.isArray(suggestions) ? suggestions : [];
    textFieldState._resolve = resolve;
    textFieldState.open = true;
  });
}

export function resolveTextField(value) {
  textFieldState.open = false;
  textFieldState._resolve?.(value);
  textFieldState._resolve = null;
}

/** A short list of discrete, labeled options (enums) — distinct from the
 * continuous scroll of WheelPicker. Used by Settings rows like charging mode
 * or log level. */
export const chooserState = reactive({
  open: false, title: '', options: [], current: null, _resolve: null,
});

/**
 * @param {{ title: string, options: Array<[value: string, label: string]>, current: string }} opts
 * @returns {Promise<string|null>} the picked value, or null if cancelled
 */
export function openChooser({ title, options, current }) {
  return new Promise((resolve) => {
    chooserState.title = title;
    chooserState.options = options;
    chooserState.current = current;
    chooserState._resolve = resolve;
    chooserState.open = true;
  });
}

export function resolveChooser(value) {
  chooserState.open = false;
  chooserState._resolve?.(value);
  chooserState._resolve = null;
}

/**
 * An on-screen digit-grid keyboard for numeric entry — mirrors NSX's real
 * openFieldPicker(inputMode: 'numeric'), not its openNumberPicker (that one is
 * the scroll-drum WheelPicker already uses elsewhere). NSX's numpad has no
 * min/max clamping or step-snapping either — free-text digits/decimal/
 * backspace, callers parseFloat() the result themselves. Decimal-only, no
 * sign key, matching NSX exactly (no negative values needed for any of the
 * fields this replaces).
 */
export const numberPadState = reactive({
  open: false, title: '', unit: '', value: '', min: null, max: null, linked: null,
  multiPoint: false, _resolve: null,
});

/**
 * @param {{
 *   title: string, unit?: string, value: string|number,
 *   min?: number|null, max?: number|null,
 *   linked?: {
 *     label: string, unit?: string, prefix?: string, value: string|number,
 *     toLinked: (primaryValue: number) => string,
 *     toPrimary: (linkedValue: number) => string,
 *   } | null,
 * }} opts
 *   min/max clamp the CONFIRMED value (not each keystroke — clamping mid-typing
 *   fights the user, e.g. typing "100" one digit at a time under a max of 100).
 *   Opt-in and null by default: the numpad path is deliberately unclamped for
 *   most fields, trusting the typed number as-is (see ProfileEditor.vue's note
 *   and NSX's own behaviour). Pass them only where an out-of-range value is
 *   genuinely meaningless, e.g. a brightness percentage.
 *   `linked` shows a SECOND field next to the primary one (e.g. target yield
 *   grams + brew ratio) — tapping either makes it the one digits go into, and
 *   every keystroke recomputes the OTHER field via toLinked/toPrimary, so
 *   editing either keeps both in sync (see EspressoView.vue's editYield).
 *   `multiPoint` allows MORE THAN ONE decimal point, for a field whose value
 *   is a dotted label rather than a number — a grind setting like "1.2.4" on a
 *   grinder whose scale is ring.number.click. It also skips the min/max clamp,
 *   since parseFloat("1.2.4") is 1.2 and clamping against that would rewrite a
 *   value it never actually read.
 *   The resolved value is always the PRIMARY field — toLinked/toPrimary keep
 *   it current regardless of which field was actually typed into, so a caller
 *   with no `linked` need not change anything.
 * @returns {Promise<string|null>} the entered digits (primary field), or null if cancelled
 */
export function openNumberPad({ title, unit = '', value = '', min = null, max = null, linked = null, multiPoint = false }) {
  return new Promise((resolve) => {
    numberPadState.title = title;
    numberPadState.unit = unit;
    numberPadState.value = String(value ?? '');
    numberPadState.min = min;
    numberPadState.max = max;
    numberPadState.linked = linked;
    numberPadState.multiPoint = multiPoint;
    numberPadState._resolve = resolve;
    numberPadState.open = true;
  });
}

export function resolveNumberPad(value) {
  numberPadState.open = false;
  numberPadState._resolve?.(value);
  numberPadState._resolve = null;
}

/** A yes/no confirmation — distinct from the edit-mode + trash-icon pattern
 *  (RecipePicker/ProfilePicker's own delete rows, which deliberately skip a
 *  confirm step): this is for actions worth an explicit pause, e.g. discarding
 *  unsaved profile-editor changes. */
export const confirmState = reactive({
  open: false, title: '', message: '', confirmLabel: '', danger: false, alert: false, _resolve: null,
});

/**
 * @param {{ title: string, message?: string, confirmLabel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>} true if confirmed, false if cancelled
 */
export function openConfirm({ title, message = '', confirmLabel = '', danger = false }) {
  return new Promise((resolve) => {
    confirmState.title = title;
    confirmState.message = message;
    confirmState.confirmLabel = confirmLabel;
    confirmState.danger = danger;
    confirmState.alert = false;
    confirmState._resolve = resolve;
    confirmState.open = true;
  });
}

/** A one-button acknowledgement (no cancel) — for passive notifications the user
 *  just needs to see and dismiss, e.g. the machine reporting an empty water tank. */
export function openAlert({ title, message = '', confirmLabel = '' }) {
  return new Promise((resolve) => {
    confirmState.title = title;
    confirmState.message = message;
    confirmState.confirmLabel = confirmLabel;
    confirmState.danger = false;
    confirmState.alert = true;
    confirmState._resolve = resolve;
    confirmState.open = true;
  });
}

export function resolveConfirm(value) {
  confirmState.open = false;
  confirmState._resolve?.(value);
  confirmState._resolve = null;
}

/** A 0–5 star rating picker (half steps) — see RatingModal.vue / StarRating.vue. */
export const ratingState = reactive({ open: false, title: '', value: 0, _resolve: null });

/**
 * @param {{ title: string, value?: number }} opts
 * @returns {Promise<number|null>} the chosen rating, or null if cancelled
 */
export function openRating({ title, value = 0 }) {
  return new Promise((resolve) => {
    ratingState.title = title;
    ratingState.value = Number(value) || 0;
    ratingState._resolve = resolve;
    ratingState.open = true;
  });
}

export function resolveRating(value) {
  ratingState.open = false;
  ratingState._resolve?.(value);
  ratingState._resolve = null;
}
