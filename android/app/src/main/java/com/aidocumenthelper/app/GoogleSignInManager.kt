
package com.aidocumenthelper.app

import android.content.Intent
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
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

class GoogleSignInManager(
    private val activity: AppCompatActivity,
    private val webView: WebView
) {
    private val tag = "GoogleSignInManager"

    private val credentialManager: CredentialManager =
        CredentialManager.create(activity)

    private val scope = CoroutineScope(Dispatchers.Main)

    @JavascriptInterface
    fun isGoogleSignInSupported(): Boolean {
        return true
    }

    @JavascriptInterface
    fun launchGoogleSignIn(webClientId: String?) {
        activity.runOnUiThread {
            scope.launch {
                try {
                    val clientId =
                        if (!webClientId.isNullOrBlank()) {
                            webClientId
                        } else {
                            activity.getString(R.string.default_web_client_id)
                        }

                    val rawNonce = UUID.randomUUID().toString()

                    val digest = MessageDigest.getInstance("SHA-256")
                        .digest(rawNonce.toByteArray())

                    val hashedNonce = digest.joinToString("") {
                        "%02x".format(it)
                    }

                    val googleIdOption =
                        GetGoogleIdOption.Builder()
                            .setFilterByAuthorizedAccounts(false)
                            .setServerClientId(clientId)
                            .setAutoSelectEnabled(false)
                            .setNonce(hashedNonce)
                            .build()

                    val request =
                        GetCredentialRequest.Builder()
                            .addCredentialOption(googleIdOption)
                            .build()

                    // Credential Manager must run from the Main coroutine.
                    val response: GetCredentialResponse =
                        credentialManager.getCredential(
                            activity,
                            request
                        )

                    handleCredentialResponse(response)

                } catch (e: GetCredentialCancellationException) {
                    Log.i(tag, "Google sign-in cancelled")

                    sendErrorToWeb(
                        "User cancelled Google account selection",
                        "USER_CANCELLED"
                    )

                } catch (e: GetCredentialException) {
                    Log.w(
                        tag,
                        "Credential Manager failed, using fallback",
                        e
                    )

                    fallbackToGoogleAccountPicker()

                } catch (e: Exception) {
                    Log.e(
                        tag,
                        "Google sign-in failed, using fallback",
                        e
                    )

                    fallbackToGoogleAccountPicker()
                }
            }
        }
    }

    private fun handleCredentialResponse(
        response: GetCredentialResponse
    ) {
        val credential = response.credential

        if (
            credential is CustomCredential &&
            credential.type ==
            GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
            try {
                val googleIdToken =
                    GoogleIdTokenCredential.createFrom(
                        credential.data
                    )

                sendSuccessToWeb(
                    idToken = googleIdToken.idToken,
                    email = googleIdToken.id,
                    displayName =
                        googleIdToken.displayName
                            ?: googleIdToken.id.substringBefore("@"),
                    photoUrl =
                        googleIdToken.profilePictureUri
                            ?.toString()
                            ?: ""
                )

            } catch (e: Exception) {
                Log.e(
                    tag,
                    "Failed to parse Google credential",
                    e
                )

                fallbackToGoogleAccountPicker()
            }
        } else {
            fallbackToGoogleAccountPicker()
        }
    }

    private fun fallbackToGoogleAccountPicker() {
        try {
            val serverClientId =
                activity.getString(
                    R.string.default_web_client_id
                )

            val account =
                GoogleSignIn.getLastSignedInAccount(activity)

            if (
                account != null &&
                !account.email.isNullOrBlank() &&
                !account.idToken.isNullOrBlank()
            ) {
                sendSuccessToWeb(
                    idToken = account.idToken!!,
                    email = account.email!!,
                    displayName =
                        account.displayName
                            ?: account.givenName
                            ?: "Google User",
                    photoUrl =
                        account.photoUrl?.toString() ?: ""
                )

                return
            }

            val options =
                GoogleSignInOptions.Builder(
                    GoogleSignInOptions.DEFAULT_SIGN_IN
                )
                    .requestEmail()
                    .requestProfile()
                    .requestIdToken(serverClientId)
                    .build()

            val client =
                GoogleSignIn.getClient(
                    activity,
                    options
                )

            activity.startActivityForResult(
                client.signInIntent,
                GOOGLE_SIGN_IN_REQUEST_CODE
            )

        } catch (e: Exception) {
            Log.e(
                tag,
                "Fallback Google picker failed",
                e
            )

            sendErrorToWeb(
                "Could not start Google Sign-In",
                "UNAVAILABLE"
            )
        }
    }

    fun handleGoogleSignInResult(
        resultCode: Int,
        data: Intent?
    ) {
        if (resultCode != AppCompatActivity.RESULT_OK) {
            sendErrorToWeb(
                "Google Sign-In was cancelled",
                "USER_CANCELLED"
            )

            return
        }

        try {
            val account =
                GoogleSignIn.getSignedInAccountFromIntent(data)
                    .getResult(
                        com.google.android.gms.common.api.ApiException::class.java
                    )

            val idToken = account.idToken
            val email = account.email

            if (
                idToken.isNullOrBlank() ||
                email.isNullOrBlank()
            ) {
                sendErrorToWeb(
                    "Google did not return a valid account",
                    "INVALID_ACCOUNT"
                )

                return
            }

            sendSuccessToWeb(
                idToken = idToken,
                email = email,
                displayName =
                    account.displayName
                        ?: account.givenName
                        ?: "Google User",
                photoUrl =
                    account.photoUrl?.toString() ?: ""
            )

        } catch (e: Exception) {
            Log.e(
                tag,
                "Google Sign-In result failed",
                e
            )

            sendErrorToWeb(
                "Could not complete Google Sign-In",
                "SIGN_IN_FAILED"
            )
        }
    }

    private fun sendSuccessToWeb(
        idToken: String,
        email: String,
        displayName: String,
        photoUrl: String
    ) {
        val payload =
            JSONObject().apply {
                put("type", "NATIVE_GOOGLE_AUTH_SUCCESS")
                put("idToken", idToken)
                put("email", email)
                put("displayName", displayName)
                put("photoUrl", photoUrl)
            }.toString()

        val escaped = JSONObject.quote(payload)

        val js =
            """
            (function() {
                try {
                    var data = JSON.parse($escaped);

                    window.dispatchEvent(
                        new CustomEvent(
                            'onNativeGoogleSignInSuccess',
                            { detail: data }
                        )
                    );

                    if (window.onNativeGoogleSignInSuccess) {
                        window.onNativeGoogleSignInSuccess(data);
                    }
                } catch (err) {
                    console.error(err);
                }
            })();
            """.trimIndent()

        activity.runOnUiThread {
            webView.evaluateJavascript(js, null)
        }
    }

    private fun sendErrorToWeb(
        errorMessage: String,
        errorCode: String
    ) {
        val payload =
            JSONObject().apply {
                put("type", "NATIVE_GOOGLE_AUTH_ERROR")
                put("error", errorMessage)
                put("code", errorCode)
            }.toString()

        val escaped = JSONObject.quote(payload)

        val js =
            """
            (function() {
                try {
                    var data = JSON.parse($escaped);

                    window.dispatchEvent(
                        new CustomEvent(
                            'onNativeGoogleSignInError',
                            { detail: data }
                        )
                    );

                    if (window.onNativeGoogleSignInError) {
                        window.onNativeGoogleSignInError(data);
                    }
                } catch (err) {
                    console.error(err);
                }
            })();
            """.trimIndent()

        activity.runOnUiThread {
            webView.evaluateJavascript(js, null)
        }
    }

    companion object {
        const val GOOGLE_SIGN_IN_REQUEST_CODE = 9001
    }
}
