// Offline component harness only; not imported by an application route.
import {siteViewModel,siteUnavailable} from '../../lib/site/model.ts';
const accountId='synthetic-account-only';
const receipt=extra=>({version:1,accountId,complete:true,...extra});
export const siteFixtures={
 loading:{state:'loading',source:'synthetic',creationEnabled:false},
 empty:siteViewModel(receipt({state:'empty',sites:[]}),accountId,'synthetic'),
 ready:siteViewModel(receipt({state:'ready',sites:[{siteId:'a1404a42-f2be-4d87-b863-2a79c8ff4a21',name:'Synthetic portfolio · 示例网站',slug:'synthetic-portfolio',contentLanguage:'en'}]}),accountId,'synthetic'),
 denied:siteViewModel(receipt({state:'denied'}),accountId,'synthetic'),
 revoked:siteViewModel(receipt({state:'revoked'}),accountId,'synthetic'),
 unavailable:siteUnavailable('synthetic','temporary'),
};
