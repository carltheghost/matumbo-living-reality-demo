import { Renderer, embed } from '../render.js';
import { fieldTone } from './field-palette.mjs';

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const line = (ctx, a, b) => { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function visibleInSlice(renderer, entity) {
  if (renderer.overview) return true;
  return renderer.inSlice(entity);
}

function projectEntity(renderer, entity, geometry) {
  return renderer.project(embed(entity.q, geometry, entity.chart));
}

function drawIdleField(ctx, renderer) {
  const center = { x: renderer.w * 0.52, y: renderer.h * (renderer.w < 720 ? 0.35 : 0.5) };
  const samples = [
    { dx: -0.18, dy: -0.06, radius: 120, color: 'rgba(104, 163, 255, .20)' },
    { dx: 0.12, dy: 0.05, radius: 92, color: 'rgba(243, 155, 85, .17)' },
    { dx: 0.02, dy: 0.18, radius: 108, color: 'rgba(103, 224, 162, .16)' },
  ];
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (const sample of samples) {
    const x = center.x + renderer.w * sample.dx, y = center.y + renderer.h * sample.dy;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, sample.radius);
    gradient.addColorStop(0, sample.color);
    gradient.addColorStop(1, 'rgba(7, 15, 26, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.arc(x, y, sample.radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export class PhoneRenderer extends Renderer {
  constructor(canvas, overlay) {
    super(canvas, overlay);
    this.backend = 'Phone canvas / field projection';
    this._lastDraw = 0;
  }

  previewFor(id) {
    if (Array.isArray(this.localPreview)) return this.localPreview.find(item => item?.entityId === id) || null;
    return this.localPreview?.entityId === id ? this.localPreview : null;
  }

  displayEntity(entity) {
    const preview = this.previewFor(entity.id);
    if (!preview) return entity;
    const q = entity.q.map((value, index) => value + Number(preview.delta?.[index] || 0));
    const scale = Math.max(0.05, Math.min(20, Number(preview.geometry?.scale) || 1));
    return { ...entity, q, radius: entity.radius * scale, geometry: preview.geometry, localPreview: true };
  }

  project(position) {
    const point = super.project(position);
    // The mobile field dock occupies the lower part of the viewport. Keep the
    // spatial objects in the exposed canvas area while preserving hit testing.
    if (this.w < 720) point.y -= this.h * 0.15;
    return point;
  }

  drawGrid(ctx, grid) {
    if (!grid?.positions?.length) return;
    const points = grid.positions.map(position => this.project(position));
    this.gridPoints = points;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(113, 161, 204, .18)';
    for (const [from, to] of grid.edges || []) {
      const a = points[from], b = points[to];
      if (!a?.visible || !b?.visible) continue;
      ctx.beginPath(); line(ctx, a, b); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(139, 193, 236, .08)';
    for (const [a, b, c] of grid.faces || []) {
      const p = points[a], q = points[b], r = points[c];
      if (!p?.visible || !q?.visible || !r?.visible) continue;
      ctx.beginPath(); line(ctx, p, q); line(ctx, q, r); line(ctx, r, p); ctx.stroke();
    }
    ctx.restore();
  }

  drawAxes(ctx) {
    const origin = { x: this.w * 0.5, y: this.h * (this.w < 720 ? 0.41 : 0.56) };
    const axes = [
      { x: 52, y: 0, label: 'x1', color: '#6fa8ff' },
      { x: 0, y: -44, label: 'x2', color: '#67e0a2' },
      { x: -36, y: 30, label: 'x3', color: '#f39b55' },
    ];
    ctx.save();
    ctx.font = '10px ui-monospace, SFMono-Regular, monospace';
    ctx.lineWidth = 1;
    for (const axis of axes) {
      ctx.strokeStyle = axis.color; ctx.fillStyle = axis.color;
      ctx.globalAlpha = 0.72;
      ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(origin.x + axis.x, origin.y + axis.y); ctx.stroke();
      ctx.fillText(axis.label, origin.x + axis.x * 1.08, origin.y + axis.y * 1.08);
    }
    ctx.restore();
  }

  drawEntity(ctx, entity, point, geometry) {
    if (!point?.visible) return;
    const tone = fieldTone(entity);
    const visible = visibleInSlice(this, entity);
    const selected = entity.id === this.selected;
    const held = entity.id === this.held;
    const radius = Math.max(9, (visible ? this.sliceRadius(entity) : entity.radius) * point.k);
    const haloRadius = radius * (held ? 2.3 : selected ? 2.05 : 1.72);
    const alpha = visible ? 1 : 0.22;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, haloRadius);
    glow.addColorStop(0, tone.glow.replace('0.82', visible ? '0.54' : '0.16'));
    glow.addColorStop(0.42, tone.glow.replace('0.82', visible ? '0.17' : '0.06'));
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow; ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(point.x, point.y, haloRadius, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = tone.solid;
    ctx.beginPath(); ctx.arc(point.x, point.y, clamp(radius * 0.42, 5, 18), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = held ? '#f7d58c' : selected ? '#eff8ff' : tone.solid;
    ctx.lineWidth = held ? 2.5 : selected ? 2 : 1;
    ctx.setLineDash(visible ? [] : [4, 5]);
    ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(14, radius * 0.78) + (selected ? 7 : 4), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (entity.localPreview) {
      const angle = finite(entity.geometry?.rotation);
      const marker = Math.max(14, radius * 0.72);
      ctx.strokeStyle = '#fff0bd'; ctx.globalAlpha = 0.95; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(point.x - Math.cos(angle) * marker, point.y - Math.sin(angle) * marker);
      ctx.lineTo(point.x + Math.cos(angle) * marker, point.y + Math.sin(angle) * marker);
      ctx.stroke();
    }
    if (selected || held) {
      ctx.strokeStyle = tone.solid; ctx.globalAlpha = 0.62; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(19, radius * 1.2) + 9, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.font = selected ? '600 12px system-ui, sans-serif' : '11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = selected ? '#f4f7fb' : '#c8d7e8';
    ctx.fillText((entity.localPreview ? 'LOCAL PREVIEW · ' : held ? 'HELD · ' : '') + entity.name, point.x, point.y + Math.max(17, radius) + 12);
    if (selected) {
      ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
      ctx.fillStyle = tone.solid;
      ctx.fillText(tone.label.toUpperCase() + ' · ' + entity.q.slice(0, 3).map(value => finite(value).toFixed(1)).join(' / '), point.x, point.y + Math.max(17, radius) + 28);
    }
    ctx.restore();
    return { ...point, id: entity.id, interactive: visible, tone: tone.key };
  }

  draw(now) {
    this.resize();
    const dt = this._lastDraw ? now - this._lastDraw : 33;
    this._lastDraw = now;
    this.fps = 0.9 * this.fps + 0.1 * 1000 / Math.max(1, dt);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this.screen = [];
    this.gridPoints = [];
    const state = this.state;
    if (!state) {
      drawIdleField(ctx, this);
      this.drawAxes(ctx);
    } else {
      this.drawGrid(ctx, this.grid);
      this.drawAxes(ctx);
      const geometry = state.geometry || { kind: 'flat', R: 2, r: 1 };
      for (const source of Object.values(state.entities || {})) {
        const entity = this.displayEntity(source);
        const point = projectEntity(this, entity, geometry);
        const hit = this.drawEntity(ctx, entity, point, geometry);
        if (hit) this.screen.push(hit);
      }
      for (const participant of state.participants || []) {
        if (!participant.observer || participant.id === this.actor) continue;
        const point = projectEntity(this, participant.observer, geometry);
        if (!point?.visible || (!this.overview && !this.inSlice(participant.observer))) continue;
        ctx.save(); ctx.strokeStyle = '#f39b55'; ctx.globalAlpha = 0.78; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(point.x - 6, point.y); ctx.lineTo(point.x + 6, point.y); ctx.moveTo(point.x, point.y - 6); ctx.lineTo(point.x, point.y + 6); ctx.stroke();
        ctx.font = '10px system-ui, sans-serif'; ctx.fillStyle = '#f7c18d'; ctx.textAlign = 'left'; ctx.fillText(participant.name, point.x + 9, point.y - 5); ctx.restore();
      }
    }
    if (this.pointer) {
      ctx.save(); ctx.strokeStyle = '#e9f5ff'; ctx.globalAlpha = 0.75; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(this.pointer[0], this.pointer[1], 14, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (this.hand?.length) {
      ctx.save(); ctx.strokeStyle = '#b2d9ff'; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.5;
      for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]]) {
        const from = this.hand[a], to = this.hand[b]; if (!from || !to) continue;
        ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0], to[1]); ctx.stroke();
      }
      ctx.restore();
    }
  }
}

export { embed };
