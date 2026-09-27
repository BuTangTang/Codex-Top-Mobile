import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const plugin = require('../../plugins/withAndroidProbeConnectionRecovery.js');
const apply = plugin.applyProbeConnectionRecovery as (source: { language: string; contents: string }) => string;

const mainApplication = `package app.example

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
}
`;

describe('withAndroidProbeConnectionRecovery', () => {
    it('installs the hook after Application initialization and before the React Native runtime, once', () => {
        const patched = apply({ language: 'kt', contents: mainApplication });
        const hookStart = patched.indexOf('com.facebook.react.modules.network.NetworkingModule.setCustomClientBuilder');

        expect(hookStart).toBeGreaterThan(patched.indexOf('super.onCreate()'));
        expect(hookStart).toBeLessThan(patched.indexOf('loadReactNative(this)'));
        expect(patched).toContain('ApplicationLifecycleDispatcher.onApplicationCreate(this)');
        expect(patched).toContain('previous !== okhttp3.EventListener.NONE');
        expect(patched).toContain('request.method != "GET"');
        expect(patched).toContain('!request.url.encodedPath.endsWith("/v1/auth/ping")');
        expect(patched).toContain('inherited.connectionPool.evictAll()');
        expect(apply({ language: 'kt', contents: patched })).toBe(patched);
    });

    it('fails explicitly when the Kotlin startup template no longer has its installation point', () => {
        expect(() => apply({
            language: 'kt',
            contents: mainApplication.replace('super.onCreate()', 'initializeApplication()'),
        })).toThrow(/Kotlin MainApplication.*onCreate/i);
    });

    it('rejects an unsupported MainApplication language instead of emitting Kotlin into it', () => {
        expect(() => apply({ language: 'java', contents: 'public class MainApplication {}' }))
            .toThrow(/Kotlin MainApplication/i);
    });
});
