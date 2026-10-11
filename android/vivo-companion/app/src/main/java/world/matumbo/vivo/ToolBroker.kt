package world.matumbo.vivo

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.view.WindowManager
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.ArrayDeque

class ToolBroker(private val activity:Activity){
 private val approved=mutableSetOf<String>();private val audit=ArrayDeque<JSONObject>()
 fun capabilities()=JSONObject().apply{
   put("schema","vivo.android-capabilities/1");put("tools",JSONArray(ToolPolicy.names()))
   put("origin",MainActivity.VIVO_ORIGIN);put("genericShell",false);put("rootAccess",false);put("cameraFramesUploaded",false)
 }
 fun execute(tool:String,args:JSONObject,done:(JSONObject)->Unit){
   val rule=ToolPolicy.rule(tool)?:return done(error("UNKNOWN_TOOL"))
   if(rule.risk==ToolRisk.INTERACTIVE&&tool !in approved){
     activity.runOnUiThread{
       AlertDialog.Builder(activity).setTitle("Allow Vivo phone tool?")
         .setMessage("$tool may change a phone setting or open another Android surface. Allow it for this app session?")
         .setNegativeButton("Deny"){_,_->done(error("TOOL_DENIED"))}
         .setPositiveButton("Allow session"){_,_->approved+=tool;runTool(tool,args,done)}.show()
     };return
   }
   runTool(tool,args,done)
 }
 private fun runTool(tool:String,args:JSONObject,done:(JSONObject)->Unit){
   try{
     val value=when(tool){
       "device.info"->JSONObject().put("manufacturer",Build.MANUFACTURER).put("model",Build.MODEL).put("device",Build.DEVICE).put("sdk",Build.VERSION.SDK_INT).put("release",Build.VERSION.RELEASE)
       "haptics.pulse"->{val ms=args.optLong("ms",40).coerceIn(10,1000);activity.getSystemService(Vibrator::class.java).vibrate(VibrationEffect.createOneShot(ms,VibrationEffect.DEFAULT_AMPLITUDE));JSONObject().put("ms",ms)}
       "display.brightness"->{val value=args.optDouble("value",.6).coerceIn(.02,1.0).toFloat();activity.runOnUiThread{val p=activity.window.attributes;p.screenBrightness=value;activity.window.attributes=p};JSONObject().put("value",value)}
       "display.keepAwake"->{val enabled=args.optBoolean("enabled",true);activity.runOnUiThread{if(enabled)activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)};JSONObject().put("enabled",enabled)}
       "media.volume"->{val audio=activity.getSystemService(AudioManager::class.java);val max=audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);val value=(args.optDouble("value",.5).coerceIn(0.0,1.0)*max).toInt().coerceIn(0,max);audio.setStreamVolume(AudioManager.STREAM_MUSIC,value,0);JSONObject().put("value",value).put("max",max)}
       "camera.torch"->{
         val enabled=args.optBoolean("enabled",true)
         val manager=activity.getSystemService(CameraManager::class.java)
         val id=manager.cameraIdList.firstOrNull{cid->
           val c=manager.getCameraCharacteristics(cid)
           c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE)==true&&c.get(CameraCharacteristics.LENS_FACING)==CameraCharacteristics.LENS_FACING_BACK
         }?:throw IllegalStateException("NO_TORCH")
         manager.setTorchMode(id,enabled)
         JSONObject().put("enabled",enabled)
       }
       "app.openUrl"->{val uri=Uri.parse(args.getString("url"));require(uri.scheme=="https"||uri.scheme=="http"){"URL_SCHEME"};activity.startActivity(Intent(Intent.ACTION_VIEW,uri));JSONObject().put("opened",true)}
       "app.shareText"->{val text=args.getString("text").take(10000);activity.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply{type="text/plain";putExtra(Intent.EXTRA_TEXT,text)},"Share from Vivo"));JSONObject().put("shared",true)}
       "app.openSettings"->{activity.startActivity(Intent(Settings.ACTION_SETTINGS));JSONObject().put("opened",true)}
       "projection.openCastSettings"->{try{activity.startActivity(Intent("android.settings.CAST_SETTINGS"))}catch(_:Exception){activity.startActivity(Intent(Settings.ACTION_SETTINGS))};JSONObject().put("opened",true)}
       else->throw IllegalArgumentException("UNKNOWN_TOOL")
     };record(tool,"ok");done(JSONObject().put("ok",true).put("value",value))
   }catch(e:Throwable){record(tool,"error");done(error((e.message?:"TOOL_FAILED").uppercase().replace(Regex("[^A-Z0-9_]+"),"_").take(64)))}
 }
 private fun error(code:String)=JSONObject().put("ok",false).put("error",code)
 private fun record(tool:String,outcome:String){audit.addLast(JSONObject().put("at",Instant.now().toString()).put("tool",tool).put("outcome",outcome));while(audit.size>200)audit.removeFirst()}
 fun auditLog()=JSONArray(audit.toList())
}
