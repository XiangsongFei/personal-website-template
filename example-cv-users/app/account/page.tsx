import {VerifiedWorkspace} from '../_components/verified-workspace';
import {AccountUnavailable} from '../_components/account-ui';
import {AccountWorkspace} from '../_components/account-workspace';
import {requestContext} from '../../lib/context';
import '../account-management.css';
export default function AccountPage() {
  const ctx = requestContext.getStore();
  return <VerifiedWorkspace>{ctx?.user ? <AccountWorkspace section="account" email={ctx.user.email}/>
    : <AccountUnavailable failure={ctx?.failure}/>}</VerifiedWorkspace>;
}
