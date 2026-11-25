# Native constructive memory recall

This change joins the existing explicit-weight memory lab in #141 with the
session-scoped convergence adapter from #149. It does not add a second memory
store, a provider login, a model, or a world. The existing circuit remains unchanged.

- Compile/save or restore a memory in the existing AI & memory panel, refresh
  active agents, choose one and explicitly grant read-only recall.
- The existing native tool surface lists `neural.predict` for that session
  only. Invoke with `{start:17,path:[0,1,2,3]}` for the synthetic example.
  The result includes scope, revision and exact record IDs. Unknown addresses
  abstain. Model arguments cannot supply scope, checkpoints or permissions.
- Revoking one grant leaves the native agent and other agents operational.
  Replacement of the mounted memory or a world/project transition clears grants.
  Reload does not restore grants; the existing checkpoint restore is explicit.
- The page-local admin/tool separation assumes trusted same-page host code;
  it is not a remote identity or OS sandbox. The numeric circuit is not semantic
  note search, general intelligence, or a trained language model.

Local Node 22.16.0: 18/18 targeted tests passed using the actual circuit and
adapter with controlled native registry/controller doubles. The exact
constructive memory blob from #141 and original 8 boundary regressions from
#149 were verified. The bootstrap, panel and v26 cache changes are wired in the
review branch but the complete mounted browser, offline upgrade and provider
sessions are not verified in this environment. No credits, real credentials,
merge or deployment. Test with:

```sh
node --test services/vivo/web/phone/tests/constructive-memory-agent.test.mjs services/vivo/web/phone/tests/convergence-port-scope.test.mjs
```
