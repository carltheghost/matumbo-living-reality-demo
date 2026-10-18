# v0.3 document-evidence contract

This is a bounded protocol proof for a first real task. It is separate from
the continuous four-gate neural repair: the existing gate checkpoint has no
document competence and is not reused as a document policy.

## Task boundary

The server owns a six-document fixture bundle and exposes only stable
document handles and a section catalogue. A task contains two to six bundled
documents, at most four sections per document, two or three requested typed
fields, and a maximum action budget of 16. The initial request shows the field
identifiers, types, and revision rule. A policy must inspect sections, select
observed candidates explicitly, and either finish with an evidence packet or
report a missing field.

The fixture includes current, obsolete, conflicting-history, and irrelevant
facts. Section inspection returns typed raw values plus legitimate provenance:
opaque candidate ID, source field ID, server handle, section, type, revision
state, publication date, conflict group, source digest, and fact digest. It
does not return fact IDs, request-membership flags, targets, expected values,
raw documents, or filesystem paths. The in-memory evidence store retains the
raw value and complete provenance for verification.

Protocol admission requires requested/source field identifiers to fit 128
UTF-8 bytes and string values to fit 512 UTF-8 bytes; the neural encoder uses
those same widths and rejects overflow rather than truncating identity. Unicode
values within the admitted width are preserved. Document and fact publication
dates are ISO-8601 calendar dates, so verifier ranking and ordered date
features use the same parsed ordering.

## Verification and restart

The verifier rereads the manifest-addressed bytes before checking a packet. It
rejects changed bytes, forged values, forged citations, unselected candidates,
duplicate or incomplete packets, and non-latest or obsolete selections. The
`latest_non_obsolete` rule uses the authoritative current revision and
publication date, ignoring even higher obsolete revisions. Equal-ranked
differing values can be reported as an unresolved conflict with every winning
candidate and both verified citations. A missing-fact claim is valid only
after every task section has been explored. An early claim is reported as
inconclusive, not as proof of absence.

Each attempted action consumes one budget unit, and the session checks the
deadline before every next action. After exhaustion it returns a structured
`budget_exhausted` result without running further verification metrics. JSON
snapshots replay the action log against the same server-owned bytes and must
match exactly; changed source bytes invalidate restoration.

## Baselines and model status

The observation-limited deterministic expert sees only response dictionaries.
It prefers legitimate section kinds for requested types and explores all
remaining sections when it needs to prove absence; it inspects the complete
bounded task scope before a semantic completion. The read-all comparator
inspects every bounded section in catalog order. Neither baseline reads the
bundle privately or uses a hidden answer.

The separate document-policy interface specifies four peripheral recurrent
modules, one central recurrent module, addressable memory of shape `2 x 6`,
and a variable candidate scorer. Its action vocabulary is
`inspect_section`, `select_candidate`, `finish`, `report_missing`, and
`report_conflict`. The interface exposes the first request once, the latest
typed tool response, remaining budget, episode-local identity relations, an
addressable recurrent snapshot contract, and ordered date features. Neural
selection is explicitly unavailable until a new document encoder, new
training, and a reviewed checkpoint exist. No existing gate output is mapped
to an arbitrary document tool.

## Benchmark status, feasible first-model scope, and Jev boundary

`v03_document_benchmark.py` builds the preregistration before training. Whole
document and template families are separated and instance overlap is
forbidden. Seeded candidate order is implemented; randomized document IDs and
catalog order remain planned for a future generator. The checked-in 9300–9302
seeds are development protocol cases, not fresh generalization evidence. The
training generator and held-out task manifest are explicitly pending
implementation; proposed held-out seeds have no materialized outcomes and are
not labeled a frozen evaluation set.

The first neural document-policy task is deliberately smaller than the full
protocol maximum: at most two documents, four sections per document, two
requested fields, and four selected candidates. Exhaustive inspection therefore
costs at most 8 inspect actions + 4 select actions + 1 completion/verifier
action = 13 policy actions within the 16-action budget. The general six-document
maximum would cost 24 + 4 + 1 = 29 policy actions and is not used for first
model training. A trustworthy coverage-index variant is deferred until
explicitly declared and implemented.

The preregistered metrics are source-citation accuracy, verified success,
false completions, tool calls, missing-fact detection, and restart parity.

Inference costs (policy steps and model forward calls) are separate from
end-to-end action/server/wall-time/latency/monetary costs. Jev eligibility and
version are unverified; the comparator contract requires identical requests,
observations, legal actions, feedback, and history access, public or synthetic
data, fixed adapters, development-only tuning, zero retries, and declared
timeouts. There are no live calls, credentials, or invented results.

Training, evaluation sweeps, deployment, and external actions remain blocked
pending source review.
