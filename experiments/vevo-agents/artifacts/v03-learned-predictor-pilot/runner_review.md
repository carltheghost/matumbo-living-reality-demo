# Learned predictor runner source review

Status: concrete runner implemented; it was not invoked for this artifact.

- Scope: six learned fits (geometry on/off × seeds `7, 17, 37`), exactly `100` equal SGD updates per variant/seed, and evaluation at update `100`.
- Budget: one cooperative shared `300`-second deadline across setup, paired updates, development cases, checkpoint save/reload, parity, aggregation, selection, and serialization.
- Paired timeout: an incomplete variant invalidates the pair; no selection or final-test access is emitted.
- Checkpoint safety: normalizer digests cover canonical mean/scale plus training-source provenance; reloaded predictions require exact parity.
- Optimizer safety: all gradients and updated arrays are validated before an atomic parameter commit.
- Final test: replacement worlds 9500--9507 remain metadata-only and closed; a canonical digest-bound frozen selection artifact is required.
- Development: worlds 9300--9307 are inspected development cases only, never fresh generalization.
- Timing: the probe-based optimizer lower bound is `93.155` seconds before overhead; an invoked runner must report actual elapsed time.
- Historical reports and checkpoints were not modified.
