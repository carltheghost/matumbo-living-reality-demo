/**
 * Launch Rehearsal Receipt.
 *
 * This is a deterministic, renderer-only receipt for the existing fictional
 * TUMBO-SIM launch/distribution projection.  It joins the canonical registry
 * rows to exact fixed-supply reconciliation fields so a viewer can inspect
 * what the demo rehearsed without confusing the result for an issued asset,
 * a transfer, a wallet receipt, or a real-world distribution.
 *
 * The adapter deliberately has no arbitrary file-import, network, clipboard,
 * provider, or executable-code path. Receipt JSON is accepted only as
 * in-memory data and is copied through a descriptor-safe validator before it
 * is retained. The optional Download JSON action is a user-triggered browser
 * export of that validated text; it does not import files, persist app state,
 * or share anything externally.
 */
import { DEFAULT_LAUNCH_DISTRIBUTION_PREVIEW } from "../domains/distribution-registry.js";
import { summarizeLaunchDistribution } from "./launch-console.js";
import {
  DEMO_REHEARSAL_SUPPLY_UNITS,
  TUMBO_TOTAL_BASIS_POINTS,
  TUMBO_PUBLIC_COMMITMENT,
} from "../domains/token-config.js";

export const LAUNCH_RECEIPT_CONSOLE_SOURCE = "launch-rehearsal-receipt-console";
export const LAUNCH_RECEIPT_SOURCE = "launch-rehearsal-receipt";
export const LAUNCH_RECEIPT_RENDER_SOURCE = LAUNCH_RECEIPT_CONSOLE_SOURCE;
export const LAUNCH_RECEIPT_SCHEMA_VERSION = 1;
export const LAUNCH_RECEIPT_DOWNLOAD_FILENAME = "matumbo-tumbo-sim-launch-rehearsal-receipt.json";
export const LAUNCH_RECEIPT_SEQUENCE = Object.freeze([
  "launch-event",
  "allocation-cohorts",
  "basis-point-reconciliation",
  "local-boundary",
]);
export const LAUNCH_RECEIPT_BOUNDARY =
  "Launch Rehearsal Receipt is a deterministic TUMBO-SIM projection only; it does not issue or distribute a real asset, custody value, connect a wallet, sign, transfer, exchange, persist app state, contact a network, or execute code. Download JSON is an optional user-triggered local browser export only; it does not import files or share externally. Simulated points only — never real money or wagering.";

/** Stable mount ids for a host page that wants to wire the optional console. */
export const LAUNCH_RECEIPT_DOM_IDS = Object.freeze({
  panel: "launch-receipt-console",
  close: "launch-receipt-close",
  replay: "launch-receipt-replay",
  reset: "launch-receipt-reset",
  download: "launch-receipt-download",
  status: "launch-receipt-status",
  summary: "launch-receipt-summary",
  current: "launch-receipt-current",
  cohorts: "launch-receipt-cohorts",
  reconciliation: "launch-receipt-reconciliation",
  json: "launch-receipt-json",
  trace: "launch-receipt-trace",
  boundary: "launch-receipt-boundary",
});

const TOTAL_BASIS_POINTS = TUMBO_TOTAL_BASIS_POINTS;
const DEFAULT_TOTAL_SUPPLY = DEMO_REHEARSAL_SUPPLY_UNITS;
const MAX_RECEIPT_TEXT_LENGTH = 256_000;
const MAX_COHORTS = 64;
// NOTE: Remainder of file intentionally truncated in this restore commit;
// full body restored in follow-up. This placeholder keeps imports valid.
export function createLaunchRehearsalReceipt() {
  return Object.freeze({
    schemaVersion: LAUNCH_RECEIPT_SCHEMA_VERSION,
    source: LAUNCH_RECEIPT_SOURCE,
    boundary: LAUNCH_RECEIPT_BOUNDARY,
    publicCommitment: TUMBO_PUBLIC_COMMITMENT,
    totalSupply: DEFAULT_TOTAL_SUPPLY,
    simulation: true,
  });
}
export const createLaunchReceipt = createLaunchRehearsalReceipt;
export const DEFAULT_LAUNCH_REHEARSAL_RECEIPT = createLaunchRehearsalReceipt();
export default createLaunchRehearsalReceipt;
