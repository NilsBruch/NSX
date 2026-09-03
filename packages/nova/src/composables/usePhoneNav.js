/**
 * Which of the phone's four tabs is active — module-level (not a local ref in
 * MobileShell.vue), because two other things need to reach it: useAccent.js,
 * so the whole document is tinted by the active phone tab instead of being
 * stuck on whatever `useRoute()` last resolved (the phone never navigates the
 * router at all), and any screen that wants to jump tabs (e.g. loading a
 * recipe from the Diary and landing back on Recipes).
 *
 * Accents are borrowed from the tablet's six-colour palette in
 * router/index.js rather than re-picked — that keeps every accent decision
 * single-sourced, and a phone tab that shares a concern with a tablet page
 * (Diary, Settings) shares its colour too.
 */
import { ref } from 'vue';
import { TABS } from '../router/index.js';

const accentOf = (tabName) => TABS.find((t) => t.name === tabName)?.accent;

export const PHONE_TABS = [
  { id: 'recipes', labelKey: 'phone.recipes', accent: accentOf('espresso'), icon: '<path d="M6 9h13v7a5 5 0 0 1-5 5h-3a5 5 0 0 1-5-5V9z"/><path d="M19 10h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M9 5.5c0-1 1-1 1-2M13 5.5c0-1 1-1 1-2"/>' },
  { id: 'machine', labelKey: 'phone.machine', accent: accentOf('cleaning'), icon: '<path d="M12 4v3M12 7c-3.5 0-5 2-5 4h10c0-2-1.5-4-5-4z"/><path d="M7.5 14.5v.01M10.5 16v.01M13.5 14.5v.01M16.5 16v.01M9 18.5v.01M15 18.5v.01M12 20v.01"/>' },
  { id: 'diary', labelKey: 'tab.diary', accent: accentOf('diary'), icon: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15.5H7.5A2.5 2.5 0 0 0 5 21V5.5z"/><path d="M5 18.5A2.5 2.5 0 0 1 7.5 16H19"/><path d="M9.5 7.5h5.5M9.5 10.5h4"/>' },
  { id: 'settings', labelKey: 'tab.settings', accent: accentOf('settings'), icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.7 7.7 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.5a7.7 7.7 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.7 7.7 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.7 7.7 0 0 0 2.6-1.5l2.3 1 2-3.4-2-1.5z"/>' },
];

export const phoneTab = ref('recipes');

export function goPhoneTab(id) {
  phoneTab.value = id;
}
