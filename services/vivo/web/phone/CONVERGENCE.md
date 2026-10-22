# Vivo convergence adapter: additive integration seam

This module composes an existing `AgentToolRegistry`, its existing
`LocalAgentController`, the existing canonical simulated-economy owner, and
explicit host-supplied memory/neural transports. It creates no second world,
ledger, model, provider connection, or user interface. No entrypoint is changed.

## API

```js
import {VivoConvergenceAdapter} from './convergence-adapter.mjs';
const adapter = new VivoConvergenceAdapter({
  registry: existingRegistry,
  economy: existingEconomyOwner.model,
  transport: explicitlyConfiguredLocalTransport,
});
// Native session was already registered and granted by the host/user.
const session = adapter.attach(nativeSession, ['memory.read', 'contracts.read']);
const tools = adapter.list(session);
const contracts = await adapter.invoke(session, 'contracts.inspect');
await adapter.stop(session);
```

The host must explicitly grant the extra capabilities; they do not expand the
native registry's grants. `neural.lab` is a separate experimental opt-in and is
not enabled by the example above. A transport implements
`invoke(name, arguments, {signal})`. It is a trusted host adapter, not a sandbox
for arbitrary executable plug-ins or a remote authentication system.

## Tools and boundaries

- Existing native tools still dispatch through `AgentToolRegistry.invokeFor`.
- `contracts.inspect` calls the existing owner's `verify()` and `contracts()`.
  It returns a detached, simulation-labelled, read-only view. No contract or
  balance mutation is exposed by this extra capability.
- `memory.search`, `memory.read`, and `neural.predict` appear only when a host
  transport exists and the corresponding additional capability is granted.
- A deadline aborts the request and fences late results. It does not reverse
  an operation already accepted by another authority. No automatic retry.
- Stop aborts pending extra requests and delegates source-specific cleanup to
  the existing native controller. Other registered sources remain independent.

A model's outputs are proposals or experimental predictions, never signing,
custody, settlement, deployment, or permission authority. This module alone
neither loads a neural checkpoint nor constitutes a complete agent system.
It must not be advertised as superintelligence.

## Local evidence

Pinned base: `1da8a2f81aaebd529e1129d4cfd147d7a98ab157`.

```sh
node --check services/vivo/web/phone/convergence-adapter.mjs
node --test services/vivo/web/phone/tests/convergence-adapter.test.mjs \
  services/vivo/web/phone/tests/agent-control.test.mjs \
  services/vivo/web/phone/tests/agent-tools.test.mjs \
  services/vivo/web/phone/tests/economy-entry.test.mjs
```

Executed locally on Node v22.16.0: 26 passed, zero failures/skips. This includes
10 new tests and 16 unchanged adjacent tests. The tests use the actual native
world/controller/registry/economy modules; fault-path transports are injected.
An initial test fixture incorrectly constructed a new economy after the first
owner had receipts. It was corrected to reuse one canonical owner; no native
ledger guard was weakened.

A separate local Node/Python process proof connected the native registry,
read-only native contract inspection, recovered exact notes, and experimental
checkpoint inference. Private notes/checkpoints and that local proof host are
NOT committed by this change.

## Remaining integration

Main must supply the authorized local transport, bind explicit user grants,
and review browser/device/offline behavior before mounting this seam. No
provider subscription, model entitlement, background task, Android permission,
or external plug-in connection is assumed. No real-money actions are enabled.

A broad test attempt against the separate browser-distribution ZIP produced
151 passes and 8 failures: seven missing repository/Android/backend test inputs
and one legacy service-worker cache-name assertion. That is not a full-repository
CI result or a passing release gate. The targeted result above is separate.
No merge or deployment is performed by this stage.
