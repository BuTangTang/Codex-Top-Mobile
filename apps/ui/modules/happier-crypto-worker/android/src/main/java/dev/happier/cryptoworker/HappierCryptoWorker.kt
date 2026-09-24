package dev.happier.cryptoworker

import android.util.Base64
import java.nio.ByteBuffer
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

internal object HappierCryptoWorker {
  private const val aesGcmVersionByte: Byte = 0
  private const val aesGcmKeyBytes = 32
  private const val aesGcmNonceBytes = 12
  private const val aesGcmTagBits = 128
  private const val aesGcmTagBytes = 16

  /** 使用 Android 标准 PBKDF2-SHA512，严格保留 UTF-8 密码的 NUL、空白及 Unicode，不手写密码学算法。 */
  fun derivePasswordMasterV1(passwordBase64: String, saltBase64: String): String {
    val passwordUtf8 = Base64.decode(passwordBase64, Base64.NO_WRAP)
    val salt = Base64.decode(saltBase64, Base64.NO_WRAP)
    var passwordChars: CharArray? = null
    var spec: PBEKeySpec? = null
    var master: ByteArray? = null
    try {
      require(salt.size == 32) { "Invalid password derivation salt" }
      // 标准 UTF-8 decoder 拒绝无效字节；JS 已统一处理字符串编码，不执行 trim/normalize。
      val decoded = Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(passwordUtf8))
      val chars = CharArray(decoded.remaining())
      decoded.get(chars)
      if (decoded.hasArray()) decoded.array().fill('\u0000')
      passwordChars = chars
      require(chars.isNotEmpty() && chars.size <= 1024) { "Invalid password derivation length" }
      val keySpec = PBEKeySpec(chars, salt, 220000, 512)
      spec = keySpec
      val derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA512").generateSecret(keySpec).encoded
      master = derived
      require(derived.size == 64) { "Invalid password derivation result" }
      return Base64.encodeToString(derived, Base64.NO_WRAP)
    } finally {
      // 跨桥结果编码后清理本地可变缓冲；协议 owner 随后负责清理 JS 主密钥。
      spec?.clearPassword()
      passwordChars?.fill('\u0000')
      passwordUtf8.fill(0)
      salt.fill(0)
      master?.fill(0)
    }
  }

  fun capabilities(): Map<String, Any> = mapOf(
    "moduleVersion" to HappierCryptoWorkerTypes.moduleVersion,
    "platform" to HappierCryptoWorkerTypes.platform,
    "supportedOperations" to HappierCryptoWorkerTypes.supportedOperations
  )

  fun echoBatchForDiagnostics(values: List<String>): List<String> = values

  fun decryptDataKeyEnvelopeV1Batch(items: List<Map<String, String>>): List<String?> =
    items.map { item ->
      val envelope = HappierCryptoWorkerBase64.decode(item["envelopeBase64"]) ?: return@map null
      val secret = HappierCryptoWorkerBase64.decode(item["recipientSecretKeyOrSeedBase64"]) ?: return@map null
      val opened = HappierCryptoWorkerNative.openDataKeyEnvelopeV1(envelope, secret) ?: return@map null
      Base64.encodeToString(opened, Base64.NO_WRAP)
    }

  fun decryptSecretboxJsonBatch(items: List<Map<String, String>>): List<Any?> =
    items.map { item ->
      val ciphertext = HappierCryptoWorkerBase64.decode(item["ciphertextBase64"]) ?: return@map null
      val key = HappierCryptoWorkerBase64.decode(item["keyBase64"]) ?: return@map null
      val opened = HappierCryptoWorkerNative.openSecretboxJson(ciphertext, key) ?: return@map null
      HappierCryptoWorkerSerializedJson.parseEnvelopeOrOriginal(opened.toString(Charsets.UTF_8))
    }

  fun decryptAesGcmJsonBatch(items: List<Map<String, String>>): List<Any?> =
    items.map { item ->
      val encryptedPayload = HappierCryptoWorkerBase64.decode(item["encryptedPayloadBase64"]) ?: return@map null
      val key = HappierCryptoWorkerBase64.decode(item["keyBase64"]) ?: return@map null
      decryptAesGcmJson(encryptedPayload, key)
    }

  private fun decryptAesGcmJson(encryptedPayload: ByteArray, key: ByteArray): Any? {
    if (
      key.size != aesGcmKeyBytes ||
      encryptedPayload.size < 1 + aesGcmNonceBytes + aesGcmTagBytes ||
      encryptedPayload[0] != aesGcmVersionByte
    ) {
      return null
    }

    return try {
      val nonce = encryptedPayload.copyOfRange(1, 1 + aesGcmNonceBytes)
      val ciphertextAndTag = encryptedPayload.copyOfRange(1 + aesGcmNonceBytes, encryptedPayload.size)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(aesGcmTagBits, nonce))
      HappierCryptoWorkerSerializedJson.parseEnvelopeOrOriginal(cipher.doFinal(ciphertextAndTag).toString(Charsets.UTF_8))
    } catch (_: Exception) {
      null
    }
  }

}
