package world.matumbo.vivo
import org.junit.Assert.*
import org.junit.Test
class ToolPolicyTest {
 @Test fun unknownToolsFailClosed(){assertNull(ToolPolicy.rule("shell.exec"))}
 @Test fun boundedIds(){assertTrue(ToolPolicy.validId("web.1:torch"));assertFalse(ToolPolicy.validId("bad id"));assertFalse(ToolPolicy.validId("x".repeat(81)))}
 @Test fun expectedToolsPresent(){assertNotNull(ToolPolicy.rule("projection.openCastSettings"));assertNotNull(ToolPolicy.rule("camera.torch"))}
}
