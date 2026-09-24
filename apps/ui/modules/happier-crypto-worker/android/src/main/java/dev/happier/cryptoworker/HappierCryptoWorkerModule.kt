package dev.happier.cryptoworker

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HappierCryptoWorkerModule : Module() {
  /** 注册原生后台能力；密码慢派生和现有解密均避免占用 React Native 的 JS/UI 线程。 */
  override fun definition() = ModuleDefinition {
    Name("HappierCryptoWorker")

    /** 密码参数已由版本固定，原生只接受 UTF-8 密码字节和盐，不提供降级迭代入口。 */
    AsyncFunction("derivePasswordMasterV1") { passwordBase64: String, saltBase64: String ->
      return@AsyncFunction HappierCryptoWorker.derivePasswordMasterV1(passwordBase64, saltBase64)
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("getCapabilities") {
      return@AsyncFunction HappierCryptoWorker.capabilities()
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("echoBatchForDiagnostics") { values: List<String> ->
      return@AsyncFunction HappierCryptoWorker.echoBatchForDiagnostics(values)
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("decryptDataKeyEnvelopeV1Batch") { items: List<Map<String, String>> ->
      return@AsyncFunction HappierCryptoWorker.decryptDataKeyEnvelopeV1Batch(items)
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("decryptSecretboxJsonBatch") { items: List<Map<String, String>> ->
      return@AsyncFunction HappierCryptoWorker.decryptSecretboxJsonBatch(items)
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("decryptAesGcmJsonBatch") { items: List<Map<String, String>> ->
      return@AsyncFunction HappierCryptoWorker.decryptAesGcmJsonBatch(items)
    }.runOnQueue(Queues.DEFAULT)
  }
}
