import {
  validateProjectionContribution
} from '../core/world-state.js?v=20261003-complete8';
export const ECONOMIC_WORLD_SOURCE = 'ourplace-economic-world';
/** Aggregate observations only. This contribution has no economic action API. */
export function createEconomicWorldContribution(snapshot, updatedAt = new Date().toISOString()) {
  const entities = [],
    relationships = [],
    evidence = [];
  const add = row => entities.push(Object.freeze({
    ...row,
    simulation: true
  }));
  const link = (from, to, relation) => {
    const row = Object.freeze({
      id: `${from}:${relation}:${to}`,
      kind: 'neural-relationship',
      from,
      to,
      relation,
      simulation: true
    });
    relationships.push(row);
    entities.push(row);
  };
  const kernelId = 'economy:kernel';
  add({
    id: kernelId,
    kind: 'economic-kernel',
    label: 'Ourplace economic kernel',
    organId: 'asset-token',
    receiptCount: snapshot.canonicalReceiptCount,
    eventRoot: snapshot.eventRoot,
    canonicalChainValid: snapshot.canonicalChainValid,
    authority: 'local-simulation'
  });
  for (const [purpose, pool] of Object.entries(snapshot.pools ?? {})) {
    const id = `economy:pool:${purpose}`;
    add({
      id,
      kind: 'purpose-specific-funded-pool',
      label: `${purpose} pool`,
      organId: 'asset-token',
      amountFluff: pool.amountFluff,
      denomination: 'TUMBO-SIM'
    });
    link(id, kernelId, 'accounted-by');
  }
  for (const design of snapshot.domains?.creator?.designs ?? [])
    if (design.state === 'published' && design.privacy === 'public') {
      const id = `economy:design:${design.key}`;
      add({
        id,
        kind: 'reviewed-creator-design',
        label: design.title,
        organId: 'block-world',
        version: design.version,
        category: design.category,
        descriptorHash: design.descriptorHash,
        license: design.license,
        authority: 'declared-local-creator'
      });
      link(id, kernelId, 'has-funded-reward-policy');
      for (const parent of design.parents) link(`economy:design:${parent}`, id, 'derived-into');
    }
  for (const job of snapshot.domains?.compute?.jobs ?? []) {
    const id = `economy:job:${job.jobId}`;
    add({
      id,
      kind: 'budgeted-compute-job',
      label: `${job.providerId} · ${job.model}`,
      organId: 'neural-mesh',
      status: job.status,
      ceilingUsd: job.ceilingUsd,
      costUsd: job.costUsd ?? null,
      externalBillingVerified: false
    });
    link(id, kernelId, 'reconciles-to');
  }
  const finance = snapshot.domains?.finance ?? {};
  for (const [name, organId] of [
      ['payments', 'paycore'],
      ['orders', 'asset-market'],
      ['loans', 'asset-token'],
      ['markets', 'contracts']
    ])
    for (const row of finance[name] ?? []) {
      const id = `economy:${name}:${row.id}`;
      add({
        id,
        kind: `economic-${name}`,
        label: `${name} · ${row.status ?? row.state ?? 'local'}`,
        organId,
        state: row.status ?? row.state ?? null,
        amountFluff: row.amountFluff ?? row.principalFluff ?? null
      });
      link(id, kernelId, 'settles-on');
    }
  for (const event of (snapshot.events ?? []).slice(-100)) {
    const id = `economy:event:${event.sequence}`;
    add({
      id,
      kind: 'sealed-economic-event',
      label: event.type,
      organId: 'ledger',
      eventHash: event.hash,
      sequence: event.sequence
    });
    evidence.push(Object.freeze({
      id: `${id}:evidence`,
      kind: 'local-economic-commitment',
      status: 'SHA-256-local-event',
      canonicalReceiptKeys: event.receiptKeys
    }));
    link(id, kernelId, 'observes');
  }
  const contribution = {
    schemaVersion: 1,
    source: ECONOMIC_WORLD_SOURCE,
    simulation: true,
    updatedAt,
    entities,
    evidence,
    relationships,
    capabilities: [{
      id: 'ourplace-economy.inspect',
      mode: 'local-projection',
      authority: 'none',
      executable: false
    }],
    boundary: 'Read-only local economic projection. No personal prompts, external signer, custody, public identity verification or settlement authority.'
  };
  validateProjectionContribution(contribution);
  return contribution;
}
