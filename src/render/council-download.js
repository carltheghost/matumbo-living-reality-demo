// Explicit portable evidence, never a network upload or a new receipt.
// Preserve the exact inner report bytes and original SHA-256 digest.
import { parseCouncilReport } from "../domains/provider-council-evidence.js";

export async function prepareCouncilDownload(envelope, { expectedDigest, cryptoApi=globalThis.crypto }={}) {
  let original;
  try { original=JSON.parse(JSON.stringify(envelope)); }
  catch { throw Error("Invalid provider council export."); }
  const report=await parseCouncilReport(original,{cryptoApi});
  if(expectedDigest!==undefined && original.reportSha256!==expectedDigest)
    throw Error("Evidence identity changed; no file was exported.");
  return Object.freeze({
    filename:"council-"+report.mode+"-"+original.reportSha256.slice(0,12)+".json",
    text:JSON.stringify(original,null,2)+"\n",
    digest:original.reportSha256,
  });
}

export function requestCouncilDownload(documentRoot, prepared) {
  const windowRoot=documentRoot?.defaultView;
  if(!windowRoot?.URL?.createObjectURL || !windowRoot?.Blob || !documentRoot.body)
    throw Error("File downloads are unavailable in this view.");
  const href=windowRoot.URL.createObjectURL(new windowRoot.Blob([prepared.text],{type:"application/json"}));
  const link=documentRoot.createElement("a");
  link.href=href;link.download=prepared.filename;link.hidden=true;
  try {
    documentRoot.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    windowRoot.setTimeout(()=>windowRoot.URL.revokeObjectURL(href),1000);
  }
}
