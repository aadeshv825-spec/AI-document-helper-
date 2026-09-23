package com.aidocumenthelper.app

import android.app.Activity
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.android.billingclient.api.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class PlayBillingManager(
    private val activity: Activity,
    private val webView: WebView
) : PurchasesUpdatedListener {

    private val tag = "PlayBillingManager"

    private var billingClient: BillingClient = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts()
                .build()
        )
        .build()

    private var isConnected = false

    private val productDetailsMap = mutableMapOf<String, ProductDetails>()

    init {
        startConnection()
    }

    private fun startConnection() {
        billingClient.startConnection(object : BillingClientStateListener {

            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    isConnected = true
                    Log.d(tag, "BillingClient connected successfully")
                    querySubscriptionProducts()
                } else {
                    Log.e(
                        tag,
                        "BillingClient setup failed: ${billingResult.debugMessage}"
                    )
                }
            }

            override fun onBillingServiceDisconnected() {
                isConnected = false
                Log.w(
                    tag,
                    "BillingClient disconnected, will retry on next action"
                )
            }
        })
    }

    private fun querySubscriptionProducts() {

        val productList = listOf(

            QueryProductDetailsParams.Product.newBuilder()
                .setProductId("ai_doc_pro_monthly")
                .setProductType(BillingClient.ProductType.SUBS)
                .build(),

            QueryProductDetailsParams.Product.newBuilder()
                .setProductId("ai_doc_pro_annual")
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        )

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(productList)
            .build()

        billingClient.queryProductDetailsAsync(params) { billingResult, queryProductDetailsResult ->

            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {

                for (details in queryProductDetailsResult.productDetailsList) {

                    productDetailsMap[details.productId] = details

                    Log.d(
                        tag,
                        "Loaded product SKU: ${details.productId}"
                    )
                }

            } else {

                Log.e(
                    tag,
                    "Failed to query products: ${billingResult.debugMessage}"
                )
            }
        }
    }

    @JavascriptInterface
    fun isAvailable(): Boolean {
        return isConnected
    }

    @JavascriptInterface
    fun launchBillingFlow(
        sku: String,
        accountId: String? = null
    ) {

        activity.runOnUiThread {

            if (!isConnected) {

                startConnection()

                notifyWebError(
                    "Google Play Billing is reconnecting. Please try again in a moment."
                )

                return@runOnUiThread
            }

            val productDetails = productDetailsMap[sku]

            if (productDetails == null) {

                notifyWebError(
                    "Product details for $sku not found on Google Play."
                )

                return@runOnUiThread
            }

            val offerToken =
                productDetails.subscriptionOfferDetails
                    ?.firstOrNull()
                    ?.offerToken

            if (offerToken == null) {

                notifyWebError(
                    "No active subscription offer found for $sku."
                )

                return@runOnUiThread
            }

            val productDetailsParams =
                BillingFlowParams.ProductDetailsParams
                    .newBuilder()
                    .setProductDetails(productDetails)
                    .setOfferToken(offerToken)
                    .build()

            val flowParamsBuilder =
                BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(
                        listOf(productDetailsParams)
                    )

            if (!accountId.isNullOrBlank()) {

                flowParamsBuilder.setObfuscatedAccountId(
                    accountId
                )
            }

            val billingResult =
                billingClient.launchBillingFlow(
                    activity,
                    flowParamsBuilder.build()
                )

            if (
                billingResult.responseCode !=
                BillingClient.BillingResponseCode.OK
            ) {

                notifyWebError(
                    "Error launching Google Play: ${billingResult.debugMessage}"
                )
            }
        }
    }

    @JavascriptInterface
    fun queryPurchases(): String {

        val resultJson = JSONArray()

        if (!isConnected) {
            return resultJson.toString()
        }

        val params =
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build()

        billingClient.queryPurchasesAsync(params) {
                billingResult,
                purchases ->

            if (
                billingResult.responseCode ==
                BillingClient.BillingResponseCode.OK
            ) {

                for (p in purchases) {

                    val item = JSONObject()

                    item.put(
                        "orderId",
                        p.orderId
                    )

                    item.put(
                        "purchaseToken",
                        p.purchaseToken
                    )

                    item.put(
                        "purchaseTime",
                        p.purchaseTime
                    )

                    item.put(
                        "purchaseState",
                        p.purchaseState
                    )

                    val productsArray = JSONArray()

                    p.products.forEach {
                        productsArray.put(it)
                    }

                    item.put(
                        "products",
                        productsArray
                    )

                    resultJson.put(item)
                }
            }
        }

        return resultJson.toString()
    }

    override fun onPurchasesUpdated(
        billingResult: BillingResult,
        purchases: List<Purchase>?
    ) {

        if (
            billingResult.responseCode ==
            BillingClient.BillingResponseCode.OK &&
            purchases != null
        ) {

            for (purchase in purchases) {
                handlePurchase(purchase)
            }

        } else if (
            billingResult.responseCode ==
            BillingClient.BillingResponseCode.USER_CANCELED
        ) {

            notifyWebError(
                "Google Play purchase was cancelled."
            )

        } else {

            notifyWebError(
                "Google Play purchase error: ${billingResult.debugMessage}"
            )
        }
    }

    private fun handlePurchase(
        purchase: Purchase
    ) {

        if (
            purchase.purchaseState ==
            Purchase.PurchaseState.PURCHASED
        ) {

            if (!purchase.isAcknowledged) {

                val ackParams =
                    AcknowledgePurchaseParams
                        .newBuilder()
                        .setPurchaseToken(
                            purchase.purchaseToken
                        )
                        .build()

                billingClient.acknowledgePurchase(
                    ackParams
                ) { ackResult ->

                    Log.d(
                        tag,
                        "Purchase acknowledged: ${ackResult.responseCode}"
                    )
                }
            }

            val sku =
                purchase.products.firstOrNull()
                    ?: "ai_doc_pro_monthly"

            val payload =
                JSONObject().apply {

                    put(
                        "purchaseToken",
                        purchase.purchaseToken
                    )

                    put(
                        "orderId",
                        purchase.orderId ?: ""
                    )

                    put(
                        "sku",
                        sku
                    )

                    put(
                        "packageName",
                        activity.packageName
                    )
                }

            activity.runOnUiThread {

                val script =
                    "if (window.onGooglePlayPurchaseCompleted) { " +
                    "window.onGooglePlayPurchaseCompleted($payload); }"

                webView.evaluateJavascript(
                    script,
                    null
                )
            }
        }
    }

    private fun notifyWebError(
        msg: String
    ) {

        activity.runOnUiThread {

            val escaped =
                JSONObject.quote(msg)

            val script =
                "if (window.onGooglePlayPurchaseError) { " +
                "window.onGooglePlayPurchaseError($escaped); }"

            webView.evaluateJavascript(
                script,
                null
            )
        }
    }
}
