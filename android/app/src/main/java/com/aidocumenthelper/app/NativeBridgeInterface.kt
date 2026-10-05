package com.aidocumenthelper.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.widget.Toast

class NativeBridgeInterface(private val context: Context) {

    // JavaScript interface methods run on a background thread. Toasts and
    // activity launches must happen on the main thread.
    private val mainHandler = Handler(Looper.getMainLooper())

    // Keeps intents well below the binder transaction size limit.
    private val maxShareTextLength = 100_000

    @JavascriptInterface
    fun isAndroid(): Boolean {
        return true
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return try {
            context.packageManager
                .getPackageInfo(context.packageName, 0)
                .versionName ?: "1.0.0"
        } catch (_: Exception) {
            "1.0.0"
        }
    }

    @JavascriptInterface
    fun getApiBaseUrl(): String {
        return try {
            context.getString(R.string.production_web_url)
        } catch (_: Exception) {
            "https://ais-dev-gq2p2ijj6ei7rg6rotit6q-119321813297.asia-southeast1.run.app"
        }
    }

    @JavascriptInterface
    fun vibrate(durationMs: Long) {
        try {
            val validDuration = if (durationMs in 1..2000) durationMs else 50
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator?.vibrate(
                    VibrationEffect.createOneShot(validDuration, VibrationEffect.DEFAULT_AMPLITUDE)
                )
            } else {
                @Suppress("DEPRECATION")
                val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator?.vibrate(VibrationEffect.createOneShot(validDuration, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator?.vibrate(validDuration)
                }
            }
        } catch (_: Exception) {
            // Ignore vibration permission or hardware lack
        }
    }

    @JavascriptInterface
    fun showToast(message: String?) {
        val safeMessage = (message ?: "").take(300)

        if (safeMessage.isBlank()) return

        mainHandler.post {
            Toast.makeText(context, safeMessage, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun shareText(title: String?, text: String?) {
        val safeTitle = (title ?: "AI Document Helper").take(200)
        val safeText = (text ?: "").take(maxShareTextLength)

        mainHandler.post {
            try {
                val sendIntent = Intent().apply {
                    action = Intent.ACTION_SEND
                    putExtra(Intent.EXTRA_TITLE, safeTitle)
                    putExtra(Intent.EXTRA_SUBJECT, safeTitle)
                    putExtra(Intent.EXTRA_TEXT, safeText)
                    type = "text/plain"
                }
                val shareIntent = Intent.createChooser(sendIntent, safeTitle).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(shareIntent)
            } catch (e: Exception) {
                Log.e("NativeBridge", "Unable to open share sheet", e)
                Toast.makeText(context, "Sharing is not available.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    @JavascriptInterface
    fun copyToClipboard(text: String?) {
        val safeText = text ?: ""

        mainHandler.post {
            try {
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                val clip = ClipData.newPlainText("AI Document Helper", safeText)
                clipboard?.setPrimaryClip(clip)

                // Android 13+ shows its own clipboard confirmation.
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                    Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Log.e("NativeBridge", "Unable to copy to clipboard", e)
            }
        }
    }
}
