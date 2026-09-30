package com.aidocumenthelper.app

import android.app.Activity
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.android.billingclient.api.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PlayBillingManager(
    private val activity: Activity,
    private val webView: WebView
) : PurchasesUpdatedListener {

    private val tag = "PlayBillingManager"

    private var billingClient: BillingClient =
        BillingClient.newBuilder(activity)
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build()
            )
            .build()

    private var isConnected = false

    private val productDetailsMap =
        mutableMapOf<String, ProductDetails>()

    init {
        startConnection()
    }

    private fun startConnection() {
        billingClient.startConnection(
            object : BillingClientStateListener {

                override fun onBillingSetupFinished(
                    billingResult: BillingResult
                ) {
                    if (
                        billingResult.responseCode ==
                        BillingClient.BillingResponseCode.OK
                    ) {
                        isConnected = true

                        Log.d(
                            tag,
                            "BillingClient connected successfully"
                        )

                        querySubscriptionProducts()
                    } else {
                        isConnected = false

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
            }
        )
    }

    private fun querySubscriptionProducts() {

        val productList = listOf(

            QueryProductDetailsParams.Product
                .newBuilder()
                .setProductId("ai_doc_pro_monthly")
                .setProductType(
                    BillingClient.ProductType.SUBS
                )
                .build(),

            QueryProductDetailsParams.Product
                .newBuilder()
                .setProductId("ai_doc_pro_annual")
                .setProductType(
                    BillingClient.ProductType.SUBS
                )
                .build()
        )

        val params =
            QueryProductDetailsParams
                .newBuilder()
                .setProductList(productList)
                .build()

        billingClient.queryProductDetailsAsync(
            params
        ) { billingResult, queryProductDetailsResult ->

            if (
                billingResult.responseCode ==
                BillingClient.BillingResponseCode.OK
            ) {

                for (
                    details in
                    queryProductDetailsResult.productDetailsList
                ) {

                    productDetailsMap[
                        details.productId
                    ] = details

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

            val productDetails =
                productDetailsMap[sku]

            if (productDetails == null) {

                notifyWebError(
                    "Product details for $sku not found on Google Play."
                )

                return@runOnUiThread
            }

            val offerToken =
                productDetails
                    .subscriptionOfferDetails
                    ?.firstOrNull()
                    ?.offerToken

            if (offerToken == null) {

                notifyWebError(
                    "No active subscription offer found for $sku."
                )

                return@runOnUiThread
            }

            val productDetailsParams =
                BillingFlowParams
                    .ProductDetailsParams
                    .newBuilder()
                    .setProductDetails(
                        productDetails
                    )
                    .setOfferToken(
                        offerToken
                    )
                    .build()

            val flowParamsBuilder =
                BillingFlowParams
                    .newBuilder()
                    .setProductDetailsParamsList(
                        listOf(productDetailsParams)
                    )

            if (!accountId.isNullOrBlank()) {

                flowParamsBuilder
                    .setObfuscatedAccountId(
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

    /**
     * Queries active Google Play subscriptions.
     *
     * IMPORTANT:
     * queryPurchasesAsync() is asynchronous.
     * The previous implementation returned the JSON
     * before the callback completed, causing restore
     * purchases to receive an empty list.
     *
     * A CountDownLatch is used here so the JavaScript
     * bridge waits for the actual BillingClient result.
     */
    @JavascriptInterface
    fun queryPurchases(): String {

        if (!isConnected) {
            Log.w(
                tag,
                "queryPurchases called while BillingClient is disconnected"
            )

            return JSONArray().toString()
        }

        val resultJson = JSONArray()

        val latch = CountDownLatch(1)

        val params =
            QueryPurchasesParams
                .newBuilder()
                .setProductType(
                    BillingClient.ProductType.SUBS
                )
                .build()

        billingClient.queryPurchasesAsync(
            params
        ) { billingResult, purchases ->

            try {

                if (
                    billingResult.responseCode ==
                    BillingClient.BillingResponseCode.OK
                ) {

                    for (purchase in purchases) {

                        val item =
                            JSONObject()

                        item.put(
                            "orderId",
                            purchase.orderId ?: ""
                        )

                        item.put(
                            "purchaseToken",
                            purchase.purchaseToken
                        )

                        item.put(
                            "purchaseTime",
                            purchase.purchaseTime
                        )

                        item.put(
                            "purchaseState",
                            purchase.purchaseState
                        )

                        item.put(
                            "isAcknowledged",
                            purchase.isAcknowledged
                        )

                        val productsArray =
                            JSONArray()

                        purchase.products.forEach { product ->
                            productsArray.put(product)
                        }

                        item.put(
                            "products",
                            productsArray
                        )

                        resultJson.put(item)
                    }

                    Log.d(
                        tag,
                        "Found ${purchases.size} Google Play subscription purchase(s)"
                    )

                } else {

                    Log.e(
                        tag,
                        "Failed to query purchases: ${billingResult.debugMessage}"
                    )
                }

            } catch (error: Exception) {

                Log.e(
                    tag,
                    "Error processing Google Play purchases",
                    error
                )

            } finally {

                latch.countDown()
            }
        }

        try {

            val completed =
                latch.await(
                    10,
                    TimeUnit.SECONDS
                )

            if (!completed) {

                Log.e(
                    tag,
                    "Timed out waiting for Google Play purchase query"
                )

                return JSONArray().toString()
            }

        } catch (interrupted: InterruptedException) {

            Thread.currentThread().interrupt()

            Log.e(
                tag,
                "Google Play purchase query interrupted",
                interrupted
            )

            return JSONArray().toString()
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
