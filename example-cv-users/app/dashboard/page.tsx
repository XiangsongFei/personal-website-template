import {VerifiedWorkspace} from '../_components/verified-workspace';
import {readCurrentSiteStatus} from '../../lib/site/server';
import {requestContext} from '../../lib/context';
import {Dashboard} from '../_components/dashboard';
import {DashboardUnavailable} from '../_components/dashboard-unavailable';

export default async function DashboardPage() {
  const ctx = requestContext.getStore();
  // Only the Worker-verified S2 identity can render this workspace.
  // The site status adapter is closed until a trusted read service is available.
  return <VerifiedWorkspace>{ctx?.user ? <Dashboard site={await readCurrentSiteStatus(ctx.user.id)}/> : <DashboardUnavailable failure={ctx?.failure}/>}</VerifiedWorkspace>;
}
