/** Read-only public observations enter the same approved contract engine.
 * Metadata is provider-reported, not independently verified or an oracle. */
export function applyContractPublicEvidence({engine,records=[],now=Date.now()}) {
  const report={observed:0,pending:0,errors:[],byContract:Object.create(null)};
  if(!engine)return report;
  if(!Array.isArray(records)){report.errors.push('Public observations must be an array');return report;}
  for(const contract of engine.list()) {
    if(['completed','cancelled','expired'].includes(contract.status))continue;
    const result={observed:0,pending:0,errors:[]};
    report.byContract[contract.id]=result;
    for(const source of contract.terms.sources) {
      if(source.provider!=='public'||source.binding?.adapter!=='espn-result')continue;
      const candidates=records.filter(record=>record?.id===source.binding.eventId);
      if(candidates.length!==1){result.pending++;continue;}
      const record=candidates[0],observedAt=Date.parse(record.retrievedAt);
      if(record.providerAvailable!==true||record.liveFetch!==true||!/^https:\/\/(?:[a-z0-9-]+\.)*espn\.com(?:\/|$)/i.test(record.sourceUrl??'')) {
        result.errors.push(`${contract.title}: provider provenance is unavailable`);continue;
      }
      if(!Number.isFinite(observedAt)||observedAt>now||now-observedAt>Math.min(source.maxAgeMs,15*60_000)) {result.pending++;continue;}
      if(record.statusDetail?.completed!==true||record.statusDetail?.final!==true){result.pending++;continue;}
      const participants=record.participants??record.teams??[];
      if(!Array.isArray(participants)||participants.some(team=>!team||typeof team!=='object')){result.pending++;continue;}
      const names=participants.map(team=>String(team.name??'').trim().toUpperCase());
      if(participants.length!==2||names.some(name=>!name)||new Set(names).size!==2){result.pending++;continue;}
      const expected=contract.terms.prediction?.outcomes;
      if(expected&&(expected.length!==2||!expected.every(name=>names.includes(name)))) {
        result.errors.push(`${contract.title}: approved prediction outcomes must match both provider participant names`);continue;
      }
      const winners=participants.filter(team=>team.winner===true);
      let value;
      if(winners.length===1)value=String(winners[0].name).trim().toUpperCase();
      else if(winners.length===0&&participants.every(team=>team.winner===false&&typeof team.scoreValue==='number'&&Number.isFinite(team.scoreValue))&&participants[0].scoreValue===participants[1].scoreValue)value='DRAW';
      else {result.pending++;continue;}
      const id=`public:${contract.id}:${source.id}:${observedAt}`;
      if(contract.evidence.some(item=>item.id===id))continue;
      try {
        engine.observe({id,contractId:contract.id,source:source.id,provider:'public',value,observedAt,
          provenance:{adapter:'espn-result',eventId:record.id,url:record.sourceUrl}});
        result.observed++;
      } catch(error) {result.errors.push(`${contract.title}: ${error.message}`);}
    }
    report.observed+=result.observed;report.pending+=result.pending;report.errors.push(...result.errors);
  }
  return report;
}
