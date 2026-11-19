import {requestContext} from '../../lib/context';
import {AccountUnavailable} from '../_components/account-ui';
import {Dashboard} from '../_components/dashboard';

export default function DashboardPage() {
  const ctx = requestContext.getStore();
  // Only the Worker-verified S2 identity can render this workspace.
  // No user, site, grant or business data is fetched by this page.
  return ctx?.user ? <Dashboard/> : <section className="dashboard-unavailable">
    <h1>Example CV</h1><AccountUnavailable failure={ctx?.failure}/>
  </section>;
}
