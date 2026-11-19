import {AccountHome} from '../_components/account-home';
import {AccountUnavailable} from '../_components/account-ui';
import {AccountWorkspace} from '../_components/account-workspace';
import {requestContext} from '../../lib/context';
import '../account-management.css';
export default function AccountPage() {
  const ctx = requestContext.getStore();
  return <AccountWorkspace section="account">
    {ctx?.user ? <AccountHome user={ctx.user}/> : <AccountUnavailable failure={ctx?.failure}/>}
  </AccountWorkspace>;
}
