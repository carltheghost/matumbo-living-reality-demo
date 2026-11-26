# Continuity release gate repair (2026-11-26)

PR #151's hosted account/memory suite reported 255 passing and seven failing tests. Its two mounted application Node jobs passed. The seven failures were two stale service-worker version assertions and five sign-in component mount failures caused by missing global browser event APIs in the in-process DOM fixture. The 15 task journal regressions passed in both native suites.

This refinement retains existing assertions and introduces an injectable browser event target, deterministic listener removal, and a scope epoch that rejects delayed task results/errors after a world change and return. It adds three regression tests and checks cache v28 (or newer) against the declared offline upgrade target, including the agent memory and continuity modules.

Seven browser jobs failed before executing browser acceptance because pinned Playwright 1.57 did not support the ubuntu-latest runner's Ubuntu 26.04 OS. Those jobs now use Ubuntu 24.04; the account/memory browser workflow uses the same OS and Playwright version. No browser assertions are skipped. The loopback image failed strict certificate validation because its disposable CA lacked key usage. The fixture now has appropriate CA and leaf extensions and an explicit strict verification step; TLS trust and hostname checks remain intact.

Local evidence: the corrected OpenSSL fixture passed strict server verification for IP 127.0.0.1 and DNS vivo-remote, and failed as expected for incorrect.example. Hosted verification of the patched branch is required. No live deployment, provider credits, or permission changes.

Source runs: 45728248966 (memory), 45728249055 (phone), 45728248926 (mounted), 45728248989 (remote recipe).
