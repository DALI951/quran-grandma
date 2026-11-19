package com.dali951.quran;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends Activity {

    private static final String APP_HOST = "quran.local";
    private static final String APP_ORIGIN = "https://quran.local";
    private static final String START_URL = APP_ORIGIN + "/index.html";
    private static final String ASSET_PREFIX = "www/";
    private static final String UPDATE_API_URL =
        "https://api.github.com/repos/DALI951/quran-grandma/releases/latest";

    private FrameLayout rootContainer;
    private WebView web;
    private Object backCallbackApi33;
    private volatile boolean destroyed = false;
    private volatile boolean webLoadFailed = false;
    private final AtomicBoolean checkingUpdate = new AtomicBoolean(false);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        rootContainer = new FrameLayout(this);
        rootContainer.setBackgroundColor(0xFFF6F1E7);
        rootContainer.setFitsSystemWindows(true);
        setContentView(rootContainer);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            Api24ServiceWorkerHelper.install(this);
        }

        attachWebView();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallbackApi33 = Api33BackHelper.register(this);
        }

        if (web != null) {
            web.loadUrl(START_URL);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void attachWebView() {
        WebView w = new WebView(this);
        w.setBackgroundColor(0xFFF6F1E7);
        w.setFitsSystemWindows(true);
        w.setWebViewClient(createWebViewClient());

        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        w.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        web = w;
        rootContainer.addView(
            w,
            new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        );
    }

    private WebViewClient createWebViewClient() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return Api26WebViewClientFactory.create(this);
        }
        return new QuranWebViewClient();
    }

    void recoverFromRenderProcessGone(WebView deadView) {
        if (destroyed || isFinishing()) {
            return;
        }
        if (deadView != null && deadView == web) {
            if (rootContainer != null) {
                rootContainer.removeView(deadView);
            }
            try {
                deadView.removeJavascriptInterface("AndroidBridge");
                deadView.stopLoading();
                deadView.destroy();
            } catch (Exception ignored) {
            }
            web = null;
            attachWebView();
            if (web != null) {
                web.loadUrl(START_URL);
            }
        }
    }

    WebResourceResponse interceptLocalRequest(WebResourceRequest request) {
        if (request == null || request.getUrl() == null) {
            return null;
        }
        Uri uri = request.getUrl();
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (!"https".equalsIgnoreCase(scheme) || !APP_HOST.equalsIgnoreCase(host)) {
            return null;
        }

        String rawPath = uri.getPath();
        if (rawPath == null || rawPath.isEmpty() || "/".equals(rawPath)) {
            rawPath = "index.html";
        }
        while (rawPath.startsWith("/")) {
            rawPath = rawPath.substring(1);
        }
        if (rawPath.isEmpty()) {
            rawPath = "index.html";
        }

        String encodedPath = uri.getEncodedPath();
        if (rawPath.contains("..")
                || rawPath.contains("\\")
                || rawPath.indexOf('\0') >= 0
                || (encodedPath != null && encodedPath.toLowerCase(Locale.US).contains("%2e%2e"))) {
            return emptyResponse(403, "Forbidden", "text/plain", "utf-8");
        }

        String[] parts = rawPath.split("/", -1);
        for (int i = 0; i < parts.length; i++) {
            if (".".equals(parts[i]) || "..".equals(parts[i]) || parts[i].isEmpty()) {
                return emptyResponse(403, "Forbidden", "text/plain", "utf-8");
            }
        }

        String assetPath = ASSET_PREFIX + rawPath;
        InputStream stream;
        try {
            stream = getAssets().open(assetPath);
        } catch (IOException e) {
            return emptyResponse(404, "Not Found", "text/plain", "utf-8");
        }

        String lower = rawPath.toLowerCase(Locale.US);
        String mime = "application/octet-stream";
        String encoding = null;
        String contentType = mime;

        if (lower.endsWith(".html") || lower.endsWith(".htm")) {
            mime = "text/html";
            encoding = "utf-8";
            contentType = "text/html; charset=utf-8";
        } else if (lower.endsWith(".css")) {
            mime = "text/css";
            encoding = "utf-8";
            contentType = "text/css; charset=utf-8";
        } else if (lower.endsWith(".js")) {
            mime = "application/javascript";
            encoding = "utf-8";
            contentType = "application/javascript; charset=utf-8";
        } else if (lower.endsWith(".woff2")) {
            mime = "font/woff2";
            encoding = null;
            contentType = "font/woff2";
        } else if (lower.endsWith(".svg")) {
            mime = "image/svg+xml";
            encoding = "utf-8";
            contentType = "image/svg+xml";
        } else if (lower.endsWith(".png")) {
            mime = "image/png";
            encoding = null;
            contentType = "image/png";
        } else if (lower.endsWith(".webmanifest")) {
            mime = "application/manifest+json";
            encoding = "utf-8";
            contentType = "application/manifest+json";
        } else if (lower.endsWith(".json")) {
            mime = "application/json";
            encoding = "utf-8";
            contentType = "application/json";
        }

        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Content-Type", contentType);
        headers.put("Access-Control-Allow-Origin", APP_ORIGIN);
        headers.put("Cache-Control", "no-cache");

        return new WebResourceResponse(mime, encoding, 200, "OK", headers, stream);
    }

    private static WebResourceResponse emptyResponse(
            int statusCode, String reason, String mime, String encoding) {
        return new WebResourceResponse(
            mime,
            encoding,
            statusCode,
            reason,
            null,
            new ByteArrayInputStream(new byte[0])
        );
    }

    private boolean handleUrlLoading(String url) {
        if (url == null) {
            return true;
        }
        Uri uri = Uri.parse(url);
        if ("https".equalsIgnoreCase(uri.getScheme()) && APP_HOST.equalsIgnoreCase(uri.getHost())) {
            return false;
        }
        if (isAllowedExternalUrl(url)) {
            openAllowedUrl(url);
        }
        return true;
    }

    private static boolean isAllowedExternalUrl(String url) {
        if (url == null) {
            return false;
        }
        if (!(url.startsWith("https://github.com/DALI951/quran-grandma/")
                || url.startsWith("https://objects.githubusercontent.com/"))) {
            return false;
        }
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        String host = uri.getHost();
        return "https".equalsIgnoreCase(scheme)
            && ("github.com".equalsIgnoreCase(host)
                || "objects.githubusercontent.com".equalsIgnoreCase(host));
    }

    private void openAllowedUrl(final String url) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (destroyed || isFinishing()) {
                    return;
                }
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception ignored) {
                }
            }
        });
    }

    void handleBack() {
        if (destroyed || isFinishing()) {
            return;
        }
        if (web == null) {
            finish();
            return;
        }
        web.evaluateJavascript(
            "(function(){ return (window.App && window.App.back) ? !!window.App.back() : false; })()",
            new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if (destroyed || isFinishing()) {
                        return;
                    }
                    String val = value == null ? null : value.trim();
                    if ("false".equals(val) || (val == null && webLoadFailed)) {
                        MainActivity.this.finish();
                    }
                }
            }
        );
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onPause() {
        if (web != null) {
            web.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backCallbackApi33 != null) {
            Api33BackHelper.unregister(this, backCallbackApi33);
            backCallbackApi33 = null;
        }
        if (web != null) {
            WebView w = web;
            web = null;
            if (rootContainer != null) {
                rootContainer.removeView(w);
            }
            try {
                w.removeJavascriptInterface("AndroidBridge");
                w.stopLoading();
                w.setWebViewClient(new WebViewClient());
                w.removeAllViews();
                w.destroy();
            } catch (Exception ignored) {
            }
        }
        super.onDestroy();
    }

    private class QuranWebViewClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return interceptLocalRequest(request);
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrlLoading(url);
        }

        @TargetApi(24)
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            String url = (request != null && request.getUrl() != null)
                ? request.getUrl().toString()
                : null;
            return handleUrlLoading(url);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            if (url != null && url.startsWith(APP_ORIGIN)) {
                webLoadFailed = false;
            }
            super.onPageStarted(view, url, favicon);
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            if (failingUrl != null && failingUrl.startsWith(APP_ORIGIN)) {
                webLoadFailed = true;
            }
            super.onReceivedError(view, errorCode, description, failingUrl);
        }
    }

    @TargetApi(24)
    private static final class Api24ServiceWorkerHelper {
        static void install(final MainActivity activity) {
            try {
                ServiceWorkerController controller = ServiceWorkerController.getInstance();
                controller.setServiceWorkerClient(new ServiceWorkerClient() {
                    @Override
                    public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                        return activity.interceptLocalRequest(request);
                    }
                });
            } catch (Throwable ignored) {
            }
        }
    }

    @TargetApi(26)
    private static final class Api26WebViewClientFactory {
        static WebViewClient create(final MainActivity activity) {
            return activity.new QuranWebViewClient() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    activity.recoverFromRenderProcessGone(view);
                    return true;
                }
            };
        }
    }

    @TargetApi(33)
    private static final class Api33BackHelper {
        static Object register(final MainActivity activity) {
            OnBackInvokedCallback callback = new OnBackInvokedCallback() {
                @Override
                public void onBackInvoked() {
                    activity.handleBack();
                }
            };
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                callback
            );
            return callback;
        }

        static void unregister(Activity activity, Object callbackObj) {
            if (callbackObj instanceof OnBackInvokedCallback) {
                try {
                    activity.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(
                        (OnBackInvokedCallback) callbackObj
                    );
                } catch (Exception ignored) {
                }
            }
        }
    }

    @TargetApi(23)
    @SuppressWarnings("deprecation")
    private static void applyLightStatusBarApi23(View decor, boolean lightBarIcons) {
        int flags = decor.getSystemUiVisibility();
        if (lightBarIcons) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        } else {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        }
        decor.setSystemUiVisibility(flags);
    }

    private class AndroidBridge {
        @JavascriptInterface
        public void exit() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (!destroyed && !isFinishing()) {
                        MainActivity.this.finish();
                    }
                }
            });
        }

        @JavascriptInterface
        public void setKeepScreenOn(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (destroyed || isFinishing()) {
                        return;
                    }
                    if (on) {
                        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    } else {
                        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    }
                }
            });
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void setThemeColor(final String hex, final boolean lightBarIcons) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (destroyed || isFinishing() || hex == null) {
                        return;
                    }
                    try {
                        int color = Color.parseColor(hex);
                        getWindow().addFlags(
                            WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS
                        );
                        getWindow().setStatusBarColor(color);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            applyLightStatusBarApi23(getWindow().getDecorView(), lightBarIcons);
                        }
                    } catch (IllegalArgumentException ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void checkForUpdate() {
            if (!checkingUpdate.compareAndSet(false, true)) {
                return;
            }
            Thread worker = new Thread(new Runnable() {
                @Override
                public void run() {
                    String payload;
                    HttpURLConnection conn = null;
                    BufferedReader reader = null;
                    try {
                        URL url = new URL(UPDATE_API_URL);
                        conn = (HttpURLConnection) url.openConnection();
                        conn.setRequestMethod("GET");
                        conn.setConnectTimeout(5000);
                        conn.setReadTimeout(5000);
                        conn.setUseCaches(false);
                        conn.setInstanceFollowRedirects(true);
                        conn.setRequestProperty("User-Agent", "quran-grandma-android");
                        conn.setRequestProperty("Accept", "application/vnd.github+json");

                        int status = conn.getResponseCode();
                        if (status == HttpURLConnection.HTTP_OK) {
                            reader = new BufferedReader(
                                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8)
                            );
                            StringBuilder sb = new StringBuilder();
                            char[] buf = new char[2048];
                            int n;
                            while ((n = reader.read(buf)) != -1) {
                                sb.append(buf, 0, n);
                            }

                            JSONObject rel = new JSONObject(sb.toString());
                            String tagName = rel.optString("tag_name", "");
                            String version = tagName;
                            if (version.startsWith("v") || version.startsWith("V")) {
                                version = version.substring(1);
                            }
                            String body = rel.optString("body", "");
                            String htmlUrl = rel.optString("html_url", "");
                            String apkUrl = "";
                            JSONArray assets = rel.optJSONArray("assets");
                            if (assets != null) {
                                for (int i = 0; i < assets.length(); i++) {
                                    JSONObject asset = assets.optJSONObject(i);
                                    if (asset == null) {
                                        continue;
                                    }
                                    String dl = asset.optString("browser_download_url", "");
                                    String name = asset.optString("name", "");
                                    if (dl.toLowerCase(Locale.US).endsWith(".apk")
                                            || name.toLowerCase(Locale.US).endsWith(".apk")) {
                                        apkUrl = dl;
                                        break;
                                    }
                                }
                            }

                            JSONObject out = new JSONObject();
                            out.put("ok", true);
                            out.put("tag_name", tagName);
                            out.put("version", version);
                            out.put("body", body);
                            out.put("apk_url", apkUrl);
                            out.put("html_url", htmlUrl);
                            payload = out.toString();
                        } else {
                            JSONObject err = new JSONObject();
                            err.put("ok", false);
                            err.put("reason", "error");
                            err.put("status", status);
                            payload = err.toString();
                        }
                    } catch (IOException e) {
                        payload = "{\"ok\":false,\"reason\":\"offline\"}";
                    } catch (JSONException e) {
                        payload = "{\"ok\":false,\"reason\":\"error\"}";
                    } catch (Exception e) {
                        payload = "{\"ok\":false,\"reason\":\"error\"}";
                    } finally {
                        if (reader != null) {
                            try {
                                reader.close();
                            } catch (IOException ignored) {
                            }
                        }
                        if (conn != null) {
                            conn.disconnect();
                        }
                        checkingUpdate.set(false);
                    }

                    final String finalPayload = payload;
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (destroyed || isFinishing() || isDestroyed() || web == null) {
                                return;
                            }
                            web.evaluateJavascript(
                                "window.__onUpdateResult && window.__onUpdateResult("
                                    + JSONObject.quote(finalPayload) + ")",
                                null
                            );
                        }
                    });
                }
            }, "quran-update-check");
            worker.start();
        }

        @JavascriptInterface
        public void openExternalUrl(final String url) {
            if (isAllowedExternalUrl(url)) {
                openAllowedUrl(url);
            }
        }
    }
}
