const TONES = Object.freeze({
  place: Object.freeze({
    key: 'place', label: 'Place', hue: 214, saturation: 88, lightness: 64,
    solid: '#6fa8ff', glow: 'rgba(81, 148, 255, 0.82)', rgb: [0.29, 0.58, 1],
  }),
  person: Object.freeze({
    key: 'person', label: 'Person', hue: 28, saturation: 88, lightness: 62,
    solid: '#f39b55', glow: 'rgba(243, 155, 85, 0.82)', rgb: [1, 0.53, 0.2],
  }),
  memory: Object.freeze({
    key: 'memory', label: 'Memory', hue: 151, saturation: 74, lightness: 60,
    solid: '#67e0a2', glow: 'rgba(103, 224, 162, 0.78)', rgb: [0.2, 0.88, 0.52],
  }),
  signal: Object.freeze({
    key: 'signal', label: 'Signal', hue: 193, saturation: 82, lightness: 66,
    solid: '#69d9ec', glow: 'rgba(105, 217, 236, 0.72)', rgb: [0.25, 0.78, 0.9],
  }),
});

const TOKEN_RULES = Object.freeze([
  ['memory', /memory|relic|history|past|remember|archive|lineage/],
  ['person', /person|people|participant|actor|user|ana|kai|mo|tumbo|avatar/],
  ['place', /place|portal|space|world|room|workshop|workpiece|field|location/],
]);

function entityText(entity = {}) {
  return [
    entity.id,
    entity.name,
    entity.materialProfile,
    ...(Array.isArray(entity.fieldMembership) ? entity.fieldMembership : []),
    ...(Array.isArray(entity.lineage) ? entity.lineage : []),
  ].join(' ').toLowerCase();
}

export function fieldTone(entity = {}) {
  const text = entityText(entity);
  for (const [key, pattern] of TOKEN_RULES) if (pattern.test(text)) return TONES[key];
  return TONES.signal;
}

export function informationColor(entity = {}) {
  const tone = fieldTone(entity);
  return {
    ...tone,
    css: `hsl(${tone.hue} ${tone.saturation}% ${tone.lightness}%)`,
  };
}

export function fieldLegend() {
  return Object.values(TONES).map(tone => ({ key: tone.key, label: tone.label, solid: tone.solid }));
}
