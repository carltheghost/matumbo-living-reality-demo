/** Canonical envelope/target validation. Authority must still authorize and reconcile. */
export const VERSION = 'vivo.command/1';
const kinds = new Set(['grab.begin','grab.target','grab.end','space.enter','space.exit','world.fork','studio.transform']);
const sources = new Set(['touch','hand','eye-confirmed','keyboard']);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uint = value => Number.isSafeInteger(value) && value >= 0;
function need(test, message) { if (!test) throw new TypeError(message); }
function keys(value, expected) {
  need(object(value), 'Expected object');
  need(Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value,k)), 'Unexpected or missing keys');
}
export function validateFrame(frame) {
  need(object(frame), 'Expected frame');
  need(id(frame.spaceId) && id(frame.chart), 'Invalid coordinate frame');
  need(Number.isInteger(frame.dimension) && frame.dimension >= 2 && frame.dimension <= 11, 'Expected 2-11 spatial axes');
  need(Array.isArray(frame.q) && frame.q.length === frame.dimension && Array.from(frame.q).every(x => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 1000), 'Invalid full-dimensional coordinates');
  return frame;
}
export function validateCommand(command) {
  keys(command,['schema','id','worldId','spaceId','kind','expectedRevision','payload']);
  need(command.schema === VERSION && id(command.id) && id(command.worldId) && id(command.spaceId), 'Invalid command identity');
  need(kinds.has(command.kind) && uint(command.expectedRevision) && object(command.payload), 'Invalid command kind or revision');
  const p = command.payload;
  if (command.kind === 'grab.target') {
    keys(p,['entityId','leaseId','source','inputEpoch','targetSeq','dimension','chart','q','sampleAgeMs']);
    need(id(p.entityId) && id(p.leaseId) && sources.has(p.source), 'Invalid target ownership');
    need(uint(p.inputEpoch) && Number.isSafeInteger(p.targetSeq) && p.targetSeq > 0, 'Invalid input ordering');
    need(typeof p.sampleAgeMs === 'number' && Number.isFinite(p.sampleAgeMs) && p.sampleAgeMs >= 0 && p.sampleAgeMs <= 150, 'Stale target');
    validateFrame({spaceId:command.spaceId,dimension:p.dimension,chart:p.chart,q:p.q});
  } else if (command.kind === 'grab.begin') {
    const base=['entityId','source','inputEpoch'], actual=Object.keys(p).sort();
    const normal=[...base].sort(), cooperative=[...base,'cooperativeGroup'].sort();
    need(object(p) && (JSON.stringify(actual)===JSON.stringify(normal) || JSON.stringify(actual)===JSON.stringify(cooperative)), 'Unexpected or missing keys');
    need(id(p.entityId) && sources.has(p.source) && uint(p.inputEpoch), 'Invalid grab');
    if (Object.hasOwn(p,'cooperativeGroup')) need(id(p.cooperativeGroup), 'Invalid cooperative group');
  } else if (command.kind === 'grab.end') {
    keys(p,['entityId','leaseId','inputEpoch','reason']);
    need(id(p.entityId) && id(p.leaseId) && uint(p.inputEpoch) && typeof p.reason === 'string' && p.reason.length > 0 && p.reason.length <= 120, 'Invalid release');
  } else if (command.kind === 'space.enter') {
    keys(p,['portalEntityId','eyeId']); need(id(p.portalEntityId) && id(p.eyeId),'Invalid entry');
  } else if (command.kind === 'space.exit') {
    keys(p,['eyeId','returnFrameId']); need(id(p.eyeId) && id(p.returnFrameId),'Invalid return');
  } else if (command.kind === 'studio.transform') {
    keys(p,['bindingId','sourceModel','sourceNode','entityId','dimension','chart','q','metadata']);
    need(p.bindingId === 'studio.node.echo' && p.sourceModel === 'matumbo-field-lab' && p.sourceNode === 55 &&
      p.entityId === 'relic' && p.dimension === 4 && p.chart === 'flat', 'Invalid Studio binding identity');
    validateFrame({spaceId:command.spaceId,dimension:p.dimension,chart:p.chart,q:p.q});
    keys(p.metadata,['name','kind']);
    need(p.metadata.name === 'Echo' && p.metadata.kind === 'RESONANCE / 02', 'Invalid Studio binding metadata');
  } else {
    keys(p,['checkpointHash','newWorldId']);
    need(typeof p.checkpointHash === 'string' && /^[a-f0-9]{64}$/.test(p.checkpointHash) && id(p.newWorldId),'Invalid explicit fork');
  }
  return command;
}
export function validateReceipt(receipt) {
  keys(receipt,['schema','id','status','authorityId','acceptedSequence','entityRevision','code','stateHash','result']);
  need(receipt.schema === 'vivo.receipt/1' && id(receipt.id) && id(receipt.authorityId), 'Invalid receipt identity');
  need(['accepted','rejected'].includes(receipt.status) && uint(receipt.acceptedSequence), 'Invalid acceptance order');
  need(receipt.entityRevision === null || uint(receipt.entityRevision), 'Invalid entity revision');
  need(typeof receipt.code === 'string' && receipt.code.length > 0 && receipt.code.length <= 120, 'Missing result code');
  need(receipt.stateHash === null || (typeof receipt.stateHash === 'string' && /^[a-f0-9]{64}$/.test(receipt.stateHash)), 'Invalid state hash');
  need(receipt.result === null || object(receipt.result), 'Invalid result');
  if (receipt.status === 'accepted') need(receipt.stateHash !== null, 'Accepted state needs a hash');
  return receipt;
}
