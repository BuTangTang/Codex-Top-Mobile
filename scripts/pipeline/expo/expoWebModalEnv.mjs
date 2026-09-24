// @ts-check

export const EXPO_WEB_MODAL_ENV = Object.freeze({
  EXPO_UNSTABLE_WEB_MODAL: '1',
});

/**
 * @template {Record<string, string | undefined>} T
 * @param {T} env
 * @returns {T & typeof EXPO_WEB_MODAL_ENV}
 */
export function applyExpoWebModalEnv(env) {
  return {
    ...env,
    ...EXPO_WEB_MODAL_ENV,
  };
}
