import { Renderer, embed } from '../render.js';
import { fieldTone } from './field-palette.mjs';

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const line = (ctx, a, b) => { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const COMPANION_OCCUPANTS = Object.freeze({
  relic: Object.freeze({ color: '#79adff', accent: '#c5dcff', kind: 'sentinel' }),
  workpiece: Object.freeze({ color: '#f3a35b', accent: '#ffd2a8', kind: 'maker' }),
  portal: Object.freeze({ color: '#66dfad', accent: '#c4f9de', kind: 'wayfinder' }),
});

function visibleInSlice(renderer, entity) {
  if (renderer.overview) return true;
  return renderer.inSlice(entity);
}

function projectEntity(renderer, entity, geometry) {
  return renderer.project(embed(entity.q, geometry, entity.chart));
}

function roundedPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawSentinelFace(ctx, size, style) {
  ctx.fillStyle = style.accent;
  ctx.beginPath();
  ctx.arc(0, -size * .22, size * .24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#071321';
  ctx.beginPath(); ctx.ellipse(-size * .09, -size * .23, size * .035, size * .06, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(size * .09, -size * .23, size * .035, size * .06, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#071321';
  ctx.beginPath(); ctx.arc(0, -size * .12, size * .08, 0, Math.PI); ctx.stroke();
}

function drawMakerFace(ctx, size, style) {
  // A dark inset panel keeps the orange workpiece readable at small sizes and
  // follows the block-like roster avatar instead of becoming a second head.
  roundedPath(ctx, -size * .2, size * .08, size * .42, size * .2, size * .035);
  ctx.fillStyle = 'rgba(7, 19, 33, .78)';
  ctx.fill();
  ctx.strokeStyle = `${style.accent}cc`;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = style.accent;
  ctx.beginPath(); ctx.arc(-size * .09, size * .15, size * .028, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(size * .09, size * .15, size * .028, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = style.accent;
  ctx.beginPath(); ctx.moveTo(-size * .08, size * .22); ctx.lineTo(size * .08, size * .22); ctx.stroke();
}

function drawWayfinderFace(ctx, size, style) {
  // The inner world is a doorway first. Its readable dark opening replaces the
  // generic floating head while retaining a small expressive signal inside.
  ctx.beginPath();
  ctx.arc(0, size * .08, size * .27, Math.PI, 0);
  ctx.lineTo(size * .27, size * .4);
  ctx.lineTo(-size * .27, size * .4);
  ctx.closePath();
  ctx.fillStyle = 'rgba(7, 27, 34, .82)';
  ctx.fill();
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = style.accent;
  ctx.beginPath(); ctx.arc(-size * .085, size * .14, size * .025, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(size * .085, size * .14, size * .025, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = style.accent;
  ctx.beginPath(); ctx.arc(0, size * .22, size * .07, 0, Math.PI); ctx.stroke();
}

function drawCompanionOccupant(ctx, entity, point, radius, { selected = false, held = false, companionFocus = false, companionWorldView = false } = {}) {
  const style = COMPANION_OCCUPANTS[entity.id];
  if (!style || (!selected && !held)) return 0;
  const size = clamp(radius * (selected ? (companionFocus ? 4.2 : 3.3) : 1.85), selected ? (companionFocus ? 64 : 46) : 28, selected ? (companionFocus ? 84 : 68) : 44);
  const lift = size * .24;
  const presentationView = companionFocus || companionWorldView;
  ctx.save();
  ctx.translate(point.x, point.y - lift);
  ctx.globalCompositeOperation = presentationView ? 'source-over' : 'screen';
  ctx.globalAlpha = selected ? (companionFocus ? .94 : .9) : .82;
  ctx.shadowColor = style.color;
  ctx.shadowBlur = selected ? (presentationView ? 4 : 9) : 6;
  ctx.fillStyle = style.color;
  ctx.strokeStyle = style.accent;
  ctx.lineWidth = selected ? 1.7 : 1.2;

  ctx.beginPath();
  ctx.ellipse(0, size * .58, size * .48, size * .11, -.08, 0, Math.PI * 2);
  ctx.fillStyle = `${style.color}66`;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, size * .48);
  ctx.lineTo(0, size * .68);
  ctx.strokeStyle = `${style.accent}aa`;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = style.color;
  ctx.strokeStyle = style.accent;
  if (style.kind === 'wayfinder') {
    ctx.beginPath();
    ctx.arc(0, size * .04, size * .38, Math.PI, 0);
    ctx.lineTo(size * .38, size * .44);
    ctx.lineTo(-size * .38, size * .44);
    ctx.closePath();
    ctx.globalAlpha = selected ? (companionFocus ? .9 : .86) : .65;
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = selected ? (companionFocus ? .94 : .9) : .82;
    drawWayfinderFace(ctx, size, style);
  } else if (style.kind === 'maker') {
    // The maker is a material block first, with a small expressive face —
    // keep the orange identity legible beside the CSS roster avatar.
    ctx.beginPath();
    ctx.moveTo(-size * .42, size * .02);
    ctx.lineTo(size * .32, -size * .1);
    ctx.lineTo(size * .42, size * .42);
    ctx.lineTo(-size * .34, size * .5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = selected ? .56 : .38;
    ctx.beginPath(); ctx.moveTo(-size * .18, size * .02); ctx.lineTo(-size * .12, size * .47); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(size * .08, -.04 * size); ctx.lineTo(size * .13, size * .45); ctx.stroke();
    ctx.globalAlpha = selected ? (companionFocus ? .94 : .9) : .82;
    drawMakerFace(ctx, size, style);
  } else {
    ctx.beginPath();
    ctx.moveTo(-size * .32, -size * .02);
    ctx.quadraticCurveTo(-size * .4, size * .28, -size * .28, size * .46);
    ctx.lineTo(size * .28, size * .46);
    ctx.quadraticCurveTo(size * .4, size * .28, size * .32, -size * .02);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    drawSentinelFace(ctx, size, style);
  }

  if (style.kind === 'sentinel') {
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, -size * .48); ctx.lineTo(0, -size * .66); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -size * .68, size * .035, 0, Math.PI * 2); ctx.fillStyle = style.accent; ctx.fill();
  } else if (style.kind === 'maker') {
    ctx.save(); ctx.rotate(.6); ctx.fillStyle = style.accent; ctx.fillRect(size * .31, -size * .39, size * .12, size * .22); ctx.restore();
  } else {
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, -size * .23, size * .35, Math.PI, 0); ctx.stroke();
  }
  ctx.restore();
  return size;
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
    this.materialPatch = null;
    this.materialProvisional = null;
    this.materialNodePoints = [];
    this.companionFocus = false;
    this.companionWorldView = false;
    this.materialEditing = false;
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
    if ((this.companionFocus || this.companionWorldView) && !this.materialEditing) return;
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
    const quietDiagnostics = (this.companionFocus || this.companionWorldView) && !this.materialEditing;
    const companionPresentation = this.companionFocus || this.companionWorldView;
    const radius = Math.max(9, (visible ? this.sliceRadius(entity) : entity.radius) * point.k);
    const haloRadius = radius * (held ? 2.3 : selected ? (this.companionFocus ? 1.35 : this.companionWorldView ? 1.28 : 2.05) : 1.72);
    const alpha = visible ? 1 : 0.22;
    ctx.save();
    ctx.globalCompositeOperation = companionPresentation ? 'source-over' : 'screen';
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, haloRadius);
    glow.addColorStop(0, tone.glow.replace('0.82', visible ? (companionPresentation ? '0.3' : '0.54') : '0.16'));
    glow.addColorStop(0.42, tone.glow.replace('0.82', visible ? (companionPresentation ? '0.1' : '0.17') : '0.06'));
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow; ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(point.x, point.y, haloRadius, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = tone.solid;
    ctx.beginPath(); ctx.arc(point.x, point.y, clamp(radius * 0.42, 5, 18), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha * (companionPresentation && selected ? .38 : 1);
    ctx.strokeStyle = held ? '#f7d58c' : selected ? (companionPresentation ? tone.solid : '#eff8ff') : tone.solid;
    ctx.lineWidth = held ? 2.5 : selected ? (companionPresentation ? 1.35 : 2) : 1;
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
    if ((selected || held) && !this.companionFocus && !this.companionWorldView) {
      ctx.strokeStyle = tone.solid; ctx.globalAlpha = 0.62; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(19, radius * 1.2) + 9, 0, Math.PI * 2); ctx.stroke();
    }
    const occupantSize = drawCompanionOccupant(ctx, entity, point, radius, {
      selected, held, companionFocus: this.companionFocus, companionWorldView: this.companionWorldView,
    });
    const labelBase = occupantSize ? occupantSize * .72 : Math.max(17, radius);
    // In companion or collapsed world view the selected resident carries the
    // identity; hiding the other labels keeps the field readable and leaves
    // material controls available without letting diagnostic text cover it.
    if (!quietDiagnostics || selected || held) {
      ctx.font = selected ? '600 12px system-ui, sans-serif' : '11px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = selected ? '#f4f7fb' : '#c8d7e8';
      ctx.fillText((entity.localPreview ? 'LOCAL PREVIEW · ' : held ? 'HELD · ' : '') + entity.name, point.x, point.y + labelBase + 12);
      if (selected && !quietDiagnostics) {
        ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
        ctx.fillStyle = tone.solid;
        ctx.fillText(tone.label.toUpperCase() + ' · ' + entity.q.slice(0, 3).map(value => finite(value).toFixed(1)).join(' / '), point.x, point.y + labelBase + 28);
      }
    }
    ctx.restore();
    return { ...point, id: entity.id, interactive: visible, tone: tone.key };
  }

  drawMaterialPatch(ctx, body, entity, geometry, { provisional = false } = {}) {
    if (!body?.nodes || !entity) return;
    // Keep the node hit targets available in companion/world view so the
    // existing material editor remains reachable. Quiet the mesh there, and
    // only reveal its diagnostic label while the editor is actively previewing.
    const quietCompanionMesh = (this.companionFocus || this.companionWorldView) && !this.materialEditing;
    const points = Object.values(body.nodes).map(node => {
      const projected = projectEntity(this, { ...node, radius: entity.radius, chart: entity.chart }, geometry);
      return { ...projected, nodeId: node.id, q: [...node.q], provisional };
    });
    this.materialNodePoints = points;
    const byId = new Map(points.map(point => [point.nodeId, point]));
    ctx.save();
    ctx.lineWidth = provisional ? 1.4 : 1.8;
    ctx.strokeStyle = provisional ? '#f6d18b' : '#72e0c0';
    ctx.fillStyle = provisional ? '#f6d18b' : '#72e0c0';
    ctx.globalAlpha = quietCompanionMesh ? (provisional ? 0.22 : 0.3) : (provisional ? 0.74 : 0.92);
    ctx.setLineDash(provisional ? [5, 4] : []);
    for (const edge of body.edges || []) {
      const from = byId.get(edge.a), to = byId.get(edge.b);
      if (!from?.visible || !to?.visible) continue;
      ctx.beginPath(); line(ctx, from, to); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const point of points) {
      if (!point.visible) continue;
      ctx.beginPath(); ctx.arc(point.x, point.y, provisional ? 3.5 : 4.5, 0, Math.PI * 2); ctx.fill();
      if (!provisional && body.fixedNodeIds?.includes(point.nodeId)) {
        ctx.strokeStyle = '#eff8ff'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    const visible = points.filter(point => point.visible);
    if (visible.length && !quietCompanionMesh) {
      ctx.setLineDash(provisional ? [4, 4] : []);
      ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = provisional ? '#f6d18b' : '#72e0c0';
      ctx.fillText(provisional ? 'MATERIAL PATCH · PROVISIONAL' : `MATERIAL PATCH · ${body.bodyRevision ?? 0}`, visible[0].x + 8, visible[0].y - 8);
    }
    ctx.restore();
  }

  atMaterialNode(x, y) {
    let best = null, distance = 30;
    for (const point of this.materialNodePoints || []) {
      if (!point.visible) continue;
      const next = Math.hypot(Number(x) - point.x, Number(y) - point.y);
      if (next < distance) { distance = next; best = point; }
    }
    return best ? { ...best } : null;
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
    this.materialNodePoints = [];
    const state = this.state;
    if (!state) {
      drawIdleField(ctx, this);
      this.drawAxes(ctx);
    } else {
      this.drawGrid(ctx, this.grid);
      this.drawAxes(ctx);
      const geometry = state.geometry || { kind: 'flat', R: 2, r: 1 };
      const workpiece = state.entities?.workpiece;
      // Keep accepted material behind the embodied occupant so the selected
      // identity reads as a resident of the existing world, not a tooltip.
      this.drawMaterialPatch(ctx, this.materialPatch, workpiece, geometry, { provisional: false });
      if (this.materialProvisional) this.drawMaterialPatch(ctx, this.materialProvisional, workpiece, geometry, { provisional: true });
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
