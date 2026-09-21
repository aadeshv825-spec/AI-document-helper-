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
import android.webkit.*
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : AppCompatActivity() {

    private val tag = "MainActivity"
    private lateinit var webView: WebView
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var currentCameraPhotoUri: Uri? = null

    // App URL - local bundled asset or fallback production URL
    private val localAssetUrl = "file:///android_asset/public/index.html"
    private var remoteUrl: String = ""

    private val requestPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
            val cameraGranted = permissions[Manifest.permission.CAMERA] ?: false
            if (cameraGranted) {
                Log.d(tag, "Camera permission granted")
            }
        }

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK) {
                val data = result.data
                val results: Array<Uri>? = when {
                    data?.clipData != null -> {
                        val count = data.clipData!!.itemCount
                        Array(count) { i -> data.clipData!!.getItemAt(i).uri }
                    }
                    data?.data != null -> arrayOf(data.data!!)
                    currentCameraPhotoUri != null -> arrayOf(currentCameraPhotoUri!!)
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

        // Setup Edge-to-Edge / Status bar
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )

        webView = WebView(this)
        setContentView(webView)

        checkAndRequestPermissions()
        setupWebView()
        setupBackHandler()

        // Read production web URL from resources if defined
        try {
            remoteUrl = getString(R.string.production_web_url)
        } catch (e: Exception) {
            Log.w(tag, "production_web_url string not found, using default local assets")
        }

        // Always load bundled local asset first to prevent white-screen on cold launch
        webView.loadUrl(localAssetUrl)
    }

    private fun checkAndRequestPermissions() {
        val permissionsToRequest = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.CAMERA)
        }
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
        }
        if (permissionsToRequest.isNotEmpty()) {
            requestPermissionLauncher.launch(permissionsToRequest.toTypedArray())
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.allowFileAccessFromFileURLs = true
        settings.allowUniversalAccessFromFileURLs = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // Append custom user agent marker so web layer easily detects native Android app
        val customUserAgent = "${settings.userAgentString} AIDocumentHelperApp/1.0.0 (Android)"
        settings.userAgentString = customUserAgent

        // Inject Native Bridges
        val nativeBridge = NativeBridgeInterface(this)
        val playBillingBridge = PlayBillingManager(this, webView)
        val googleSignInBridge = GoogleSignInManager(this, webView)

        webView.addJavascriptInterface(nativeBridge, "AndroidBridge")
        webView.addJavascriptInterface(playBillingBridge, "AndroidPlayBilling")
        webView.addJavascriptInterface(googleSignInBridge, "AndroidGoogleSignIn")

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                // Grant camera access to the document scanner
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
                fileChooserCallback = filePathCallback

                launchSystemMediaPicker(fileChooserParams)
                return true
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                Log.d("WebConsole", "[${consoleMessage?.messageLevel()}] ${consoleMessage?.message()}")
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                val host = url.host ?: ""

                // Handle external apps (e.g. mailto, tel, intent)
                if (url.scheme == "mailto" || url.scheme == "tel") {
                    val intent = Intent(Intent.ACTION_VIEW, url)
                    startActivity(intent)
                    return true
                }

                // Keep app navigation inside WebView
                return false
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                val failingUrl = request?.url?.toString() ?: ""
                Log.e(tag, "WebView error loading $failingUrl: ${error?.description}")

                // If remote network load failed and we aren't already on local assets, fallback to local bundled assets immediately
                if (request?.isForMainFrame == true && failingUrl.startsWith("http") && localAssetUrl.isNotEmpty()) {
                    Log.i(tag, "Failing over to local bundled assets: $localAssetUrl")
                    view?.loadUrl(localAssetUrl)
                }
            }
        }
    }

    private fun launchSystemMediaPicker(params: WebChromeClient.FileChooserParams?) {
        val takePictureIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        var photoFile: File? = null
        try {
            val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
            val storageDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES)
            photoFile = File.createTempFile("SCAN_${timeStamp}_", ".jpg", storageDir)
            currentCameraPhotoUri = FileProvider.getUriForFile(
                this,
                "${applicationContext.packageName}.fileprovider",
                photoFile
            )
            takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, currentCameraPhotoUri)
        } catch (ex: Exception) {
            Log.e(tag, "Error creating camera photo file", ex)
        }

        val contentSelectionIntent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf"))
        }

        val intentArray = if (photoFile != null) arrayOf(takePictureIntent) else emptyArray()
        val chooserIntent = Intent(Intent.ACTION_CHOOSER).apply {
            putExtra(Intent.EXTRA_INTENT, contentSelectionIntent)
            putExtra(Intent.EXTRA_TITLE, "Select Document or Capture Photo")
            putExtra(Intent.EXTRA_INITIAL_INTENTS, intentArray)
        }

        fileChooserLauncher.launch(chooserIntent)
    }

    private fun setupBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Dispatch event to web app to close any open modal/drawer or go back to Home
                webView.evaluateJavascript(
                    """
                    (function() {
                        var handled = false;
                        if (window.onAndroidBackPressed) {
                            handled = window.onAndroidBackPressed();
                        }
                        if (!handled) {
                            var event = new CustomEvent('androidBackButtonPressed', { cancelable: true });
                            window.dispatchEvent(event);
                            handled = event.defaultPrevented;
                        }
                        return handled;
                    })();
                    """.trimIndent()
                ) { result ->
                    val isHandledInWeb = result == "true"
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
        })
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
