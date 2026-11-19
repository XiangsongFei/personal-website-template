import {requestContext} from '../../lib/context';
import {Dashboard} from '../_components/dashboard';
import {DashboardUnavailable} from '../_components/dashboard-unavailable';

export default function DashboardPage() {
  const ctx = requestContext.getStore();
  // Only the Worker-verified S2 identity can render this workspace.
  // No user, site, grant or business data is fetched by this page.
  return ctx?.user ? <Dashboard/> : <DashboardUnavailable failure={ctx?.failure}/>;
}
