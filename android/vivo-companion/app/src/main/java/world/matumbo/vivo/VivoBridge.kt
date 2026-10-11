package world.matumbo.vivo
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
class VivoBridge(private val webView:WebView,private val broker:ToolBroker){
 @JavascriptInterface fun capabilities():String=broker.capabilities().toString()
 @JavascriptInterface fun request(raw:String){
   if(raw.toByteArray(Charsets.UTF_8).size>64*1024)return
   val r=try{JSONObject(raw)}catch(_:Exception){return};val id=r.optString("id");val tool=r.optString("tool");val args=r.optJSONObject("args")?:JSONObject()
   if(!ToolPolicy.validId(id)||ToolPolicy.rule(tool)==null){emit(JSONObject().put("id",id).put("ok",false).put("error","INVALID_REQUEST"));return}
   broker.execute(tool,args){result->result.put("id",id);emit(result)}
 }
 @JavascriptInterface fun auditLog():String=broker.auditLog().toString()
 private fun emit(result:JSONObject){val encoded=JSONObject.quote(result.toString());webView.post{webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('vivo-native-result',{detail:JSON.parse($encoded)}));",null)}}
}
