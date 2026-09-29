package com.secondbrain.birbalsms

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS-facing surface of the SMS capture module.
 *
 * Deliberately minimal: the receiver has already persisted every message by the
 * time JS runs, so all this module does is hand over the queue and tell JS when
 * new mail has landed. That keeps the background path (app killed) and the
 * foreground path (app alive) identical, instead of relying on a broadcast
 * bridge that is unavailable when JS is not running.
 */
class BirbalSmsModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("BirbalSms")

    Events("onSmsReceived")

    AsyncFunction("isAvailable") {
      // The module only exists in the Android build; JS treats a missing module
      // as "unavailable" too, so this is a defensive double-check.
      true
    }

    AsyncFunction("drain") {
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      SmsInboxStore.drain(context).map { record ->
        mapOf(
          "id" to record.optString("id"),
          "sender" to record.optString("sender"),
          "body" to record.optString("body"),
          "receivedAt" to record.optLong("receivedAt"),
        )
      }
    }

    AsyncFunction("pendingCount") {
      val context = appContext.reactContext ?: return@AsyncFunction 0
      SmsInboxStore.count(context)
    }
  }
}
