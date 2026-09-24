package dev.happier.hardwarekeyboardshortcuts

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

data class HardwareKeyboardAllowedEvent(
  val key: String,
  val shift: Boolean,
  val ctrl: Boolean,
  val meta: Boolean,
  val alt: Boolean
)

class HappierHardwareKeyboardShortcutsModule : Module() {
  @Volatile
  private var hardwareKeyEventsEnabled = false

  @Volatile
  private var allowedHardwareKeyEvents: Set<HardwareKeyboardAllowedEvent> = emptySet()

  @Volatile
  private var hasHardwareKeyListener = false

  override fun definition() = ModuleDefinition {
    Name("HappierHardwareKeyboardShortcuts")

    Events("hardwareKey")

    // Expo calls these at first-listener/zero-listener boundaries; the bridge
    // must not consume Activity keys unless JS has a live native listener.
    OnStartObserving("hardwareKey") {
      hasHardwareKeyListener = true
      updateBridgeRegistration()
    }

    OnStopObserving("hardwareKey") {
      hasHardwareKeyListener = false
      updateBridgeRegistration()
    }

    AsyncFunction("setHardwareKeyEventsEnabled") { enabled: Boolean, allowlist: Map<String, Any?>? ->
      hardwareKeyEventsEnabled = enabled
      allowedHardwareKeyEvents = if (enabled) parseAllowlist(allowlist) else emptySet()
      updateBridgeRegistration()
    }
  }

  fun canReceiveHardwareKeyEvents(): Boolean =
    hardwareKeyEventsEnabled && hasHardwareKeyListener && allowedHardwareKeyEvents.isNotEmpty()

  fun isHardwareKeyAllowed(payload: Map<String, Any>): Boolean {
    val key = payload["key"] as? String ?: return false
    val modifiers = payload["modifiers"] as? Map<*, *> ?: return false
    return allowedHardwareKeyEvents.contains(
      HardwareKeyboardAllowedEvent(
        key = key,
        shift = modifiers["shift"] == true,
        ctrl = modifiers["ctrl"] == true,
        meta = modifiers["meta"] == true,
        alt = modifiers["alt"] == true
      )
    )
  }

  fun emitHardwareKey(payload: Map<String, Any>) {
    sendEvent("hardwareKey", payload)
  }

  private fun updateBridgeRegistration() {
    HappierHardwareKeyboardShortcutsBridge.setModule(this)
    HappierHardwareKeyboardShortcutsBridge.setEnabled(canReceiveHardwareKeyEvents())
  }

  private fun parseAllowlist(allowlist: Map<String, Any?>?): Set<HardwareKeyboardAllowedEvent> {
    val events = allowlist?.get("allowedEvents") as? List<*> ?: return emptySet()
    return events.mapNotNull { rawEvent ->
      val event = rawEvent as? Map<*, *> ?: return@mapNotNull null
      val key = event["key"] as? String ?: return@mapNotNull null
      val modifiers = event["modifiers"] as? Map<*, *> ?: emptyMap<Any, Any>()
      HardwareKeyboardAllowedEvent(
        key = key,
        shift = modifiers["shift"] == true,
        ctrl = modifiers["ctrl"] == true,
        meta = modifiers["meta"] == true,
        alt = modifiers["alt"] == true
      )
    }.toSet()
  }
}
