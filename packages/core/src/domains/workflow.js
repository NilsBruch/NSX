"use strict";
/**
 * NSXCore workflow domain — recipe-store I/O + the simple gateway-payload
 * fallback builder. This is a FOUNDATION slice, not the full workflow domain:
 * `workflowItems`/`selectedWorkflowIndex` (selection state) and
 * `_buildRecipeGatewayPayload` (the profile-matching payload builder) stay in
 * app.js for now — they're tightly coupled to the not-yet-extracted profile
 * picker subsystem (_ensureProfilesLoaded, profile caches) and live
 * connection state (scaleConnected), and to DOM rendering. Moving only the
 * two pieces below keeps core's "no app-state, no DOM" invariant intact.
 *
 * Registered on NSXCore:
 *   Commands: loadRecipes(), saveRecipes(recipes), makeRecipeId(),
 *             workflowToGatewayPayload(workflow)
 */
(function () {
  const NSXCore = window.NSXCore;
  if (!NSXCore) {
    console.error("[NSXCore.workflow] core.js must load before domains/workflow.js");
    return;
  }

  const RECIPE_NS  = "NSX";
  const RECIPE_KEY = "recipes";

  async function loadRecipes() {
    const { getStoreValue } = window.NSXApi || {};
    try {
      const data = await getStoreValue?.(RECIPE_NS, RECIPE_KEY);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async function saveRecipes(recipes) {
    const { setStoreValue } = window.NSXApi || {};
    try {
      await setStoreValue?.(RECIPE_NS, RECIPE_KEY, recipes);
    } catch (err) {
      console.warn("Recipes could not be saved:", err?.message);
    }
  }

  function makeRecipeId() {
    return `recipe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  // Fallback payload for contexts without a resolved profile/gateway workflow
  // (e.g. building a shot-diff comparison from a past shot's recipe fields).
  // The real push path uses app.js's _buildRecipeGatewayPayload instead.
  function workflowToGatewayPayload(workflow) {
    if (workflow?._resolvedPayload) return workflow._resolvedPayload;
    if (workflow?.gatewayWorkflow && typeof workflow.gatewayWorkflow === "object") {
      return workflow.gatewayWorkflow;
    }
    return {
      profile: { title: workflow?.profileTitle || "—" },
      context: {
        coffeeRoaster: workflow?.coffeeRoaster || "—",
        coffeeName: workflow?.coffeeName || "—",
        grinderModel: workflow?.grinderModel || "—",
        grinderSetting: workflow?.grinderSetting || "—",
        targetDoseWeight: Number(workflow?.targetDoseWeight || 0),
        targetYield: Number(workflow?.targetYield || 0),
      },
    };
  }

  NSXCore.register({
    loadRecipes,
    saveRecipes,
    makeRecipeId,
    workflowToGatewayPayload,
  });
})();
