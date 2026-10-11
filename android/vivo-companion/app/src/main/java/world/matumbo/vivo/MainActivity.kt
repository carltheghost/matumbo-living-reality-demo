package world.matumbo.vivo

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity:Activity(){
 companion object{
   const val VIVO_ORIGIN="https://carltheghost.github.io"
   const val VIVO_URL="$VIVO_ORIGIN/matumbo-living-reality-demo/field-lab-studio.html"
   const val CAMERA_REQUEST=4102
 }
 private lateinit var web:WebView
 private lateinit var broker:ToolBroker
 private var pendingCamera:PermissionRequest?=null
 override fun onCreate(savedInstanceState:Bundle?){
   super.onCreate(savedInstanceState);val root=FrameLayout(this);web=WebView(this);root.addView(web,FrameLayout.LayoutParams(-1,-1))
   val status=TextView(this).apply{text="Vivo Companion · GitHub page + native phone tools";setTextColor(Color.WHITE);setBackgroundColor(Color.rgb(7,23,29));setPadding(14,6,14,6);textSize=10f};root.addView(status);setContentView(root)
   broker=ToolBroker(this);configure();web.addJavascriptInterface(VivoBridge(web,broker),"VivoAndroid")
   val requested=intent?.data?.toString();web.loadUrl(if(requested!=null&&requested.startsWith(VIVO_URL))requested else VIVO_URL)
 }
 private fun configure(){
   web.settings.apply{javaScriptEnabled=true;domStorageEnabled=true;allowFileAccess=false;allowContentAccess=false;setSupportMultipleWindows(false);mediaPlaybackRequiresUserGesture=true;mixedContentMode=android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW}
   WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
   web.webViewClient=object:WebViewClient(){
     override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean{val u=request.url;return if(u.scheme=="https"&&u.host=="carltheghost.github.io")false else{startActivity(Intent(Intent.ACTION_VIEW,u));true}}
     override fun onPageFinished(view:WebView,url:String){val caps=JSONObject.quote(broker.capabilities().toString());view.evaluateJavascript("window.dispatchEvent(new CustomEvent('vivo-native-ready',{detail:JSON.parse($caps)}));",null)}
   }
   web.webChromeClient=object:WebChromeClient(){
     override fun onPermissionRequest(request:PermissionRequest){
       val video=request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
       if(!video){request.deny();return}
       if(ContextCompat.checkSelfPermission(this@MainActivity,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
       else{pendingCamera=request;ActivityCompat.requestPermissions(this@MainActivity,arrayOf(Manifest.permission.CAMERA),CAMERA_REQUEST)}
     }
   }
 }
 override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,grantResults:IntArray){super.onRequestPermissionsResult(requestCode,permissions,grantResults);if(requestCode==CAMERA_REQUEST){val r=pendingCamera;pendingCamera=null;if(grantResults.firstOrNull()==PackageManager.PERMISSION_GRANTED)r?.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))else r?.deny()}}
 override fun onBackPressed(){if(web.canGoBack())web.goBack()else super.onBackPressed()}
}
