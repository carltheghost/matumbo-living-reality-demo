# v0.3 document-evidence contract

This is a bounded protocol proof for a first real task. It is separate from
the continuous four-gate neural repair: the existing gate checkpoint has no
document competence and is not reused as a document policy.

## Task boundary

The server owns a four-document fixture bundle and exposes only stable
document handles and a section catalogue. A task contains two to six bundled
documents, at most four sections per document, two or three requested typed
fields, and a maximum action budget of 16. The initial request shows the field
identifiers, types, and revision rule. A policy must inspect sections, select
observed candidates explicitly, and either finish with an evidence packet or
report a missing field.

The fixture includes current, obsolete, conflicting-history, and irrelevant
facts. Section inspection returns typed raw values plus legitimate provenance:
opaque candidate ID, server handle, section, type, revision state, publication
date, conflict group, source digest, and fact digest. It does not return fact
IDs, requested-field labels, targets, expected values, raw documents, or
filesystem paths. The in-memory evidence store retains the raw value and
complete provenance for verification.

## Verification and restart

The verifier rereads the manifest-addressed bytes before checking a packet. It
rejects changed bytes, forged values, forged citations, unselected candidates,
duplicate or incomplete packets, and non-latest or obsolete selections. The
`latest_non_obsolete` rule uses the highest observed current revision and
publication date; equal-ranked differing values are a conflict. A missing-fact
claim is valid only after every task section has been explored. An early claim
is reported as inconclusive, not as proof of absence.

Each attempted action consumes one budget unit, and the session checks the
deadline before every next action. After exhaustion it returns a structured
`budget_exhausted` result without running further verification metrics. JSON
snapshots replay the action log against the same server-owned bytes and must
match exactly; changed source bytes invalidate restoration.

## Baselines and model status

The observation-limited deterministic expert sees only response dictionaries.
It prefers legitimate section kinds for requested types and explores all
remaining sections when it needs to prove absence. The read-all comparator
inspects every bounded section. Neither baseline reads the bundle privately or
uses a hidden answer.

The separate document-policy interface specifies four peripheral recurrent
modules, one central recurrent module, addressable memory of shape `2 x 6`,
and a variable candidate scorer. Its action vocabulary is
`inspect_section`, `select_candidate`, `finish`, and `report_missing`. Neural
selection is explicitly unavailable until a new document encoder, new
training, and a reviewed checkpoint exist. No existing gate output is mapped
to an arbitrary document tool.

## Frozen benchmark and Jev boundary

`v03_document_benchmark.py` builds the preregistration before training. Whole
document and template families are separated, instance overlap is forbidden,
document IDs and candidate order are randomized, and future test cases must
use unseen instances, layouts, and conflicts. The checked-in 9300–9302 seeds
are development protocol cases, not fresh generalization evidence.

The preregistered metrics are source-citation accuracy, verified success,
false completions, tool calls, missing-fact detection, and restart parity.

Inference costs (policy steps and model forward calls) are separate from
end-to-end action/server/wall-time costs. The Jev comparator is a typed
interface only in this branch: there are no live calls, credentials, or
invented results.

Training, evaluation sweeps, deployment, and external actions remain blocked
pending source review.
