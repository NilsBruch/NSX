/**
 * Shared, translated display helpers for a profile's frames — used by both
 * ProfilePicker.vue (read-only detail pane) and ProfileEditor.vue (step list
 * summaries). The actual frame/exit NORMALIZATION is pure and lives in core
 * (NSXCore.normalizeFrameExit); this file only adds i18n phrase-building on
 * top, which can't live in core (core has no i18n of its own).
 */
import { fmtTemp } from './useUnits.js';

const { NSXCore } = window;

export function frames(p) {
  return p?.profile?.steps ?? p?.profile?.frames ?? [];
}

function exitPhrase(exit, t) {
  if (!exit.enabled) return null;
  if (exit.type === 'weight') return t('profilePicker.exitWeight', { value: exit.value.toFixed(0) });
  const key = {
    pressure_over: 'exitPressureOver',
    pressure_under: 'exitPressureUnder',
    flow_over: 'exitFlowOver',
    flow_under: 'exitFlowUnder',
  }[exit.type] || 'exitPressureOver';
  return t(`profilePicker.${key}`, { value: exit.value.toFixed(1) });
}

/** What actually ends a frame: its exit condition (pressure/flow threshold, or
 *  a weight target), not its nominal "seconds" — that field is closer to a
 *  safety cap than the real stop reason whenever an exit is set. Falls back
 *  to a plain duration only when the frame carries no exit condition. */
export function frameDetailText(f, t) {
  // Formatted, not bare: the sentence reads 'At 93°C, ...' and the unit is
  // part of what the frame says, so it follows the skin's temperature setting.
  const temp = fmtTemp(f?.temperature || 0);
  const pump = f?.pump === 'flow' ? t('profilePicker.pumpFlow') : t('profilePicker.pumpPressure');
  const value = f?.pump === 'flow' ? `${Number(f?.flow || 0).toFixed(1)} ml/s` : `${Number(f?.pressure || 0).toFixed(1)} bar`;
  const exit = exitPhrase(NSXCore.normalizeFrameExit(f), t);
  return exit
    ? t('profilePicker.stageUntil', { temp, pump, value, exit })
    : t('profilePicker.stageFor', { temp, pump, value, seconds: Number(f?.seconds || 0).toFixed(1) });
}

export function frameName(f, idx, t) {
  return f?.name || `${t('profilePicker.stageName')} ${idx + 1}`;
}
