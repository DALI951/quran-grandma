package com.dali951.quran;

import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(0xFFF6F1E7);
        web.setWebViewClient(new WebViewClient());

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setSupportZoom(false);

        // lets the page tell Android "please exit" from the surah list
        web.addJavascriptInterface(new JsBridge(), "AndroidBridge");
        web.loadUrl("file:///android_asset/www/index.html");

        setContentView(web);
    }

    private class JsBridge {
        @JavascriptInterface
        public void exit() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.finish();
                }
            });
        }
    }

    // Back = go to the surah list; only exit the app when already there
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && event.getRepeatCount() == 0) {
            web.evaluateJavascript(
                "(function(){ if (window.App && window.App.back) " +
                "  return String(window.App.back()); return 'true'; })();",
                new android.webkit.ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value == null || "true".equals(value.trim())) {
                            MainActivity.this.finish();
                        }
                    }
                });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}