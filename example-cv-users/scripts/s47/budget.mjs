// Counters include both the Workers ingress and the isolated database HTTP hop.
export function assertBudgetHeadroom(counts,limits,allocation,label='REQUEST'){
  for(const [kind,needed] of Object.entries(allocation)){
    if(!Number.isSafeInteger(needed)||needed<0||!Object.hasOwn(limits,kind))
      throw Error('INVALID_BUDGET_ALLOCATION');
    if(counts[kind]+needed>limits[kind])throw Error('BUDGET_'+label+'_'+kind.toUpperCase());
  }
}
