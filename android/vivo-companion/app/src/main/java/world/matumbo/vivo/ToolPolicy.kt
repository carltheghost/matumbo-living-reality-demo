package world.matumbo.vivo
enum class ToolRisk { READ, INTERACTIVE }
data class ToolRule(val name:String,val risk:ToolRisk)
object ToolPolicy {
    private val rules=listOf(
        ToolRule("device.info",ToolRisk.READ),
        ToolRule("haptics.pulse",ToolRisk.INTERACTIVE),
        ToolRule("display.brightness",ToolRisk.INTERACTIVE),
        ToolRule("display.keepAwake",ToolRisk.INTERACTIVE),
        ToolRule("media.volume",ToolRisk.INTERACTIVE),
        ToolRule("camera.torch",ToolRisk.INTERACTIVE),
        ToolRule("app.openUrl",ToolRisk.INTERACTIVE),
        ToolRule("app.shareText",ToolRisk.INTERACTIVE),
        ToolRule("app.openSettings",ToolRisk.INTERACTIVE),
        ToolRule("projection.openCastSettings",ToolRisk.INTERACTIVE)
    ).associateBy{it.name}
    fun rule(name:String)=rules[name]
    fun names()=rules.keys.sorted()
    fun validId(value:String)=value.length in 1..80&&value.all{it.isLetterOrDigit()||it in "._:-"}
}
