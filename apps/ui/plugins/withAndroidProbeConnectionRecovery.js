const { withMainApplication } = require('@expo/config-plugins');

const INSTALL_MARKER = '    // Happier auth-ping idle connection recovery.';
const INSTALL_HOOK = `${INSTALL_MARKER}
    com.facebook.react.modules.network.NetworkingModule.setCustomClientBuilder { builder ->
      val inherited = builder.build()
      builder.eventListenerFactory { call ->
        val previous = inherited.eventListenerFactory.create(call)
        val request = call.request()
        if (previous !== okhttp3.EventListener.NONE ||
            request.method != "GET" ||
            !request.url.encodedPath.endsWith("/v1/auth/ping")) {
          previous
        } else {
          object : okhttp3.EventListener() {
            override fun callFailed(call: okhttp3.Call, ioe: java.io.IOException) {
              // A canceled HTTP/2 probe can leave its old connection reusable.
              // Only idle connections are removed; in-flight calls are untouched.
              inherited.connectionPool.evictAll()
            }
          }
        }
      }
    }`;

function applyProbeConnectionRecovery(mainApplication) {
  const { language, contents } = mainApplication;
  if (language !== 'kt') {
    throw new Error('Auth-ping connection recovery requires a Kotlin MainApplication.');
  }
  if (contents.includes(INSTALL_HOOK)) return contents;

  const onCreate = /override\s+fun\s+onCreate\s*\(\s*\)\s*\{\s*\n[ \t]*super\.onCreate\(\)/;
  if (contents.includes(INSTALL_MARKER) || !onCreate.test(contents)) {
    throw new Error('Unable to install auth-ping connection recovery in Kotlin MainApplication.onCreate.');
  }
  return contents.replace(onCreate, (match) => `${match}\n${INSTALL_HOOK}`);
}

const withAndroidProbeConnectionRecovery = (config) => withMainApplication(config, (applicationConfig) => {
  applicationConfig.modResults.contents = applyProbeConnectionRecovery(applicationConfig.modResults);
  return applicationConfig;
});

withAndroidProbeConnectionRecovery.applyProbeConnectionRecovery = applyProbeConnectionRecovery;

module.exports = withAndroidProbeConnectionRecovery;
