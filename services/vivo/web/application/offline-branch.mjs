/** Build an explicit offline-fork command from the last accepted snapshot. */
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const uuid = () => {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw Error('OFFLINE_FORK_ID_UNAVAILABLE');
  return globalThis.crypto.randomUUID();
};

export function offlineForkCommand(snapshot, {newWorldId = 'offline:' + uuid(), commandId = 'fork.' + uuid()} = {}) {
  if (!snapshot || snapshot.schema !== 'vivo.snapshot/1' || !id(snapshot.worldId)
      || !id(snapshot.rootSpaceId) || typeof snapshot.stateHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(snapshot.stateHash)) throw Error('OFFLINE_FORK_SNAPSHOT_REQUIRED');
  if (!id(newWorldId) || newWorldId === snapshot.worldId) throw Error('OFFLINE_FORK_WORLD_ID');
  if (!id(commandId)) throw Error('OFFLINE_FORK_COMMAND_ID');
  return {
    schema: 'vivo.command/1',
    id: commandId,
    worldId: snapshot.worldId,
    spaceId: snapshot.rootSpaceId,
    kind: 'world.fork',
    expectedRevision: snapshot.acceptedSequence,
    payload: {checkpointHash: snapshot.stateHash, newWorldId},
  };
}
