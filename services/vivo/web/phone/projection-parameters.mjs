/* Phone-owned projection parameters shared by the phone renderer and inverse. */
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function rendererProjectionParameters(renderer = {}, fallback = {}) {
  const width = finite(renderer.w, finite(fallback.width));
  const height = finite(renderer.h, finite(fallback.height));
  const projectionProfile = renderer.projectionProfile === 'phone' ? 'phone' : 'base';
  return {
    width,
    height,
    centerX: width / 2,
    centerY: projectionProfile === 'phone' && width < 720 ? height * 0.37 : height * 0.52,
    yaw: finite(renderer.yaw, 0.55),
    pitch: finite(renderer.pitch, 0.68),
    distance: Math.max(0.15, finite(renderer.distance, 10.5)),
    origin: Array.isArray(renderer.origin)
      ? [finite(renderer.origin[0]), finite(renderer.origin[1]), finite(renderer.origin[2])]
      : [0, 0, 0],
    projectionProfile,
  };
}

export function projectPhonePoint(renderer = {}, position = []) {
  const projection = rendererProjectionParameters(renderer);
  const { width, height, centerX, centerY, yaw, pitch, distance, origin } = projection;
  const x = position[0] - origin[0], y = position[1] - origin[1], z = position[2] - origin[2];
  const ca = Math.cos(yaw), sa = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const xx = ca * x - sa * z, zz = sa * x + ca * z, yy = cp * y - sp * zz;
  const depth = distance - (sp * y + cp * zz);
  const k = Math.min(width, height) * 1.18 / Math.max(0.15, depth);
  return { x: centerX + xx * k, y: centerY - yy * k, z: Math.max(-0.95, Math.min(0.95, (depth - 1) / 35)), k, depth, visible: depth > 0.3 };
}
