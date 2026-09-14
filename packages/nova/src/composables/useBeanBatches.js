/**
 * A bean's bags (batches), fetched and sorted — the shared fetch behind both
 * BagsPanel.vue (manage: edit/delete a bag) and BatchPicker.vue (the recipe
 * wizard's own bag-picking step). No reactive store backs this anywhere in
 * nova, and fetchBatches carries no ETag layer, so this is always a real
 * round trip; a factory (one instance per caller) rather than a module
 * singleton, since the two callers look at different beans at different
 * times and must not clobber each other's list.
 */
import { ref } from 'vue';

const { NSXApi } = window;

export function useBeanBatches() {
  const batches = ref([]);
  const loading = ref(false);
  const failed = ref(false);
  let reqId = 0; // race guard — same pattern as RecipeBrowser.vue's reqId

  async function load(beanId) {
    const my = ++reqId;
    if (!beanId) { batches.value = []; loading.value = false; return; }
    loading.value = true;
    failed.value = false;
    try {
      const res = await NSXApi.fetchBatches(beanId, true); // true = include archived
      if (my !== reqId) return; // a newer load already won
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      batches.value = list.slice().sort((a, b) => String(b.roastDate || '').localeCompare(String(a.roastDate || '')));
    } catch (err) {
      if (my !== reqId) return;
      console.warn('[Nova] could not load this bean\'s bags', err?.message);
      batches.value = [];
      failed.value = true;
    } finally {
      if (my === reqId) loading.value = false;
    }
  }

  return { batches, loading, failed, load };
}
