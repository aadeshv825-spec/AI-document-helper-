# Add project specific ProGuard rules here.
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.aidocumenthelper.app.** { *; }
-keep class com.android.billingclient.api.** { *; }
