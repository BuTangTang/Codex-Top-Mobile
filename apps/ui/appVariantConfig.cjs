const path = require('node:path');

// Keep this module dependency-free so it can run in GitHub Actions before `yarn install`.
// We load the canonical release ring catalog from the checked-in CJS entrypoint.
const releaseRings = require(path.resolve(__dirname, '..', '..', 'packages', 'release-runtime', 'releaseRings.cjs'));
const { getReleaseRingCatalogEntry, normalizeReleaseRingId } = releaseRings;

/** 按发布环的 Expo 环境得到 development、preview 或 production，不改环本身的包名和 scheme。 */
function resolveLogicalVariantFromRing(ring) {
    if (ring.expoAppEnv === 'production') return 'production';
    if (ring.expoAppEnv === 'development') return 'development';
    return 'preview';
}

/** 用发布环拼出某一变体的配置。显示名由调用处传入，包名和 scheme 仍取环上的原值。 */
function buildRingBackedConfig(ringId, overrides) {
    const ring = getReleaseRingCatalogEntry(ringId);
    return {
        id: ringId,
        logicalVariant: resolveLogicalVariantFromRing(ring),
        name: overrides.name,
        iosBundleId: overrides.iosBundleId,
        androidPackage: overrides.androidPackage,
        scheme: ring.appScheme,
        updatesChannel: ring.expoUpdatesChannel,
        featurePolicyEnv: ring.embeddedPolicyEnv,
        enableAssociatedDomains: overrides.enableAssociatedDomains,
    };
}

/** 组装正式变体。显示名单独传入，不改动正式包名、scheme 或更新通道。 */
function buildProductionConfig(overrides) {
    const ring = getReleaseRingCatalogEntry('stable');
    return {
        id: 'production',
        logicalVariant: 'production',
        name: overrides.name,
        iosBundleId: overrides.iosBundleId,
        androidPackage: overrides.androidPackage,
        scheme: ring.appScheme,
        updatesChannel: ring.expoUpdatesChannel,
        featurePolicyEnv: ring.embeddedPolicyEnv,
        enableAssociatedDomains: overrides.enableAssociatedDomains,
    };
}

const APP_ENVIRONMENT_CONFIGS = {
    internaldev: buildRingBackedConfig('internaldev', {
        name: 'Codex Top',
        iosBundleId: 'dev.happier.app.dev.internal',
        androidPackage: 'dev.happier.app.internaldev',
        enableAssociatedDomains: false,
    }),
    internalpreview: buildRingBackedConfig('internalpreview', {
        name: 'Codex Top',
        iosBundleId: 'dev.happier.app.internalpreview',
        androidPackage: 'dev.happier.app.internalpreview',
        enableAssociatedDomains: false,
    }),
    publicdev: buildRingBackedConfig('publicdev', {
        name: 'Codex Top',
        iosBundleId: 'dev.happier.app.publicdev',
        androidPackage: 'dev.happier.app.publicdev',
        enableAssociatedDomains: false,
    }),
    preview: buildRingBackedConfig('preview', {
        name: 'Codex Top',
        iosBundleId: 'dev.happier.app.preview',
        androidPackage: 'dev.happier.app.preview',
        enableAssociatedDomains: false,
    }),
    production: buildProductionConfig({
        name: 'Codex Top',
        iosBundleId: 'dev.happier.app',
        androidPackage: 'dev.happier.app',
        enableAssociatedDomains: true,
    }),
};

/** 把 APP_ENV 收成已知变体 id。无法识别时返回空字符串，由读取方回落到内部开发变体。 */
function normalizeAppEnvironmentId(raw) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (!value) return '';
    if (Object.prototype.hasOwnProperty.call(APP_ENVIRONMENT_CONFIGS, value)) {
        return value;
    }

    const ring = normalizeReleaseRingId(value);
    if (!ring) return '';
    return ring === 'stable' ? 'production' : ring;
}

/** 读取变体配置。未设置 APP_ENV 时使用 internaldev，避免未知环境生成空的包名。 */
function getAppEnvironmentConfig(raw) {
    const normalized = normalizeAppEnvironmentId(raw) || 'internaldev';
    return APP_ENVIRONMENT_CONFIGS[normalized];
}

module.exports = {
    APP_ENVIRONMENT_CONFIGS,
    getAppEnvironmentConfig,
    normalizeAppEnvironmentId,
};
