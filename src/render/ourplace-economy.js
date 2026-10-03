import {
  CREATOR_CATEGORIES,
  parseSharedCreatorDesign
} from '../domains/creator-economy.js?v=20261003-complete8';
import {
  economicDigest
} from '../domains/economic-kernel.js?v=20261003-complete8';
import {
  runLocalComputeTool
} from '../domains/compute-jobs.js?v=20261003-complete8';
import {
  COMPUTE_PROVIDERS
} from '../domains/compute-exchange.js?v=20261003-complete8';
import {
  wireOurplaceFinance
} from './ourplace-finance.js?v=20261003-complete8';

/** Native content for the existing TUMBO body: one task and one tab at a time. */
export function mountOurplaceEconomy({
  host,
  runtime,
  applyDesign,
  onNavigate,
  documentRoot = document,
  windowRoot = window
} = {}) {
  if (!host || !runtime || typeof applyDesign !== 'function') throw new Error('Ourplace needs its native host and shared economic runtime');
  const doc = documentRoot,
    root = doc.createElement('section');
  root.id = 'ourplace-economy';
  const create = (tag, text, attrs = {}) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const key = prefix => `${prefix}:${Date.now()}:${windowRoot.crypto?.randomUUID?.() ?? ++sequence}`;
  let sequence = 0,
    preview = null,
    imported = null,
    lastJobId = null,
    selectedPublishedKey = null;
  let finance = null,
    recognition = null,
    disposed = false,
    reviewedSharedJson = null,
    jobSelectionInitialized = false;
  const sessionId = key('session');
  const style = create('style');
  style.textContent = `
    #ourplace-economy{--accent:var(--ourplace-accent,#39b9ff);display:grid;gap:12px;color:#e0edff;font:14px/1.55 system-ui,sans-serif;min-width:0}
    #ourplace-economy *{box-sizing:border-box;min-width:0}#ourplace-economy [hidden]{display:none!important}
    #ourplace-economy h2,#ourplace-economy h3,#ourplace-economy p{margin:0}#ourplace-economy h2{font-size:22px;color:#ecf5ff}
    #ourplace-economy button,#ourplace-economy input,#ourplace-economy select,#ourplace-economy textarea{font:inherit;color:#e7f1ff;background:#071524;border:1px solid #365574;border-radius:8px;padding:10px;max-width:100%;min-height:44px}
    #ourplace-economy input,#ourplace-economy select,#ourplace-economy textarea{width:100%}#ourplace-economy textarea{min-height:100px;resize:vertical}
    #ourplace-economy button{cursor:pointer}#ourplace-economy button:disabled{opacity:.45;cursor:default}#ourplace-economy button:focus-visible,#ourplace-economy input:focus-visible,#ourplace-economy select:focus-visible,#ourplace-economy textarea:focus-visible{outline:2px solid #e8ce96;outline-offset:2px}
    #ourplace-economy [aria-selected=true],#ourplace-economy .ourplace-primary{background:#103452;border-color:var(--accent)}
    #ourplace-economy .ourplace-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
    #ourplace-economy .ourplace-pane{display:grid;gap:14px}#ourplace-economy .ourplace-field{display:grid;gap:5px}
    #ourplace-economy .ourplace-actions{display:flex;gap:8px;flex-wrap:wrap}#ourplace-economy .ourplace-actions>*{flex:1 1 140px}
    #ourplace-economy .ourplace-status{padding:10px;border-left:3px solid var(--accent);background:#071321;color:#bdd5ec;overflow-wrap:anywhere;white-space:pre-wrap}
    #ourplace-economy .ourplace-summary{padding:10px;border:1px solid #29405a;border-radius:10px;display:grid;gap:6px}
    #ourplace-economy small{color:#9db3c9}#ourplace-economy details>summary{cursor:pointer;min-height:44px;padding:10px 0}
    #ourplace-economy pre{font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#040c16;padding:12px;border-radius:8px;max-height:260px;overflow:auto}
    #reality-assembly #ourplace-economy .ourplace-tabs{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:6px!important}
    @media(max-width:700px){#reality-assembly #ourplace-economy .ourplace-tabs,#ourplace-economy .ourplace-tabs{grid-template-columns:repeat(2,minmax(0,1fr))!important}#ourplace-economy{font-size:13px}}
  `;
  root.append(style);
  root.append(create('h2', 'Ourplace'), create('p', 'Shape your system. Share a design. Follow its use and its economic receipts.'), create('small', 'Local rehearsal · TUMBO-SIM · rewards require funded pools. Shared packages do not verify a public identity or real audience.'));
  const summary = create('div', undefined, {
    class: 'ourplace-summary',
    'data-economy-summary': ''
  });
  root.append(summary);
  const actor = create('select', undefined, {
    'aria-label': 'Local rehearsal participant',
    'data-ourplace-actor': ''
  });
  for (const [id, label] of [
      ['u:you', 'You'],
      ['u:visitor', 'Visitor · local test identity'],
      ['u:creator', 'Creator · local test identity']
    ]) actor.append(create('option', label, {
    value: id
  }));
  root.append(actor);
  const funding = create('details'),
    fundingSummary = create('summary', 'Fund local rehearsal balances');
  funding.append(fundingSummary);
  const fundingButtons = create('div', undefined, {
    class: 'ourplace-actions'
  });
  funding.append(fundingButtons);
  const fundingStatus = create('div', '', {
    class: 'ourplace-status',
    role: 'status'
  });
  funding.append(fundingStatus);
  root.append(funding);

  function button(parent, text, action, name, {
    primary = false
  } = {}) {
    const node = create('button', text, {
      type: 'button',
      'data-ourplace-action': name,
      ...(primary ? {
        class: 'ourplace-primary'
      } : {})
    });
    node.addEventListener('click', async () => {
      node.disabled = true;
      try {
        await action();
        runtime.changed();
      } catch (error) {
        status.textContent = error?.message ?? 'Action failed';
      } finally {
        node.disabled = false;
        refresh();
      }
    });
    parent.append(node);
    return node;
  }
  const status = create('div', 'Choose one flow. Changes and receipts remain inspectable.', {
    class: 'ourplace-status',
    role: 'status',
    'aria-live': 'polite',
    'data-ourplace-status': ''
  });
  button(fundingButtons, 'Add 100 demo TUMBO', () => {
    runtime.kernel.engine.faucet(actor.value, 'TUMBO', 100000, {
      idempotencyKey: key('demo-grant')
    });
    fundingStatus.textContent = '100 TUMBO-SIM transferred from the finite demo faucet. No new supply issued.';
  }, 'fund-token');
  button(fundingButtons, 'Add $10 demo compute credits', () => {
    runtime.account.fundDemo({
      fundingId: key('credits'),
      amountUsd: '10',
      reason: 'explicit-ourplace-demo-funding'
    });
    fundingStatus.textContent = '$10 demo credits added to the shared compute account.';
  }, 'fund-credits');
  button(fundingButtons, 'Fund rewards with 10 TUMBO', () => {
    runtime.kernel.fundPool({
      from: actor.value,
      purpose: 'rewards',
      amountFluff: 10000,
      idempotencyKey: key('reward-pool')
    });
    fundingStatus.textContent = '10 TUMBO-SIM moved from your balance into the finite reward pool.';
  }, 'fund-rewards');
  const tabs = create('div', undefined, {
      class: 'ourplace-tabs',
      role: 'tablist',
      'aria-label': 'Ourplace economy'
    }),
    panes = new Map(),
    tabButtons = new Map();
  root.append(tabs, status);
  for (const [id, label] of [
      ['creator', 'Create & share'],
      ['compute', 'Compute'],
      ['services', 'Services & pay'],
      ['markets', 'Markets'],
      ['credit', 'Credit'],
      ['proof', 'Receipts & proof']
    ]) {
    const pane = create('section', undefined, {
      class: 'ourplace-pane',
      id: `ourplace-${id}`,
      role: 'tabpanel',
      'aria-labelledby': `ourplace-tab-${id}`
    });
    pane.hidden = id !== 'creator';
    panes.set(id, pane);
    const control = create('button', label, {
      id: `ourplace-tab-${id}`,
      type: 'button',
      role: 'tab',
      tabindex: id === 'creator' ? '0' : '-1',
      'aria-controls': pane.id,
      'aria-selected': String(id === 'creator'),
      'data-ourplace-tab': id
    });
    control.addEventListener('click', () => {
      for (const [name, child] of panes) {
        child.hidden = name !== id;
        tabButtons.get(name).setAttribute('aria-selected', String(name === id));
        tabButtons.get(name).tabIndex = name === id ? 0 : -1;
      }
      refresh();
    });
    control.addEventListener('keydown', event => {
      const controls = [...tabButtons.values()],
        index = controls.indexOf(control);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % controls.length : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index - 1 + controls.length) % controls.length : null;
      if (next !== null) {
        event.preventDefault();
        controls[next].focus();
        controls[next].click();
      }
    });
    tabs.append(control);
    tabButtons.set(id, control);
    root.append(pane);
  }

  function field(parent, label, type = 'text', value = '', attrs = {}) {
    const wrap = create('label', label, {
        class: 'ourplace-field'
      }),
      node = create(type === 'textarea' ? 'textarea' : 'input', undefined, {
        ...(type === 'textarea' ? {} : {
          type
        }),
        ...attrs
      });
    node.value = value;
    wrap.append(node);
    parent.append(wrap);
    return node;
  }

  function select(parent, label, options, attrs = {}) {
    const wrap = create('label', label, {
        class: 'ourplace-field'
      }),
      node = create('select', undefined, attrs);
    for (const [value, text] of options) node.append(create('option', text, {
      value
    }));
    wrap.append(node);
    parent.append(wrap);
    return node;
  }
  const creatorPane = panes.get('creator');
  creatorPane.append(create('h3', 'Talk to your place'), create('small', 'Try: blue; background navy; compact; grid; reduced motion; selected object wave. Review before applying.'));
  const request = field(creatorPane, 'What should change?', 'textarea', 'blue; background navy; compact; grid; reduced motion', {
    'data-design-request': '',
    maxlength: '1200'
  });
  const previewOutput = create('pre', 'Your reviewed changes will appear here.', {
    'data-design-preview': ''
  });
  const designActions = create('div', undefined, {
    class: 'ourplace-actions'
  });
  creatorPane.append(designActions, previewOutput);

  function previewRequest() {
    preview = runtime.designSession.preview(request.value);
    previewOutput.textContent = JSON.stringify({
      supported: preview.supported,
      unsupported: preview.unsupported,
      descriptor: preview.descriptor
    }, null, 2);
    status.textContent = preview.unsupported.length ? `Review ${preview.unsupported.length} unsupported clause(s). Only the listed supported changes can apply; no tool, agent or payment executes from a sentence.` : 'Preview ready. Applying changes requires your click.';
  }
  // Validate the session transition before changing real geometry. Roll back both
  // session and scene if an installed renderer reports that it could not apply.
  function applyReviewed(proposal) {
    const before = runtime.designSession.serialize();
    const next = runtime.designSession.apply({
      proposalId: proposal.proposalId,
      explicit: true
    });
    let effect;
    try {
      effect = applyDesign(next.descriptor);
      if (!effect?.applied) throw new Error('Design effects were not applied');
    } catch (error) {
      runtime.designSession.restore(before);
      try {
        if (!applyDesign(runtime.designSession.snapshot().descriptor)?.applied) throw new Error('Previous scene could not be restored');
      } catch (rollbackError) {
        throw new Error(`${error.message}; scene restoration needs review: ${rollbackError.message}`);
      }
      throw error;
    }
    preview = null;
    return effect;
  }
  button(designActions, 'Preview changes', previewRequest, 'design-preview', {
    primary: true
  });
  button(designActions, 'Speak a design preview', () => {
    const SpeechRecognition = windowRoot.SpeechRecognition ?? windowRoot.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      status.textContent = 'Voice recognition is unavailable in this browser. Type the bounded commands above and preview them.';
      return;
    }
    recognition?.abort();
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      if (disposed) return;
      request.value = String(event.results?.[0]?.[0]?.transcript ?? '').slice(0, 1200);
      try {
        previewRequest();
      } catch (error) {
        status.textContent = error.message;
      }
    };
    recognition.onerror = event => {
      if (!disposed) status.textContent = `Voice preview unavailable (${event.error ?? 'recognition failed'}). You can type the same commands.`;
    };
    recognition.start();
    status.textContent = 'Listening for one design request. Your browser controls microphone permission and may use its speech service. The transcript is previewed only; applying still requires your click.';
  }, 'design-voice');
  button(designActions, 'Apply reviewed changes', () => {
    if (!preview) throw new Error('Preview your request first');
    const effect = applyReviewed(preview);
    status.textContent = `Design applied to the actual objects. ${effect.uninstalledObjects?.length ? 'Uninstalled object references remain reviewable intents.' : 'Palette, arrangement and motion updated.'}`;
  }, 'design-apply');
  button(designActions, 'Undo design', () => {
    const before = runtime.designSession.serialize(),
      next = runtime.designSession.undo();
    try {
      if (!applyDesign(next.descriptor)?.applied) throw new Error('Previous design could not be applied');
    } catch (error) {
      runtime.designSession.restore(before);
      throw error;
    }
    preview = null;
    status.textContent = 'Previous design and attribution restored.';
  }, 'design-undo');
  button(designActions, 'Start fresh design', () => {
    const before = runtime.designSession.serialize(),
      next = runtime.designSession.reset();
    try {
      if (!applyDesign(next.descriptor)?.applied) throw new Error('Fresh design could not be applied');
    } catch (error) {
      runtime.designSession.restore(before);
      throw error;
    }
    preview = null;
    status.textContent = 'Default design restored with fresh origin. Undo retains the previous licensed attribution.';
  }, 'design-fresh');
  const descriptorDetails = create('details');
  descriptorDetails.append(create('summary', 'Review objects, tools, agents and workflow intents'));
  descriptorDetails.append(create('small', 'All six categories share a bounded descriptor. Example: objects [{"id":"my-tool","kind":"tool","label":"My tool","shape":"cube","color":"#39b9ff"}], steps [{"id":"review","action":"inspect","target":"my-tool","label":"Review tool"}]. These are descriptions; installing code or running an agent needs an installed adapter and separate permission.'));
  const descriptorText = field(descriptorDetails, 'Bounded descriptor JSON', 'textarea', '', {
    'data-design-descriptor': '',
    maxlength: '12000'
  });
  button(descriptorDetails, 'Preview descriptor JSON', () => {
    preview = runtime.designSession.preview(JSON.parse(descriptorText.value));
    previewOutput.textContent = JSON.stringify(preview.descriptor, null, 2);
    status.textContent = 'Structured descriptor validated for review. Referenced tools and workflow steps are intents until their installed adapter confirms execution.';
  }, 'design-descriptor-preview');
  creatorPane.append(descriptorDetails);
  const title = field(creatorPane, 'Design name', 'text', 'My calm place', {
    maxlength: '100',
    'data-design-title': ''
  });
  const category = select(creatorPane, 'What are you sharing?', CREATOR_CATEGORIES.map(value => [value, value]), {
    'data-design-category': ''
  });
  const license = select(creatorPane, 'License', [
    ['attribution', 'Attribution'],
    ['attribution-sharealike', 'Attribution + share alike']
  ]);
  const parentDesign = select(creatorPane, 'Remix parent', [
    ['', 'Start a fresh design']
  ], {
    'data-design-parent': ''
  });
  const publishActions = create('div', undefined, {
    class: 'ourplace-actions'
  });
  creatorPane.append(publishActions);
  button(publishActions, 'Publish reviewed design locally', () => {
    const session = runtime.designSession.snapshot();
    if (!session.publicationEligible) throw new Error('This design has shared or unverified origin. Its declared licensed attribution is preserved; it cannot be republished as a fresh local author or create reward authority. Use Start fresh design to reset both appearance and origin.');
    const inheritedParent = session.provenance.kind === 'local-design' ? session.provenance.rootKey : null;
    const parents = [...new Set([inheritedParent, parentDesign.value].filter(Boolean))];
    const design = runtime.creator.registerDesign({
      id: key('design'),
      version: 1,
      creator: actor.value,
      category: category.value,
      title: title.value,
      descriptor: session.descriptor,
      parents,
      privacy: 'public',
      idempotencyKey: key('register')
    });
    runtime.creator.publish({
      key: design.key,
      creator: actor.value,
      license: license.value,
      explicit: true,
      idempotencyKey: key('publish')
    });
    selectedPublishedKey = design.key;
    status.textContent = 'Published in this local catalog with a version, license and attribution. Download its reviewed package to share it.';
  }, 'design-publish', {
    primary: true
  });
  const catalog = select(creatorPane, 'Published local designs', [
    ['', 'Choose a design']
  ], {
    'data-design-catalog': ''
  });
  const catalogInfo = create('div', '', {
    class: 'ourplace-status',
    'data-creator-rewards': ''
  });
  creatorPane.append(catalogInfo);
  const catalogActions = create('div', undefined, {
    class: 'ourplace-actions'
  });
  creatorPane.append(catalogActions);
  button(catalogActions, 'Apply selected design', () => {
    const design = runtime.creator.snapshot().designs.find(row => row.key === catalog.value);
    if (!design) throw new Error('Choose a published design');
    const nextPreview = runtime.designSession.preview(design.descriptor, {
      provenance: {
        kind: 'local-design',
        rootKey: design.key
      }
    });
    applyReviewed(nextPreview);
    const usage = runtime.observeAdoption({
      designKey: design.key,
      actor: actor.value,
      sessionId,
      descriptorHash: design.descriptorHash,
      kind: design.parents.length ? 'derived-use' : 'adoption'
    });
    status.textContent = usage.duplicateObserved ? 'This local adoption was already recorded. No additional entitlement.' : usage.qualified ? `Observed local adoption: ${usage.rewardFluff / 1000} TUMBO-SIM entitlement across ${usage.attribution.length} credited creator(s). Payout still requires funded settlement.` : `Design applied. This use earns no new reward: ${usage.reason}.`;
  }, 'design-adopt');

  function download(name, text) {
    const url = windowRoot.URL.createObjectURL(new windowRoot.Blob([text], {
        type: 'application/json'
      })),
      anchor = create('a', 'Download', {
        href: url,
        download: name
      });
    doc.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => windowRoot.URL.revokeObjectURL(url), 1000);
  }
  button(catalogActions, 'Download share package', () => {
    if (!catalog.value) throw new Error('Choose a design');
    download('ourplace-design.json', runtime.creator.exportDesign(catalog.value));
    status.textContent = 'Reviewed design package downloaded. It includes licensed lineage and excludes private conversations.';
  }, 'design-export');
  button(catalogActions, 'Settle funded creator rewards', () => {
    const planId = key('creator-plan');
    const plan = runtime.planCreatorPayout({
      planId,
      idempotencyKey: key('creator-plan-request')
    });
    const receipt = runtime.settleCreatorPlan({
      planId: plan.planId,
      idempotencyKey: key('creator-settle')
    });
    status.textContent = receipt.state === 'paid' && receipt.settled === true ? `${receipt.amountFluff / 1000} TUMBO-SIM paid from the reward pool in canonical receipt ${receipt.receiptId}.` : `Creator settlement requires reconciliation (${receipt.state ?? 'unconfirmed'}). Inspect plan ${plan.planId}${receipt.receiptId ? ` and canonical receipt ${receipt.receiptId}` : ''} before any further settlement. Entitlements remain reserved.`;
  }, 'creator-settle');
  const importDetails = create('details');
  importDetails.append(create('summary', 'Review a shared package'));
  const importText = field(importDetails, 'Reviewed package JSON', 'textarea', '', {
    'data-design-import': ''
  });
  button(importDetails, 'Preview shared package', () => {
    imported = parseSharedCreatorDesign(importText.value);
    reviewedSharedJson = importText.value;
    preview = runtime.designSession.preview(imported.root.descriptor, {
      provenance: {
        kind: 'shared-package',
        rootKey: imported.root.key,
        packetHash: imported.packetHash,
        attribution: imported.designs.map(({
          key,
          creator,
          license
        }) => ({
          key,
          creator,
          license
        }))
      }
    });
    previewOutput.textContent = JSON.stringify({
      title: imported.root.title,
      declaredCreator: imported.root.creator,
      license: imported.root.license,
      attribution: imported.designs.map(row => ({
        key: row.key,
        creator: row.creator,
        license: row.license
      })),
      descriptor: preview.descriptor
    }, null, 2);
    status.textContent = 'Integrity checked; author identity is unverified. Review and apply the design. Imported claims cannot authorize a creator payout.';
  }, 'design-import-preview');
  creatorPane.append(importDetails);
  button(importDetails, 'Download reviewed original package', () => {
    if (!imported) throw new Error('Review a shared package first');
    download('ourplace-shared-design.json', reviewedSharedJson);
    status.textContent = 'Original reviewed package downloaded with its declared licensed attribution. External authors remain unverified.';
  }, 'design-import-export');
  const steps = create('div', undefined, {
    'data-design-steps': ''
  });
  creatorPane.append(steps);
  const computePane = panes.get('compute');
  computePane.append(create('h3', 'Budget → run → reconcile → reward'), create('small', 'The installed local text tool actually runs. Its simulated charge is separate from provider billing. NVIDIA execution remains in Web + AI until the adapter is authenticated.'));
  const jobCatalog = select(computePane, 'Existing task or an explicit new task', [
    ['', 'Start a new task']
  ], {
    'data-compute-job': ''
  });
  const jobInfo = create('div', '', {
    class: 'ourplace-status',
    'data-compute-job-info': ''
  });
  computePane.append(jobInfo);
  const taskText = field(computePane, 'Text for the installed local tool', 'textarea', 'My place is clear and calm. I want others to build useful experiences from it.', {
    'data-compute-task': '',
    maxlength: '4000'
  });
  const ceiling = field(computePane, 'Reserve at most (demo USD)', 'text', '0.05', {
    inputmode: 'decimal',
    'data-compute-ceiling': ''
  });
  const charge = field(computePane, 'Explicit simulated charge (demo USD)', 'text', '0.02', {
    inputmode: 'decimal',
    'data-compute-charge': ''
  });
  const computeActions = create('div', undefined, {
    class: 'ourplace-actions'
  });
  computePane.append(computeActions);
  const toolResult = create('pre', 'No task has run.', {
    'data-compute-output': ''
  });
  computePane.append(toolResult);
  button(computeActions, 'Reserve & run local tool', () => {
    if (jobCatalog.value) throw new Error('An existing task is selected. Resolve it or explicitly select Start a new task before running another.');
    const jobId = key('job');
    runtime.compute.reserveTask({
      jobId,
      providerId: 'local',
      model: 'text-summary',
      privacy: 'local-only',
      ceilingUsd: ceiling.value,
      taskHash: economicDigest({
        text: taskText.value
      }),
      idempotencyKey: key('job-reserve')
    });
    lastJobId = jobId;
    const output = runLocalComputeTool('text-summary', taskText.value);
    runtime.compute.recordExecution({
      jobId,
      executionId: key('tool-run'),
      mode: 'local-tool',
      inputTokens: 0,
      outputTokens: 0,
      outputHash: output.outputHash,
      idempotencyKey: key('job-executed')
    });
    toolResult.textContent = JSON.stringify(output, null, 2);
    status.textContent = 'Local tool completed. Credits remain reserved until reconciliation or cancellation.';
  }, 'compute-run', {
    primary: true
  });
  button(computeActions, 'Reconcile simulated charge', () => {
    if (!lastJobId) throw new Error('Run a reserved task first');
    const job = runtime.compute.reconcileTask({
      jobId: lastJobId,
      costUsd: charge.value,
      billingMode: 'explicit-demo',
      explicit: true,
      idempotencyKey: key('job-reconcile')
    });
    status.textContent = `$${job.costUsd} demo charge settled; unused reservation released. Live billing remains unverified.`;
  }, 'compute-reconcile');
  button(computeActions, 'Claim funded usage reward', () => {
    const job = runtime.compute.snapshot().jobs.find(row => row.jobId === lastJobId);
    if (!job?.receiptId) throw new Error('Reconcile a task first');
    const result = runtime.compute.claimIncentive({
      kind: 'compute',
      evidenceId: job.receiptId,
      beneficiary: actor.value,
      idempotencyKey: key('usage-claim')
    });
    status.textContent = `${result.amountFluff / 1000} TUMBO-SIM transferred from the funded reward pool. Receipt ${result.receiptId}.`;
  }, 'compute-claim');
  button(computeActions, 'Cancel & release reservation', () => {
    runtime.compute.cancelTask({
      jobId: lastJobId,
      idempotencyKey: key('job-cancel')
    });
    status.textContent = 'Reservation released. No simulated charge or reward.';
  }, 'compute-cancel');
  button(computeActions, 'Refund unsettled incentive job', () => {
    runtime.compute.refundTask({
      jobId: lastJobId,
      idempotencyKey: key('job-refund')
    });
    status.textContent = 'Demo charge refunded. Jobs with paid incentives require review.';
  }, 'compute-refund');
  const usageDetails = create('details');
  usageDetails.append(create('summary', 'Claim a shared Web + AI usage receipt'));
  usageDetails.append(create('small', 'Ourplace and Web + AI use the same compute account and receipt registry. A reward requires an exact funded credit debit and positive eligible simulated cost. Live provider billing and the local participant identity remain unverified.'));
  const usageCatalog = select(usageDetails, 'Shared local usage receipt', [
    ['', 'Choose a settled receipt']
  ], {
    'data-shared-usage': ''
  });
  const usageInfo = create('div', '', {
    class: 'ourplace-status',
    'data-shared-usage-info': ''
  });
  usageDetails.append(usageInfo);
  button(usageDetails, 'Claim selected funded usage reward', () => {
    if (!usageCatalog.value) throw new Error('Choose a shared usage receipt');
    const result = runtime.compute.claimIncentive({
      kind: 'compute',
      evidenceId: usageCatalog.value,
      beneficiary: actor.value,
      idempotencyKey: key('shared-usage-claim')
    });
    status.textContent = `${result.amountFluff / 1000} TUMBO-SIM transferred to ${result.beneficiary} from the funded reward pool. Canonical receipt ${result.receiptId}.`;
  }, 'shared-usage-claim');
  computePane.append(usageDetails);

  const contributionDetails = create('details');
  contributionDetails.append(create('summary', 'Consent to metadata contribution'));
  contributionDetails.append(create('small', 'This is a metadata-only local rehearsal. It records category, scope, units and expiry; no conversation, file, upload or provider training runs. Acceptance is a local test event, and rewards transfer only from the funded demo pool to the participant you explicitly select.'));
  const contributionCategory = select(contributionDetails, 'Metadata category', [
    ['design-usage', 'Design usage aggregate'],
    ['compute-usage', 'Compute usage aggregate'],
    ['workflow-quality', 'Workflow quality aggregate']
  ], {
    'data-contribution-category': ''
  });
  const contributionUnits = field(contributionDetails, 'Bounded accepted metadata units (1–1000)', 'number', '10', {
    min: '1',
    max: '1000',
    step: '1',
    'data-contribution-units': ''
  });
  const retentionDays = field(contributionDetails, 'Consent retention days (1–3650)', 'number', '30', {
    min: '1',
    max: '3650',
    step: '1',
    'data-contribution-retention': ''
  });
  const scope = select(contributionDetails, 'Consent scope', [
    ['aggregate-only', 'Aggregate only'],
    ['research-only', 'Research only'],
    ['provider-specific', 'Specific provider']
  ], {
    'data-contribution-scope': ''
  });
  const provider = select(contributionDetails, 'Provider for provider-specific scope', COMPUTE_PROVIDERS.map(row => [row.id, row.name]), {
    'data-contribution-provider': ''
  });
  const research = field(contributionDetails, 'Allow research within this scope', 'checkbox', '', {
    'data-contribution-research': ''
  });
  research.checked = true;
  const training = field(contributionDetails, 'Allow training within this scope (no training is executed)', 'checkbox', '', {
    'data-contribution-training': ''
  });
  const consent = field(contributionDetails, 'I explicitly approve these metadata permissions and expiry', 'checkbox', '', {
    'data-contribution-consent': ''
  });
  const contributionCatalog = select(contributionDetails, 'Local metadata contribution', [
    ['', 'Choose a contribution']
  ], {
    'data-contribution-catalog': ''
  });
  const contributionInfo = create('div', '', {
    class: 'ourplace-status',
    'data-contribution-info': ''
  });
  contributionDetails.append(contributionInfo);
  const contributionActions = create('div', undefined, {
    class: 'ourplace-actions'
  });
  contributionDetails.append(contributionActions);
  let selectedContributionId = null;

  function chosenContribution() {
    const row = runtime.vault.snapshot().contributions.find(item => item.contributionId === contributionCatalog.value);
    if (!row) throw new Error('Choose a metadata contribution');
    return row;
  }
  button(contributionActions, 'Propose metadata contribution', () => {
    const units = Number(contributionUnits.value);
    if (!Number.isSafeInteger(units) || units < 1 || units > 1000) throw new Error('Metadata units must be an integer from 1 to 1000');
    const record = runtime.vault.propose({
      contributionId: key('contribution'),
      category: contributionCategory.value,
      units,
      retentionDays: Number(retentionDays.value),
      purpose: 'explicit-local-metadata-rehearsal'
    });
    selectedContributionId = record.contributionId;
    consent.checked = false;
    status.textContent = 'Metadata proposal created. It has no consent, acceptance or payout yet.';
  }, 'contribution-propose');
  button(contributionActions, 'Authorize checked consent', () => {
    if (!consent.checked) throw new Error('Check explicit metadata consent before authorizing');
    const row = chosenContribution();
    runtime.vault.authorize(row.contributionId, {
      scope: scope.value,
      providerId: scope.value === 'provider-specific' ? provider.value : null,
      allowTraining: training.checked,
      allowResearch: research.checked
    });
    consent.checked = false;
    status.textContent = 'Checked metadata scope authorized locally. No upload or training ran. Review acceptance as a separate step.';
  }, 'contribution-authorize');
  button(contributionActions, 'Accept metadata in local rehearsal', () => {
    const row = chosenContribution(),
      result = runtime.vault.accept(row.contributionId, {
        evidenceId: key('metadata-acceptance'),
        providerId: row.consent?.scope === 'provider-specific' ? row.consent.providerId : null
      });
    status.textContent = result.accepted ? `${result.record.rewardFluff / 1000} TUMBO-SIM contribution entitlement recorded. Funding and an explicit claim are still required.` : `Metadata not accepted: ${result.reason}.`;
  }, 'contribution-accept');
  button(contributionActions, 'Claim funded contribution reward', () => {
    const row = chosenContribution(),
      result = runtime.compute.claimIncentive({
        kind: 'contribution',
        evidenceId: row.contributionId,
        beneficiary: actor.value,
        idempotencyKey: key('contribution-claim')
      });
    status.textContent = `${result.amountFluff / 1000} TUMBO-SIM transferred to ${result.beneficiary} from the funded pool. Canonical receipt ${result.receiptId}.`;
  }, 'contribution-claim');
  button(contributionActions, 'Revoke metadata consent', () => {
    const row = chosenContribution();
    runtime.vault.revoke(row.contributionId);
    consent.checked = false;
    status.textContent = 'Metadata consent revoked. Further acceptance or reward claims are blocked; a completed canonical payment remains in the history.';
  }, 'contribution-revoke');
  computePane.append(contributionDetails);
  const proofPane = panes.get('proof');
  proofPane.append(create('h3', 'One ledger, inspectable consequences'));
  const proofOutput = create('pre', 'Request a current commitment.', {
    'data-economic-proof': ''
  });
  button(proofPane, 'Verify balances & proof', () => {
    const proof = runtime.kernel.proof();
    proofOutput.textContent = JSON.stringify(proof, null, 2);
    status.textContent = `Canonical chain ${runtime.kernel.engine.ledger.verifyChain().ok ? 'valid' : 'invalid'} · supply ${proof.conserved ? 'conserved' : 'mismatch'} · SHA-256 Merkle-sum root computed locally. No external anchor.`;
  }, 'proof-verify');
  button(proofPane, 'Export local economic history', () => download('ourplace-economic-history.json', runtime.exportState()), 'economy-export');
  proofPane.append(proofOutput);
  for (const name of ['services', 'markets', 'credit']) panes.get(name).append(create('h3', {
    services: 'Authorized services and payments',
    markets: 'Reserved markets and prediction contracts',
    credit: 'Consented loan capital and collateral'
  } [name]));

  function updateOptions(node, rows, first) {
    const old = node.value;
    node.replaceChildren(create('option', first, {
      value: ''
    }));
    for (const row of rows) node.append(create('option', `${row.title} · ${row.creator} · v${row.version}`, {
      value: row.key
    }));
    if (rows.some(row => row.key === old)) node.value = old;
  }

  function refresh() {
    const snap = runtime.snapshot(),
      creator = runtime.creator.snapshot(),
      credits = runtime.account.snapshot();
    summary.textContent = `${actor.value} · ${runtime.kernel.balance(actor.value) / 1000} TUMBO-SIM · rewards pool ${snap.pools.rewards.amountFluff / 1000} · compute available $${credits.availableBalanceUsd.toFixed(2)} / reserved $${credits.reservedUsd.toFixed(2)} · ${snap.canonicalReceiptCount} canonical journals`;
    const publicDesigns = creator.designs.filter(row => row.state === 'published' && row.privacy === 'public');
    updateOptions(catalog, publicDesigns, 'Choose a design');
    updateOptions(parentDesign, publicDesigns, 'Start a fresh design');
    if (selectedPublishedKey && publicDesigns.some(row => row.key === selectedPublishedKey)) {
      catalog.value = selectedPublishedKey;
      selectedPublishedKey = null;
    }
    const pending = creator.entitlements.filter(row => row.state !== 'paid').reduce((sum, row) => sum + row.amountFluff, 0),
      paid = creator.entitlements.filter(row => row.state === 'paid').reduce((sum, row) => sum + row.amountFluff, 0);
    const origin = runtime.designSession.snapshot().provenance;
    catalogInfo.textContent = `${publicDesigns.length} published local design(s) · ${creator.usages.filter(row => row.qualified).length} qualified local use(s) · ${pending / 1000} TUMBO-SIM pending · ${paid / 1000} paid. Self-use and repeat sessions do not add rewards.\nCurrent origin: ${JSON.stringify(origin)}.`;
    const compute = runtime.compute.snapshot(),
      claims = compute.claims,
      jobs = compute.jobs,
      receipts = runtime.exchange.snapshot().receipts,
      previousReceipt = usageCatalog.value;
    if (!jobSelectionInitialized) {
      lastJobId = jobs.filter(row => ['reserved', 'completed-awaiting-billing', 'reconciled'].includes(row.status)).at(-1)?.jobId ?? null;
      jobSelectionInitialized = true;
    }
    jobCatalog.replaceChildren(create('option', 'Start a new task', {
      value: ''
    }));
    for (const row of jobs) jobCatalog.append(create('option', `${row.model} · ${row.status} · ${row.jobId}`, {
      value: row.jobId
    }));
    if (jobs.some(row => row.jobId === lastJobId)) jobCatalog.value = lastJobId;
    const chosenJob = jobs.find(row => row.jobId === jobCatalog.value);
    jobInfo.textContent = chosenJob ? `${chosenJob.jobId} · ${chosenJob.status} · reserve $${chosenJob.ceilingUsd}${chosenJob.receiptId ? ` · receipt ${chosenJob.receiptId}` : ''}. Existing tasks continue after reload; choose a new task explicitly to start another.` : 'No existing task selected. A new reservation requires your click.';
    usageCatalog.replaceChildren(create('option', 'Choose a settled receipt', {
      value: ''
    }));
    for (const row of receipts) usageCatalog.append(create('option', `${row.providerName} · ${row.model} · $${row.reportedCostUsd} · ${row.verified ? 'declared local cost' : 'unverified'}${claims.some(claim => claim.claimId === `compute:${row.receiptId}`) ? ' · paid' : ''}`, {
      value: row.receiptId
    }));
    if (receipts.some(row => row.receiptId === previousReceipt)) usageCatalog.value = previousReceipt;
    const receipt = receipts.find(row => row.receiptId === usageCatalog.value);
    usageInfo.textContent = receipt ? `${receipt.receiptId} · ${receipt.verificationBasis} · live billing unverified. Selected beneficiary: ${actor.value}. The kernel checks matching credit debits, refunds, duplicate claims and the daily cap before any transfer.` : `${receipts.length} shared local usage receipt(s). Open Web + AI or reconcile an Ourplace task to add one.`;
    const contributions = runtime.vault.snapshot().contributions,
      previousContribution = selectedContributionId ?? contributionCatalog.value;
    contributionCatalog.replaceChildren(create('option', 'Choose a contribution', {
      value: ''
    }));
    for (const row of contributions) contributionCatalog.append(create('option', `${row.category} · ${row.units} units · ${row.state}${row.claimId ? ' · paid' : ''}`, {
      value: row.contributionId
    }));
    if (contributions.some(row => row.contributionId === previousContribution)) contributionCatalog.value = previousContribution;
    selectedContributionId = null;
    const contribution = contributions.find(row => row.contributionId === contributionCatalog.value);
    contributionInfo.textContent = contribution ? JSON.stringify({
      id: contribution.contributionId,
      state: contribution.state,
      scope: contribution.consent,
      expires: new Date(contribution.expiresAt).toISOString(),
      rewardClaimable: contribution.rewardClaimable,
      rewardTumboSim: contribution.rewardFluff / 1000,
      claimId: contribution.claimId,
      selectedBeneficiary: actor.value
    }, null, 2) : 'Choose a proposal to inspect its consent, expiry and claim state.';
    steps.replaceChildren();
    for (const step of runtime.designSession.snapshot().descriptor.steps) button(steps, step.label, () => {
      if (!['navigate', 'inspect', 'preview'].includes(step.action)) throw new Error('This step requires explicit review in Web + AI or its destination');
      onNavigate?.(step.target);
    }, `step-${step.id}`);
    finance?.refresh();
  }
  actor.addEventListener('change', refresh);
  jobCatalog.addEventListener('change', () => {
    lastJobId = jobCatalog.value || null;
    refresh();
  });
  usageCatalog.addEventListener('change', refresh);
  contributionCatalog.addEventListener('change', refresh);
  const off = runtime.kernel.onEvent(() => queueMicrotask(refresh));
  host.append(root);
  refresh();
  const api = Object.freeze({
    root,
    refresh,
    panes,
    button,
    field,
    select,
    create,
    key,
    actor,
    status,
    runtime,
    selectTab(id) {
      if (!tabButtons.has(id)) throw new Error('Unknown Ourplace tab');
      tabButtons.get(id).click();
    },
    dispose() {
      disposed = true;
      recognition?.abort();
      finance?.dispose();
      off();
      root.remove();
    }
  });
  finance = wireOurplaceFinance(api);
  return api;
}
