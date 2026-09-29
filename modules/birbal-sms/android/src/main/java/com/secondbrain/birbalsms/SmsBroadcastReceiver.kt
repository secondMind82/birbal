package com.secondbrain.birbalsms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Receives `SMS_RECEIVED` broadcasts and durably records the message so the React
 * Native layer can pick it up whenever it next runs.
 *
 * The receiver is intentionally tiny and dependency-free: it must not throw
 * (a crashing receiver can be disabled by the system), must not touch SQLite or
 * the RN bridge, and must not log message content. It only parses the PDUs the
 * system already delivered and appends to the file-backed inbox.
 */
class SmsBroadcastReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    try {
      if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

      // getMessagesFromIntent returns the parts of a multipart message. A long
      // SMS arrives as several PDUs that belong to ONE logical message, so they
      // are joined by originating address before being stored — otherwise each
      // fragment would become its own notification.
      val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
      if (messages.isEmpty()) return

      val grouped = LinkedHashMap<String, StringBuilder>()
      for (sms in messages) {
        val sender = sms.displayOriginatingAddress ?: sms.originatingAddress ?: continue
        val parts = grouped.getOrPut(sender) { StringBuilder() }
        for (i in 0 until sms.messageBody.length) {
          parts.append(sms.messageBody[i])
        }
      }

      val now = System.currentTimeMillis()
      for ((sender, body) in grouped) {
        val text = body.toString().trim()
        if (text.isEmpty()) continue
        // The message timestamp is part of the dedupe identity, so a redelivery
        // of the same PDU is recognised as the same message.
        val receivedAt = messages.firstOrNull { sms ->
          (sms.displayOriginatingAddress ?: sms.originatingAddress) == sender
        }?.timestampMillis?.takeIf { it > 0 } ?: now
        SmsInboxStore.enqueue(context.applicationContext, sender, text, receivedAt)
      }
    } catch (_: Throwable) {
      // Never let a failure here crash the app or the broadcast.
    }
  }
}
