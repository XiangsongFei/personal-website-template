import {requestContext} from '../../../lib/context';
import {DashboardShell} from '../../_components/dashboard';
import {WebsiteWorkspace} from '../../_components/website-workspace';
import {AccountUnavailable} from '../../_components/account-ui';
import '../../website.css';

export default function WebsiteLoading() {
  const ctx = requestContext.getStore();
  return ctx?.user ? <DashboardShell section="website"><WebsiteWorkspace model={{state:'loading',source:'not-connected',creationEnabled:false}}/></DashboardShell> : <AccountUnavailable failure={ctx?.failure}/>;
}
