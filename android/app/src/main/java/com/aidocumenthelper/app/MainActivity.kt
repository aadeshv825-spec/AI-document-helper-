package com.aidocumenthelper.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
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

    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var currentCameraPhotoUri: Uri? = null

    private val appAssetUrl =
        "https://appassets.androidplatform.net/assets/public/index.html"

    private val requestPermissionLauncher =
        registerForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions()
        ) { permissions ->

            val cameraGranted =
                permissions[Manifest.permission.CAMERA] ?: false

            if (cameraGranted) {
                Log.d(tag, "Camera permission granted")
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
                            val count = data.clipData!!.itemCount

                            Array(count) { index ->
                                data.clipData!!.getItemAt(index).uri
                            }
                        }

                        data?.data != null -> {
                            arrayOf(data.data!!)
                        }

                        currentCameraPhotoUri != null -> {
                            arrayOf(currentCameraPhotoUri!!)
                        }

                        else -> null
                    }

                fileChooserCallback?.onReceiveValue(results)

            } else {
                fileChooserCallback?.onReceiveValue(null)
            }

            fileChooserCallback = null
            currentCameraPhotoUri = null
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE

        webView = WebView(this)

        setContentView(webView)

        checkAndRequestPermissions()

        setupWebView()

        setupBackHandler()

        webView.loadUrl(appAssetUrl)
    }

    private fun checkAndRequestPermissions() {

        val permissionsToRequest = mutableListOf<String>()

        if (
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.CAMERA
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            permissionsToRequest.add(
                Manifest.permission.CAMERA
            )
        }

        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {

            if (
                ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.READ_EXTERNAL_STORAGE
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                permissionsToRequest.add(
                    Manifest.permission.READ_EXTERNAL_STORAGE
                )
            }
        }

        if (permissionsToRequest.isNotEmpty()) {
            requestPermissionLauncher.launch(
                permissionsToRequest.toTypedArray()
            )
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {

        val settings = webView.settings

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
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        val customUserAgent =
            "${settings.userAgentString} AIDocumentHelperApp/1.0.0 (Android)"

        settings.userAgentString = customUserAgent

        val nativeBridge =
            NativeBridgeInterface(this)

        val playBillingBridge =
            PlayBillingManager(this, webView)

        val googleSignInBridge =
            GoogleSignInManager(this, webView)

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
                        request.grant(request.resources)
                    }
                }

                override fun onShowFileChooser(
                    view: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?
                ): Boolean {

                    fileChooserCallback?.onReceiveValue(null)

                    fileChooserCallback =
                        filePathCallback

                    launchSystemMediaPicker(
                        fileChooserParams
                    )

                    return true
                }

                override fun onConsoleMessage(
                    consoleMessage: ConsoleMessage?
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
                    WebViewAssetLoader.AssetsPathHandler(this)
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

                    val url = request.url

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

                            startActivity(intent)

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
        params: WebChromeClient.FileChooserParams?
    ) {

        val takePictureIntent =
            Intent(MediaStore.ACTION_IMAGE_CAPTURE)

        var photoFile: File? = null

        try {

            val timeStamp =
                SimpleDateFormat(
                    "yyyyMMdd_HHmmss",
                    Locale.getDefault()
                ).format(Date())

            val storageDir =
                getExternalFilesDir(
                    Environment.DIRECTORY_PICTURES
                )

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

        } catch (ex: Exception) {

            Log.e(
                tag,
                "Error creating camera photo file",
                ex
            )
        }

        val contentSelectionIntent =
            Intent(Intent.ACTION_GET_CONTENT).apply {

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
                arrayOf(takePictureIntent)
            } else {
                emptyArray()
            }

        val chooserIntent =
            Intent(Intent.ACTION_CHOOSER).apply {

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
            object : OnBackPressedCallback(true) {

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

                            if (webView.canGoBack()) {

                                webView.goBack()

                            } else {

                                isEnabled = false

                                onBackPressedDispatcher.onBackPressed()
                            }
                        }
                    }
                }
            }
        )
    }

    override fun onDestroy() {

        webView.destroy()

        super.onDestroy()
    }
}
