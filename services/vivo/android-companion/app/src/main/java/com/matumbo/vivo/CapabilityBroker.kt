package com.matumbo.vivo

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.content.ContextCompat

/** Applies the app's explicit grant list and Android runtime/device gates before tools are exposed. */
class CapabilityBroker(private val context: Context) {
    private val preferences get() = context.getSharedPreferences(VivoAccessibilityService.PREFS, Context.MODE_PRIVATE)

    fun requestedGrants(): Set<String> = preferences.getStringSet(VivoAccessibilityService.KEY_GRANTS, emptySet()).orEmpty().toSet()
    fun saveGrants(grants: Set<String>) { preferences.edit().putStringSet(VivoAccessibilityService.KEY_GRANTS, grants).apply() }

    fun effectiveGrants(accessibilityReady: Boolean): Set<String> {
        val result = requestedGrants().toMutableSet()
        val camera = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        if (!camera || !context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)) result.remove("camera")
        val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val hasTorch = runCatching {
            cameraManager.cameraIdList.any { id ->
                cameraManager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK &&
                    cameraManager.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
            }
        }.getOrDefault(false)
        if (!camera || !hasTorch) result.remove("torch")
        if (!runCatching { hasVibrator() }.getOrDefault(false)) result.remove("haptics")
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) result.remove("notifications")
        val hasOrientation = runCatching {
            (context.getSystemService(Context.SENSOR_SERVICE) as SensorManager).getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR) != null
        }.getOrDefault(false)
        if (!hasOrientation) result.remove("sensors")
        if (!accessibilityReady) result.remove("accessibility")
        return result
    }

    fun visibleTools(accessibilityReady: Boolean): List<NativeTool> = CapabilityPolicy.visibleTools(effectiveGrants(accessibilityReady), accessibilityReady)
    fun permits(name: String, accessibilityReady: Boolean): Boolean = CapabilityPolicy.permits(name, effectiveGrants(accessibilityReady), accessibilityReady)

    @Suppress("DEPRECATION")
    private fun hasVibrator(): Boolean = if (Build.VERSION.SDK_INT >= 31) {
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator.hasVibrator()
    } else {
        (context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).hasVibrator()
    }
}
