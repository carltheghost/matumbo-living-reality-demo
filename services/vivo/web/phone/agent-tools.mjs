/** Agents see only tools whose exact capability names the user granted. */
export const TOOL_CATALOG = Object.freeze([
  { name: 'vivo.world.read', capability: 'world.read', description: 'Read the active local world snapshot.' },
  { name: 'vivo.world.edit', capability: 'world.edit', description: 'Move an object along a selected native axis.' },
  { name: 'vivo.eye.control', capability: 'world.eye', description: 'Change this participant’s Eye or projection.' },
  { name: 'phone.camera.start', capability: 'camera', description: 'Start camera capture after OS/browser permission.' },
  { name: 'phone.camera.stop', capability: 'camera', description: 'Stop camera capture and release the camera track.' },
  { name: 'phone.haptics', capability: 'haptics', description: 'Trigger a short haptic confirmation.' },
  { name: 'phone.brightness', capability: 'brightness', description: 'Adjust app-window brightness.' },
  { name: 'phone.volume', capability: 'volume', description: 'Adjust media volume.' },
  { name: 'phone.clipboard.write', capability: 'clipboard.write', description: 'Copy text to the phone clipboard.' },
  { name: 'phone.share', capability: 'share', description: 'Open the Android share sheet.' },
  { name: 'phone.notifications', capability: 'notifications', description: 'Post an explicit Vivo notification.' },
  { name: 'phone.files.open', capability: 'files', description: 'Open a user-selected document.' },
  { name: 'phone.projection', capability: 'projection', description: 'Request the OS screen projection flow.' },
  { name: 'phone.sensors.orientation', capability: 'sensors', description: 'Read orientation while the tool is active.' },
  { name: 'phone.accessibility.tap', capability: 'accessibility', description: 'Tap a point in the active app.' },
  { name: 'phone.accessibility.scroll', capability: 'accessibility', description: 'Scroll the active app.' },
  { name: 'phone.accessibility.text', capability: 'accessibility', description: 'Enter text only into a non-password field.' },
  { name: 'phone.navigation', capability: 'accessibility', description: 'Use Android back, home, or recents actions.' },
]);

export class AgentToolRegistry {
  constructor({ bridge = null, localCapabilities = [] } = {}) { this.bridge = bridge; this.localCapabilities = new Set(localCapabilities); this.grants = new Set(); this.audit = []; }
  updateGrants(names) { this.grants = new Set(Array.isArray(names) ? names.filter(x => typeof x === 'string') : []); }
  setLocalCapabilities(names) { this.localCapabilities = new Set(Array.isArray(names) ? names.filter(x => typeof x === 'string') : []); }
  list() { return TOOL_CATALOG.filter(tool => this.grants.has(tool.capability) && (!tool.capability.startsWith('world.') || this.localCapabilities.has(tool.capability))).map(({ name, description }) => ({ name, description })); }
  async invoke(name, args = {}) {
    const tool = TOOL_CATALOG.find(item => item.name === name);
    if (!tool || !this.grants.has(tool.capability)) throw new Error('Tool is not granted to this agent');
    const startedAt = Date.now(); let result;
    try {
      if (tool.capability.startsWith('world.')) {
        if (!this.localCapabilities.has(tool.capability)) throw new Error('Local world capability is unavailable');
        result = await this.bridge?.invokeLocal?.(name, args);
      } else {
        if (!this.bridge?.available) throw new Error('Android Companion is not connected');
        result = await this.bridge.invoke(name, args);
      }
      this.audit.push({ name, startedAt, finishedAt: Date.now(), outcome: 'accepted' });
      return result;
    } catch (error) {
      this.audit.push({ name, startedAt, finishedAt: Date.now(), outcome: 'rejected' });
      throw error;
    }
  }
  revokeAll() { this.grants.clear(); this.audit.push({ name: 'registry.revoke-all', startedAt: Date.now(), finishedAt: Date.now(), outcome: 'accepted' }); }
}
