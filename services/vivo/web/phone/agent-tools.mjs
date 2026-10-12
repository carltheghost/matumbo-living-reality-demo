import { AGENT_CAPABILITIES } from './agent-control.mjs';

/** Agents see only tools whose exact capability names the user granted. */
export const TOOL_CATALOG = Object.freeze([
  { name: 'vivo.world.read', capability: 'world.read', description: 'Read the active local world snapshot.' },
  { name: 'vivo.world.edit', capability: 'world.edit', description: 'Move an object along a selected native axis.' },
  { name: 'vivo.eye.control', capability: 'world.eye', description: 'Change this participant’s Eye or projection.' },
  { name: 'phone.camera.start', capability: 'camera', description: 'Start camera capture after OS/browser permission.' },
  { name: 'phone.camera.stop', capability: 'camera', description: 'Stop camera capture and release the camera track.' },
  { name: 'phone.torch.set', capability: 'torch', description: 'Turn the rear phone torch on or off after explicit permission.' },
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
  constructor({ bridge = null, localCapabilities = [], agentController = null } = {}) {
    this.bridge = bridge;
    this.agentController = agentController;
    this.localCapabilities = new Set(localCapabilities.filter(name => AGENT_CAPABILITIES.includes(name)));
    this.nativeGrants = new Set();
    this.grants = new Set(this.localCapabilities);
    this.audit = [];
  }
  updateGrants(names) {
    this.nativeGrants = new Set(Array.isArray(names) ? names.filter(x => typeof x === 'string') : []);
    this.grants = new Set([...this.nativeGrants, ...this.localCapabilities]);
    // A native grant refresh updates capability visibility only. It never
    // re-enables a stopped local session; re-enable is an explicit action.
    return this.grants;
  }
  setLocalCapabilities(names) {
    this.localCapabilities = new Set(Array.isArray(names) ? names.filter(name => AGENT_CAPABILITIES.includes(name)) : []);
    this.grants = new Set([...this.nativeGrants, ...this.localCapabilities]);
    return this.agentController?.setGrantedCapabilities([...this.localCapabilities]) || Promise.resolve([]);
  }
  setAgentController(controller) {
    this.agentController = controller || null;
    this.agentController?.setGrantedCapabilities([...this.localCapabilities]);
    return this;
  }
  list() { return TOOL_CATALOG.filter(tool => this.grants.has(tool.capability) && (!tool.capability.startsWith('world.') || this.localCapabilities.has(tool.capability))).map(({ name, description }) => ({ name, description })); }
  listFor(session) {
    // Native tools remain globally visible to the connected Companion, but a
    // local world tool is visible only when this exact registered session
    // declared that capability.
    const visible = new Set(this.list().filter(tool => !tool.name.startsWith('vivo.')).map(tool => tool.name));
    if (this.agentController) for (const tool of TOOL_CATALOG) {
      if (!tool.capability.startsWith('world.') || !this.localCapabilities.has(tool.capability)) continue;
      try { this.agentController.assertActive(session); if (this.agentController.sessionCapabilities(session).includes(tool.capability)) visible.add(tool.name); } catch {}
    }
    return TOOL_CATALOG.filter(tool => visible.has(tool.name)).map(({ name, description }) => ({ name, description }));
  }
  registerAgent(spec = {}) {
    if (!this.agentController) throw new Error('Local agent control is unavailable');
    return this.agentController.register(spec);
  }
  stopAgent(session, reason = 'agent-stop') {
    if (!this.agentController) throw new Error('Local agent control is unavailable');
    return this.agentController.stop(session, reason);
  }
  reenableAgent(sourceOrSession) {
    if (!this.agentController) throw new Error('Local agent control is unavailable');
    return this.agentController.reenable(sourceOrSession);
  }
  beginContact(session, values) {
    if (!this.agentController) throw new Error('Local agent control is unavailable');
    return this.agentController.beginContact(session, values);
  }
  updateContact(session, contactId, values) {
    if (!this.agentController) throw new Error('Local agent control is unavailable');
    return this.agentController.updateContact(session, contactId, values);
  }
  endContact(session, contactId, reason) {
    if (!this.agentController) throw new Error('Local agent control is unavailable');
    return this.agentController.endContact(session, contactId, reason);
  }
  agents() { return this.agentController?.agents?.() || []; }
  async invokeFor(session, name, args = {}) {
    const tool = TOOL_CATALOG.find(item => item.name === name);
    if (!tool || !this.grants.has(tool.capability)) throw new Error('Tool is not granted to this agent');
    const startedAt = Date.now(); let result;
    try {
      if (tool.capability.startsWith('world.')) {
        if (!this.localCapabilities.has(tool.capability)) throw new Error('Local world capability is unavailable');
        if (!this.agentController) throw new Error('Local agent control is unavailable');
        this.agentController.assertActive(session);
        result = await this.bridge?.invokeLocal?.(name, args, { session });
      } else {
        this.agentController?.assertActive(session);
        if (!this.bridge?.available) throw new Error('Android Companion is not connected');
        result = await this.bridge.invoke(name, args);
      }
      this.audit.push({ name, sourceId: this.agentController?.sessionSource(session) || null, startedAt, finishedAt: Date.now(), outcome: 'accepted' });
      return result;
    } catch (error) {
      this.audit.push({ name, sourceId: this.agentController?.sessionSource(session) || null, startedAt, finishedAt: Date.now(), outcome: 'rejected', code: error?.code || null });
      throw error;
    }
  }
  async invoke(name, args = {}, context = {}) {
    const tool = TOOL_CATALOG.find(item => item.name === name);
    if (tool?.capability.startsWith('world.')) {
      const session = context?.session || context?.sessionId;
      if (!session) throw new Error('Registered local agent session required; agentId arguments are not accepted');
      return this.invokeFor(session, name, args);
    }
    const startedAt = Date.now();
    if (!tool || !this.grants.has(tool.capability)) throw new Error('Tool is not granted to this agent');
    try {
      if (!this.bridge?.available) throw new Error('Android Companion is not connected');
      const result = await this.bridge.invoke(name, args);
      this.audit.push({ name, sourceId: null, startedAt, finishedAt: Date.now(), outcome: 'accepted' });
      return result;
    } catch (error) {
      this.audit.push({ name, sourceId: null, startedAt, finishedAt: Date.now(), outcome: 'rejected', code: error?.code || null });
      throw error;
    }
  }
  async revokeAll() {
    this.grants.clear(); this.nativeGrants.clear(); this.localCapabilities.clear();
    const grantReset = this.agentController?.setGrantedCapabilities?.([]) || Promise.resolve([]);
    const stopped = this.agentController?.stopAll?.('grant-revoke-all') || [];
    this.audit.push({ name: 'registry.revoke-all', startedAt: Date.now(), finishedAt: Date.now(), outcome: 'accepted' });
    await grantReset;
    return stopped;
  }
}
