import {VerifiedWorkspace} from '../../_components/verified-workspace';
import {requestContext} from '../../../lib/context';
import {readCurrentSiteStatus} from '../../../lib/site/server';
import {DashboardShell} from '../../_components/dashboard';
import {WebsiteWorkspace} from '../../_components/website-workspace';
import {AccountUnavailable} from '../../_components/account-ui';
import '../../website.css';

export default async function WebsitePage() {
  const ctx = requestContext.getStore();
  if (!ctx?.user) return <VerifiedWorkspace><section className="dashboard-unavailable"><h1>Example CV</h1><AccountUnavailable failure={ctx?.failure}/></section></VerifiedWorkspace>;
  const model = await (ctx.readSite?.() ?? readCurrentSiteStatus(ctx.user.id));
  return <VerifiedWorkspace><DashboardShell section="website"><WebsiteWorkspace model={model}/></DashboardShell></VerifiedWorkspace>;
}
