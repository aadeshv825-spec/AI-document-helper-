package com.aidocumenthelper.app

import android.content.Context
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/**
 * Manages Google Sign-In via Android Credential Manager and Play Services Identity.
 * Provides the official Android system account picker bottom-sheet when the user taps
 * "Continue with Google", without ever auto-starting unrequested authentication.
 */
class GoogleSignInManager(
    private val activity: AppCompatActivity,
    private val webView: WebView
) {
    private val tag = "GoogleSignInManager"
    private val credentialManager: CredentialManager = CredentialManager.create(activity)
    private val scope = CoroutineScope(Dispatchers.Main)

    @JavascriptInterface
    fun isGoogleSignInSupported(): Boolean {
        return true
    }

    /**
     * Triggered explicitly when the user taps the "Continue with Google" button.
     * Launches the official Android Google Account Picker / Credential Manager bottom sheet.
     */
    @JavascriptInterface
    fun launchGoogleSignIn(webClientId: String?) {
        activity.runOnUiThread {
            scope.launch {
                try {
                    val clientId = if (!webClientId.isNullOrBlank()) {
                        webClientId
                    } else {
                        try {
                            activity.getString(R.string.default_web_client_id)
                        } catch (_: Exception) {
                            "ai-document-helper-client"
                        }
                    }

                    Log.d(tag, "Launching Android Credential Manager with Client ID: $clientId")

                    // Build raw nonce & hashed nonce for GoogleIdTokenCredential
                    val rawNonce = UUID.randomUUID().toString()
                    val bytes = rawNonce.toByteArray()
                    val md = MessageDigest.getInstance("SHA-256")
                    val digest = md.digest(bytes)
                    val hashedNonce = digest.fold("") { str, it -> str + "%02x".format(it) }

                    val googleIdOption = GetGoogleIdOption.Builder()
                        .setFilterByAuthorizedAccounts(false)
                        .setServerClientId(clientId)
                        .setAutoSelectEnabled(false) // Ensures explicit user account selection
                        .setNonce(hashedNonce)
                        .build()

                    val request = GetCredentialRequest.Builder()
                        .addCredentialOption(googleIdOption)
                        .build()

                    val response: GetCredentialResponse = withContext(Dispatchers.IO) {
                        credentialManager.getCredential(activity, request)
                    }

                    handleCredentialResponse(response)

                } catch (e: GetCredentialCancellationException) {
                    Log.i(tag, "Google sign-in cancelled by user")
                    sendErrorToWeb("User cancelled Google account selection", "USER_CANCELLED")
                } catch (e: GetCredentialException) {
                    Log.w(tag, "Credential Manager error, falling back to Google Play Account picker: ${e.message}")
                    fallbackToGoogleAccountPicker()
                } catch (e: Exception) {
                    Log.w(tag, "Sign in exception: ${e.message}, attempting fallback")
                    fallbackToGoogleAccountPicker()
                }
            }
        }
    }

    private fun handleCredentialResponse(response: GetCredentialResponse) {
        val credential = response.credential
        when (credential) {
            is CustomCredential -> {
                if (credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    try {
                        val googleIdToken = GoogleIdTokenCredential.createFrom(credential.data)
                        val idToken = googleIdToken.idToken
                        val email = googleIdToken.id
                        val displayName = googleIdToken.displayName ?: email.substringBefore("@")
                        val photoUrl = googleIdToken.profilePictureUri?.toString() ?: ""

                        Log.i(tag, "Successfully selected Google account: $email")

                        sendSuccessToWeb(
                            idToken = idToken,
                            email = email,
                            displayName = displayName,
                            photoUrl = photoUrl
                        )
                    } catch (e: Exception) {
                        Log.e(tag, "Error parsing GoogleIdTokenCredential", e)
                        fallbackToGoogleAccountPicker()
                    }
                } else {
                    fallbackToGoogleAccountPicker()
                }
            }
            else -> {
                fallbackToGoogleAccountPicker()
            }
        }
    }

    /**
     * Fallback for devices without Play Services Identity Credential Provider,
     * using the standard Google Play Services account picker or device accounts.
     */
    private fun fallbackToGoogleAccountPicker() {
        try {
            val serverClientId = try {
                activity.getString(R.string.default_web_client_id)
            } catch (_: Exception) {
                ""
            }

            val account = GoogleSignIn.getLastSignedInAccount(activity)
            if (account != null && !account.email.isNullOrBlank() && !account.idToken.isNullOrBlank()) {
                sendSuccessToWeb(
                    idToken = account.idToken!!,
                    email = account.email ?: "user@gmail.com",
                    displayName = account.displayName ?: account.givenName ?: "Google User",
                    photoUrl = account.photoUrl?.toString() ?: ""
                )
                return
            }

            // Create a Google Sign-In client to prompt account selection with ID Token
            val builder = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestProfile()

            if (serverClientId.isNotBlank()) {
                builder.requestIdToken(serverClientId)
            }

            val googleSignInClient = GoogleSignIn.getClient(activity, builder.build())
            val intent = googleSignInClient.signInIntent
            activity.startActivity(intent)

        } catch (e: Exception) {
            Log.e(tag, "Fallback Google account picker failed", e)
            sendErrorToWeb("Could not complete Google Sign-In: ${e.message}", "UNAVAILABLE")
        }
    }

    private fun sendSuccessToWeb(idToken: String, email: String, displayName: String, photoUrl: String) {
        val jsonPayload = JSONObject().apply {
            put("type", "NATIVE_GOOGLE_AUTH_SUCCESS")
            put("idToken", idToken)
            put("email", email)
            put("displayName", displayName)
            put("photoUrl", photoUrl)
        }.toString()

        val escapedPayload = JSONObject.quote(jsonPayload)
        val jsScript = """
            (function() {
                try {
                    var data = JSON.parse($escapedPayload);
                    window.dispatchEvent(new CustomEvent('onNativeGoogleSignInSuccess', { detail: data }));
                    if (window.onNativeGoogleSignInSuccess) {
                        window.onNativeGoogleSignInSuccess(data);
                    }
                } catch(err) {
                    console.error('Failed to dispatch native Google Sign-In success', err);
                }
            })();
        """.trimIndent()

        activity.runOnUiThread {
            webView.evaluateJavascript(jsScript, null)
        }
    }

    private fun sendErrorToWeb(errorMessage: String, errorCode: String) {
        val jsonPayload = JSONObject().apply {
            put("type", "NATIVE_GOOGLE_AUTH_ERROR")
            put("error", errorMessage)
            put("code", errorCode)
        }.toString()

        val escapedPayload = JSONObject.quote(jsonPayload)
        val jsScript = """
            (function() {
                try {
                    var data = JSON.parse($escapedPayload);
                    window.dispatchEvent(new CustomEvent('onNativeGoogleSignInError', { detail: data }));
                    if (window.onNativeGoogleSignInError) {
                        window.onNativeGoogleSignInError(data);
                    }
                } catch(err) {
                    console.error('Failed to dispatch native Google Sign-In error', err);
                }
            })();
        """.trimIndent()

        activity.runOnUiThread {
            webView.evaluateJavascript(jsScript, null)
        }
    }
}
