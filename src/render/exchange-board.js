import { EXCHANGE_PRICING_ASSETS, createUnavailableExchangeBoard, summarizeExchangeBoard } from "../domains/exchange-pricing.js";

export const EXCHANGE_BOARD_CONSOLE_SOURCE = "live-exchange-board";

const text = (value, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const money = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:Number(value)<1?6:2}) : "—";

function el(doc, tag, cls, value) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (value !== undefined) node.textContent = text(value);
  return node;
}
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (!value || typeof value !== "object") return value;
  Object.keys(value).forEach(key => freeze(value[key]));
  return Object.freeze(value);
}

export function createExchangeBoardConsole({
  documentRoot = globalThis.document,
  data = null,
  onRefresh = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
} = {}) {
  const panel = documentRoot?.getElementById?.("asset-market-console");
  if (!panel) throw new Error("Live Exchange Board console needs #asset-market-console");
  const closeButton = documentRoot.getElementById("asset-market-close");
  const refreshButton = documentRoot.getElementById("asset-market-refresh");
  const resetButton = documentRoot.getElementById("asset-market-reset");
  const statusEl = documentRoot.getElementById("asset-market-status");
  const summaryEl = documentRoot.getElementById("asset-market-summary");
  const queryEl = documentRoot.getElementById("asset-market-query");
  const currentEl = documentRoot.getElementById("asset-market-current");
  const sourcesEl = documentRoot.getElementById("asset-market-sources");
  const recordsEl = documentRoot.getElementById("asset-market-records");
  const traceEl = documentRoot.getElementById("asset-market-trace");
  const boundaryEl = documentRoot.getElementById("asset-market-boundary");
  if (![closeButton,refreshButton,resetButton,statusEl,summaryEl,queryEl,currentEl,sourcesEl,recordsEl,traceEl].every(Boolean)) {
    throw new Error("Live Exchange Board mount points are missing");
  }

  let board = summarizeExchangeBoard(data ?? createUnavailableExchangeBoard());
  let selectedId = board.assets?.[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let loading = false;
  let refreshCount = 0;
  let trace = [];

  const selected = () => board.assets?.find(asset => asset.id === selectedId) ?? board.assets?.[0] ?? null;
  const pushTrace = (entry) => {
    trace = [freeze({...entry, localOnly:true, simulation:true, externalNetwork:false, executable:false}), ...trace].slice(0,12);
  };

  function renderSummary() {
    summaryEl.replaceChildren();
    [
      [board.assetCount ?? EXCHANGE_PRICING_ASSETS.length,"assets"],
      [`${board.healthyAssetCount ?? 0}/${board.assetCount ?? 44}`,"4/4 source health"],
      [board.partialAssetCount ?? 0,"partial"],
      [board.unavailableAssetCount ?? 0,"unavailable"],
    ].forEach(([value,label]) => {
      const metric = el(documentRoot,"div","asset-market-metric");
      metric.append(el(documentRoot,"b","asset-market-metric-value",value),el(documentRoot,"span","asset-market-metric-label",label));
      summaryEl.append(metric);
    });
  }

  function renderSources() {
    sourcesEl.replaceChildren();
    (board.sources ?? []).forEach(source => {
      const row = el(documentRoot,"div",`asset-market-source ${source.status==="ready"?"asset-market-source-available":"asset-market-source-unavailable"}`);
      row.append(
        el(documentRoot,"strong","asset-market-source-title",source.label),
        el(documentRoot,"span","asset-market-source-meta",`${String(source.status).toUpperCase()} · ${source.observationCount ?? 0} OBSERVATIONS`),
        el(documentRoot,"span","asset-market-source-endpoint",source.base),
        el(documentRoot,"span","asset-market-source-reason",source.error ?? "Public spot observation adapter; no prediction-contract data is read here.")
      );
      sourcesEl.append(row);
    });
  }

  function renderRecords() {
    recordsEl.replaceChildren();
    (board.assets ?? []).forEach(asset => {
      const button = el(documentRoot,"button","asset-market-record");
      button.type="button";
      button.dataset.recordId=asset.id;
      button.setAttribute("aria-pressed",String(asset.id===selectedId));
      const sourceLabel = asset.sourceCount === 4 ? "4/4 SOURCES" : `${asset.sourceCount}/4 SOURCES`;
      button.append(
        el(documentRoot,"strong","asset-market-record-title",`${asset.symbol} · ${asset.name}`),
        el(documentRoot,"span","asset-market-record-meta",`REF USD ${money(asset.referencePriceUsd)} · BID ${money(asset.bidUsd)} · ASK ${money(asset.askUsd)}`),
        el(documentRoot,"span","asset-market-record-time",`${sourceLabel} · ${asset.status.toUpperCase()} · ${asset.outlierCount} OUTLIER(S)`)
      );
      button.addEventListener("click",()=>selectRecord(asset.id,"button"));
      recordsEl.append(button);
    });
  }

  function renderCurrent() {
    const asset = selected();
    currentEl.replaceChildren();
    if (!asset) {
      currentEl.append(el(documentRoot,"strong","asset-market-current-native","SELECT AN ASSET"));
    } else {
      const accepted = asset.acceptedObservations ?? [];
      const rejected = asset.rejectedObservations ?? [];
      currentEl.append(
        el(documentRoot,"strong","asset-market-current-native",`${asset.symbol} · SOURCES ${asset.sourceCount}/4 · ${asset.status.toUpperCase()}`),
        el(documentRoot,"strong","asset-market-current-title",`Reference: USD ${money(asset.referencePriceUsd)}`),
        el(documentRoot,"span","asset-market-current-price",`Bid: USD ${money(asset.bidUsd)} · Ask: USD ${money(asset.askUsd)} · Spread: USD ${money(asset.spreadUsd)}`),
        el(documentRoot,"span","asset-market-current-stats",`Accepted ${accepted.length} observations · Rejected ${rejected.length} outliers · venue range USD ${money(asset.venueSpreadUsd)}`),
        el(documentRoot,"span","asset-market-current-time",`UPDATED ${asset.updatedAt ?? "—"} · METHOD ${asset.priceMethod}`)
      );
      const obs = el(documentRoot,"div","asset-market-current-links");
      obs.append(el(documentRoot,"strong","asset-market-source-title","Source observations"));
      [...(asset.observations ?? [])].sort((a,b)=>a.source.localeCompare(b.source)).forEach(item=>{
        const rejectedMark = rejected.includes(item) ? " · FILTERED OUTLIER" : " · ACCEPTED";
        obs.append(el(documentRoot,"span","asset-market-source-reason",`${item.source}: USD ${money(item.priceUsd)} (${item.quoteCurrency})${rejectedMark}`));
      });
      currentEl.append(obs);
    }
    statusEl.textContent = loading
      ? "REFRESHING 4 PUBLIC EXCHANGES · NORMALIZING 44 ASSETS"
      : `LIVE EXCHANGE BOARD · ${board.assetCount ?? 44} ASSETS · ${board.healthyAssetCount ?? 0} HEALTHY · ${trace.length} LOCAL INSPECTIONS`;
    refreshButton.disabled=loading;
    resetButton.disabled=trace.length===0;
    queryEl.textContent = "SPOT ONLY · COINBASE / KRAKEN / BITSTAMP / BINANCE · REFERENCE = MEDIAN AFTER OUTLIER FILTER · PREDICTION CONTRACTS SEPARATE";
    if (boundaryEl) boundaryEl.textContent = board.boundary ?? "Spot exchange pricing only. Prediction contracts are maintained by a separate adapter-driven domain.";
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) { traceEl.append(el(documentRoot,"div","asset-market-empty","No inspection trace yet. Refresh the live board, then select an asset.")); return; }
    trace.forEach((entry,index)=>traceEl.append(el(documentRoot,"div","asset-market-trace-row",`${index+1} · ${String(entry.action).toUpperCase()} · ${entry.recordId ?? "board"} · LOCAL ONLY`)));
  }

  function render(){renderSummary();renderSources();renderRecords();renderCurrent();renderTrace();}

  function setOpen(next){opened=Boolean(next);panel.hidden=!opened;panel.classList?.toggle?.("visible",opened);panel.setAttribute?.("aria-hidden",String(!opened));}
  function selectRecord(recordId,method="button"){
    const asset=board.assets?.find(x=>x.id===recordId); if(!asset)return null;
    selectedId=recordId;
    const snapshot=freeze({source:EXCHANGE_BOARD_CONSOLE_SOURCE,action:"select",method,recordId,record:asset,summary:board});
    pushTrace({action:"select",recordId}); render(); onSelect?.(snapshot); return snapshot;
  }
  function replay(method="button"){
    const snapshot=freeze({source:EXCHANGE_BOARD_CONSOLE_SOURCE,action:"replay",method,recordId:selectedId,record:selected()});
    pushTrace({action:"replay",recordId:selectedId}); render(); onReplay?.(snapshot); return snapshot;
  }
  function reset(method="button"){
    selectedId=board.assets?.[0]?.id ?? null; trace=[];
    const snapshot=freeze({source:EXCHANGE_BOARD_CONSOLE_SOURCE,action:"reset",method,recordId:selectedId,summary:board});
    render(); onReset?.(snapshot); return snapshot;
  }
  async function refresh(method="button"){
    if(loading)return getSnapshot();
    loading=true; renderCurrent();
    try {
      board=summarizeExchangeBoard(await onRefresh?.({method,assetIds:EXCHANGE_PRICING_ASSETS.map(x=>x.id)}));
      selectedId=board.assets?.[0]?.id ?? null;
      refreshCount++; pushTrace({action:"refresh",refreshCount});
    } catch(error) {
      board=createUnavailableExchangeBoard(`Exchange refresh failed: ${text(error?.message ?? error,"unknown error")}`);
      selectedId=null; refreshCount++; pushTrace({action:"refresh-unavailable",refreshCount});
    } finally {loading=false;render();}
    return getSnapshot();
  }
  function setData(next){board=summarizeExchangeBoard(next);if(!board.assets?.some(x=>x.id===selectedId))selectedId=board.assets?.[0]?.id??null;render();return getSnapshot();}
  function getSnapshot(){return freeze({source:EXCHANGE_BOARD_CONSOLE_SOURCE,summary:board,selectedId,selectedRecord:selected(),opened,loading,refreshCount,trace,liveFetch:loading||board.status==="ready",localOnly:true,simulation:true,externalNetwork:false,executable:false});}

  closeButton.addEventListener("click",()=>setOpen(false));
  refreshButton.addEventListener("click",()=>refresh("button"));
  resetButton.addEventListener("click",()=>reset("button"));
  documentRoot.addEventListener?.("keydown",event=>{if(event.key==="Escape"&&opened)setOpen(false);});
  render(); setOpen(opened);
  return Object.freeze({open:()=>setOpen(true),close:()=>setOpen(false),toggle:()=>setOpen(!opened),refresh,selectRecord,replay,reset,setData,setProjection:setData,getSnapshot,destroy:()=>{}});
}
export default createExchangeBoardConsole;
