/** Projection is an output route, separate from the local input/camera session. */
export class HandsFreeProjection extends EventTarget {
  constructor({ bridge = null, camera = null, scope = globalThis } = {}) {
    super(); this.bridge = bridge; this.camera = camera; this.scope = scope; this.active = false; this.route = 'none';
  }
  async start() {
    if (!this.camera?.stream) throw new Error('Start the phone camera and hand tracker first.');
    if (!this.camera.worker || !this.camera.ready) throw new Error('Hand tracking is not ready yet.');
    this.scope.VivoPhoneProjection = { active: true, keepCameraAlive: true };
    if (this.bridge?.available) {
      try { const result = await this.bridge.invoke('phone.projection'); this.route = result?.route || 'android-os'; }
      catch (error) { this.scope.VivoPhoneProjection.active = false; this.scope.VivoPhoneProjection.keepCameraAlive = false; throw error; }
    } else if (typeof this.scope.PresentationRequest === 'function') {
      const request = new this.scope.PresentationRequest([this.scope.location.href]);
      await request.start(); this.route = 'browser-presentation';
    } else {
      this.scope.VivoPhoneProjection.active = false; this.scope.VivoPhoneProjection.keepCameraAlive = false;
      throw new Error('This browser has no presentation route. Use Android screen casting or mirror the display from system settings.');
    }
    this.active = true; this.emit('started'); return this.status();
  }
  stop() { this.active = false; this.scope.VivoPhoneProjection = { active: false, keepCameraAlive: false }; this.route = 'none'; this.emit('stopped'); }
  status() {
    const track = this.camera?.stream?.getVideoTracks?.()[0];
    return { active: this.active, route: this.route, cameraTrack: track?.readyState || 'unavailable', pageVisible: this.scope.document?.visibilityState === 'visible', framesUploaded: false };
  }
  emit(type) { this.dispatchEvent(new CustomEvent('change', { detail: { type, ...this.status() } })); }
}
