package com.aidocumenthelper.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private val tag = "MainActivity"

    private lateinit var webView: WebView
    private lateinit var googleSignInBridge: GoogleSignInManager

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var currentCameraPhotoUri: Uri? = null

    private var pendingWebPermissionRequest: PermissionRequest? = null

    private val appAssetUrl =
        "https://appassets.androidplatform.net/assets/public/index.html"

    private val requestPermissionLauncher =
        registerForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions()
        ) { permissions ->

            val cameraGranted =
                permissions[Manifest.permission.CAMERA] ?: false

            val pendingRequest =
                pendingWebPermissionRequest

            pendingWebPermissionRequest = null

            if (
                cameraGranted &&
                pendingRequest != null &&
                !isFinishing &&
                !isDestroyed
            ) {
                try {
                    val requestedResources =
                        pendingRequest.resources.toSet()

                    val allowedResources =
                        requestedResources.intersect(
                            setOf(
                                PermissionRequest.RESOURCE_VIDEO_CAPTURE
                            )
                        )

                    if (
                        allowedResources.isNotEmpty() &&
                        ContextCompat.checkSelfPermission(
                            this,
                            Manifest.permission.CAMERA
                        ) == PackageManager.PERMISSION_GRANTED
                    ) {
                        pendingRequest.grant(
                            allowedResources.toTypedArray()
                        )

                        Log.d(
                            tag,
                            "Granted WebView camera permission"
                        )
                    } else {
                        pendingRequest.deny()

                        Log.w(
                            tag,
                            "Denied unsupported WebView permission request"
                        )
                    }
                } catch (e: Exception) {
                    Log.e(
                        tag,
                        "Failed to resolve WebView permission request",
                        e
                    )

                    try {
                        pendingRequest.deny()
                    } catch (_: Exception) {
                    }
                }
            } else if (pendingRequest != null) {
                try {
                    pendingRequest.deny()
                } catch (_: Exception) {
                }
            }

            if (cameraGranted) {
                Log.d(
                    tag,
                    "Camera permission granted"
                )
            }
        }

    private val fileChooserLauncher =
        registerForActivityResult(
            ActivityResultContracts.StartActivityForResult()
        ) { result ->

            if (result.resultCode == Activity.RESULT_OK) {

                val data = result.data

                val results: Array<Uri>? =
                    when {

                        data?.clipData != null -> {
                            val clipData =
                                data.clipData!!

                            val count =
                                clipData.itemCount

                            Array(count) { index ->
                                clipData
                                    .getItemAt(index)
                                    .uri
                            }
                        }

                        data?.data != null -> {
                            arrayOf(
                                data.data!!
                            )
                        }

                        currentCameraPhotoUri != null -> {
                            arrayOf(
                                currentCameraPhotoUri!!
                            )
                        }

                        else -> {
                            null
                        }
                    }

                fileChooserCallback?.onReceiveValue(
                    results
                )

            } else {
                fileChooserCallback?.onReceiveValue(
                    null
                )
            }

            fileChooserCallback = null
            currentCameraPhotoUri = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(
        savedInstanceState: Bundle?
    ) {
        super.onCreate(
            savedInstanceState
        )

        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE

        webView = WebView(this)

        setContentView(webView)

        checkAndRequestCameraPermission()

        setupWebView()

        setupBackHandler()

        webView.loadUrl(
            appAssetUrl
        )
    }

    private fun checkAndRequestCameraPermission() {

        if (
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.CAMERA
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissionLauncher.launch(
                arrayOf(
                    Manifest.permission.CAMERA
                )
            )
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {

        val settings =
            webView.settings

        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true

        settings.allowFileAccess = false
        settings.allowContentAccess = true

        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false

        settings.mediaPlaybackRequiresUserGesture = false

        settings.mixedContentMode =
            WebSettings.MIXED_CONTENT_NEVER_ALLOW

        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.cacheMode =
            WebSettings.LOAD_DEFAULT

        val customUserAgent =
            "${settings.userAgentString} AIDocumentHelperApp/1.0.0 (Android)"

        settings.userAgentString =
            customUserAgent

        val nativeBridge =
            NativeBridgeInterface(this)

        val playBillingBridge =
            PlayBillingManager(
                this,
                webView
            )

        googleSignInBridge =
            GoogleSignInManager(
                this,
                webView
            )

        webView.addJavascriptInterface(
            nativeBridge,
            "AndroidBridge"
        )

        webView.addJavascriptInterface(
            playBillingBridge,
            "AndroidPlayBilling"
        )

        webView.addJavascriptInterface(
            googleSignInBridge,
            "AndroidGoogleSignIn"
        )

        webView.webChromeClient =
            object : WebChromeClient() {

                override fun onPermissionRequest(
                    request: PermissionRequest
                ) {
                    runOnUiThread {

                        if (
                            isFinishing ||
                            isDestroyed
                        ) {
                            try {
                                request.deny()
                            } catch (_: Exception) {
                            }

                            return@runOnUiThread
                        }

                        val requestedResources =
                            request.resources.toSet()

                        val cameraRequested =
                            requestedResources.contains(
                                PermissionRequest.RESOURCE_VIDEO_CAPTURE
                            )

                        val unsupportedRequested =
                            requestedResources.any {
                                it !=
                                    PermissionRequest.RESOURCE_VIDEO_CAPTURE
                            }

                        if (
                            !cameraRequested ||
                            unsupportedRequested
                        ) {
                            Log.w(
                                tag,
                                "Denied unsupported WebView permission request: ${requestedResources.joinToString()}"
                            )

                            try {
                                request.deny()
                            } catch (_: Exception) {
                            }

                            return@runOnUiThread
                        }

                        val cameraGranted =
                            ContextCompat.checkSelfPermission(
                                this@MainActivity,
                                Manifest.permission.CAMERA
                            ) == PackageManager.PERMISSION_GRANTED

                        if (cameraGranted) {

                            try {
                                request.grant(
                                    arrayOf(
                                        PermissionRequest.RESOURCE_VIDEO_CAPTURE
                                    )
                                )

                                Log.d(
                                    tag,
                                    "Granted WebView camera permission"
                                )
                            } catch (e: Exception) {
                                Log.e(
                                    tag,
                                    "Failed to grant WebView camera permission",
                                    e
                                )

                                try {
                                    request.deny()
                                } catch (_: Exception) {
                                }
                            }

                        } else {

                            pendingWebPermissionRequest =
                                request

                            requestPermissionLauncher.launch(
                                arrayOf(
                                    Manifest.permission.CAMERA
                                )
                            )
                        }
                    }
                }

                override fun onPermissionRequestCanceled(
                    request: PermissionRequest
                ) {
                    if (
                        pendingWebPermissionRequest ===
                            request
                    ) {
                        pendingWebPermissionRequest =
                            null
                    }

                    super.onPermissionRequestCanceled(
                        request
                    )
                }

                override fun onShowFileChooser(
                    view: WebView?,
                    filePathCallback:
                        ValueCallback<Array<Uri>>?,
                    fileChooserParams:
                        FileChooserParams?
                ): Boolean {

                    fileChooserCallback?.onReceiveValue(
                        null
                    )

                    fileChooserCallback =
                        filePathCallback

                    launchSystemMediaPicker(
                        fileChooserParams
                    )

                    return true
                }

                override fun onConsoleMessage(
                    consoleMessage:
                        ConsoleMessage?
                ): Boolean {

                    Log.d(
                        "WebConsole",
                        "[${consoleMessage?.messageLevel()}] ${consoleMessage?.message()}"
                    )

                    return true
                }
            }

        val assetLoader =
            WebViewAssetLoader.Builder()
                .addPathHandler(
                    "/assets/",
                    WebViewAssetLoader.AssetsPathHandler(
                        this
                    )
                )
                .build()

        webView.webViewClient =
            object : WebViewClient() {

                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {

                    if (request == null) {
                        return null
                    }

                    return assetLoader.shouldInterceptRequest(
                        request.url
                    )
                }

                override fun shouldInterceptRequest(
                    view: WebView?,
                    url: String?
                ): WebResourceResponse? {

                    if (url == null) {
                        return null
                    }

                    return assetLoader.shouldInterceptRequest(
                        Uri.parse(url)
                    )
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {

                    if (request == null) {
                        return false
                    }

                    val url =
                        request.url

                    if (
                        url.scheme == "mailto" ||
                        url.scheme == "tel"
                    ) {

                        try {

                            val intent =
                                Intent(
                                    Intent.ACTION_VIEW,
                                    url
                                )

                            startActivity(
                                intent
                            )

                        } catch (e: Exception) {

                            Log.e(
                                tag,
                                "Unable to open external URL",
                                e
                            )
                        }

                        return true
                    }

                    return false
                }
            }
    }

    private fun launchSystemMediaPicker(
        params:
            WebChromeClient.FileChooserParams?
    ) {

        val takePictureIntent =
            Intent(
                MediaStore.ACTION_IMAGE_CAPTURE
            )

        var photoFile: File? = null

        try {

            val timeStamp =
                SimpleDateFormat(
                    "yyyyMMdd_HHmmss",
                    Locale.getDefault()
                ).format(
                    Date()
                )

            val storageDir =
                getExternalFilesDir(
                    Environment.DIRECTORY_PICTURES
                )

            if (storageDir != null) {

                photoFile =
                    File.createTempFile(
                        "SCAN_${timeStamp}_",
                        ".jpg",
                        storageDir
                    )

                currentCameraPhotoUri =
                    FileProvider.getUriForFile(
                        this,
                        "${applicationContext.packageName}.fileprovider",
                        photoFile
                    )

                takePictureIntent.putExtra(
                    MediaStore.EXTRA_OUTPUT,
                    currentCameraPhotoUri
                )

                takePictureIntent.addFlags(
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            }

        } catch (ex: Exception) {

            Log.e(
                tag,
                "Error creating camera photo file",
                ex
            )

            photoFile = null
            currentCameraPhotoUri = null
        }

        val contentSelectionIntent =
            Intent(
                Intent.ACTION_GET_CONTENT
            ).apply {

                addCategory(
                    Intent.CATEGORY_OPENABLE
                )

                type = "*/*"

                putExtra(
                    Intent.EXTRA_MIME_TYPES,
                    arrayOf(
                        "image/*",
                        "application/pdf"
                    )
                )
            }

        val intentArray =
            if (photoFile != null) {
                arrayOf(
                    takePictureIntent
                )
            } else {
                emptyArray()
            }

        val chooserIntent =
            Intent(
                Intent.ACTION_CHOOSER
            ).apply {

                putExtra(
                    Intent.EXTRA_INTENT,
                    contentSelectionIntent
                )

                putExtra(
                    Intent.EXTRA_TITLE,
                    "Select Document or Capture Photo"
                )

                putExtra(
                    Intent.EXTRA_INITIAL_INTENTS,
                    intentArray
                )
            }

        fileChooserLauncher.launch(
            chooserIntent
        )
    }

    private fun setupBackHandler() {

        onBackPressedDispatcher.addCallback(
            this,
            object :
                OnBackPressedCallback(true) {

                override fun handleOnBackPressed() {

                    webView.evaluateJavascript(
                        """
                        (function() {
                            var handled = false;

                            if (window.onAndroidBackPressed) {
                                handled = window.onAndroidBackPressed();
                            }

                            if (!handled) {
                                var event = new CustomEvent(
                                    'androidBackButtonPressed',
                                    { cancelable: true }
                                );

                                window.dispatchEvent(event);

                                handled = event.defaultPrevented;
                            }

                            return handled;
                        })();
                        """.trimIndent()
                    ) { result ->

                        val isHandledInWeb =
                            result == "true"

                        if (!isHandledInWeb) {

                            if (
                                webView.canGoBack()
                            ) {

                                webView.goBack()

                            } else {

                                isEnabled =
                                    false

                                onBackPressedDispatcher
                                    .onBackPressed()
                            }
                        }
                    }
                }
            }
        )
    }

    override fun onActivityResult(
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
        super.onActivityResult(
            requestCode,
            resultCode,
            data
        )

        if (
            requestCode ==
                GoogleSignInManager.GOOGLE_SIGN_IN_REQUEST_CODE
        ) {
            googleSignInBridge
                .handleGoogleSignInResult(
                    resultCode,
                    data
                )
        }
    }

    override fun onDestroy() {

        pendingWebPermissionRequest?.let {
            try {
                it.deny()
            } catch (_: Exception) {
            }
        }

        pendingWebPermissionRequest = null

        fileChooserCallback?.onReceiveValue(
            null
        )

        fileChooserCallback = null
        currentCameraPhotoUri = null

        webView.destroy()

        super.onDestroy()
    }
}
