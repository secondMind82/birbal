package com.secondbrain.birbalsms

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * A tiny file-backed inbox for captured SMS.
 *
 * Why a file and not SQLite: this is written from a BroadcastReceiver, which can
 * run when the React Native runtime, the JS bridge and therefore expo-sqlite do
 * not exist at all (app killed, screen locked, process restarted by the system).
 * A plain file is readable and writable from that context, so an SMS that
 * arrives at 3am is durably captured and handed to JS the next time the app
 * starts.
 *
 * Privacy: message bodies are never written to logcat, and this file lives in
 * the app's private internal storage (context.filesDir), which is not readable
 * by other apps and is removed on uninstall.
 */
internal object SmsInboxStore {

  private const val FILE_NAME = "birbal-sms-inbox.json"
  private const val MAX_QUEUED = 50

  /** The receiver and the module run on different threads; all access is serialised. */
  private val lock = Any()

  /**
   * Stable identity for a message.
   *
   * Android's SMS_RECEIVED broadcast does not expose the provider's row id, and
   * the same message can be redelivered (e.g. after a receiver timeout or a
   * reboot). Hashing sender + body + the message timestamp gives an id that is
   * identical for every redelivery of the SAME message and different for two
   * genuinely distinct messages, which is exactly the dedupe key §20 needs.
   */
  private fun messageId(sender: String, body: String, receivedAt: Long): String {
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(sender.toByteArray(Charsets.UTF_8))
    digest.update('\u0000'.code.toByte())
    digest.update(body.toByteArray(Charsets.UTF_8))
    digest.update('\u0000'.code.toByte())
    digest.update(receivedAt.toString().toByteArray(Charsets.UTF_8))
    return digest.digest().joinToString("") { "%02x".format(it) }.substring(0, 32)
  }

  private fun fileFor(context: Context) = File(context.filesDir, FILE_NAME)

  private fun readAll(file: File): MutableList<JSONObject> {
    if (!file.exists()) return mutableListOf()
    return try {
      val array = JSONArray(file.readText())
      val out = mutableListOf<JSONObject>()
      for (i in 0 until array.length()) {
        array.optJSONObject(i)?.let(out::add)
      }
      out
    } catch (_: Throwable) {
      // A corrupt queue must never crash the app; start clean instead.
      mutableListOf()
    }
  }

  private fun writeAll(file: File, items: List<JSONObject>) {
    try {
      val array = JSONArray()
      items.forEach(array::put)
      file.writeText(array.toString())
    } catch (_: Throwable) {
      // Losing the queue is preferable to crashing the receiver.
    }
  }

  /**
   * Records one message, ignoring it if it is already queued.
   * Returns true when the message was newly stored.
   */
  fun enqueue(context: Context, sender: String, body: String, receivedAt: Long): Boolean {
    val id = messageId(sender, body, receivedAt)
    return synchronized(lock) {
      val file = fileFor(context)
      val items = readAll(file)
      if (items.any { it.optString("id") == id }) return false

      items.add(
        JSONObject()
          .put("id", id)
          .put("sender", sender)
          .put("body", body)
          .put("receivedAt", receivedAt),
      )

      // Bound the queue: an unreviewed backlog has no value beyond a point, and
      // the cap keeps a malicious/buggy sender from growing the file forever.
      val kept = if (items.size > MAX_QUEUED) {
        val overflow = items.size - MAX_QUEUED
        items.subList(overflow, items.size).toList()
      } else {
        items
      }
      writeAll(file, kept)
      true
    }
  }

  /**
   * Returns every queued message WITHOUT removing any of them.
   *
   * The queue is deliberately peek-only. JS owns durability from this point on:
   * it writes each message into SQLite and only then calls [ack]. A version that
   * cleared the file here would permanently destroy a real SMS if the app was
   * killed, crashed, or hit a locked database between the read and the write,
   * because there would be no second copy anywhere. Re-delivering a message that
   * was already stored is harmless, because the local table is keyed by the
   * message id.
   */
  fun peek(context: Context): List<JSONObject> = synchronized(lock) { readAll(fileFor(context)) }

  /**
   * Removes the given message ids, after JS has durably stored them.
   *
   * Unknown ids are ignored so an ack can never fail and strand the queue.
   */
  fun ack(context: Context, ids: Set<String>) = synchronized(lock) {
    if (ids.isEmpty()) return
    val file = fileFor(context)
    val remaining = readAll(file).filterNot { ids.contains(it.optString("id")) }
    if (remaining.size != readAll(file).size) {
      writeAll(file, remaining)
    }
  }

  fun count(context: Context): Int = synchronized(lock) { readAll(fileFor(context)).size }
}
