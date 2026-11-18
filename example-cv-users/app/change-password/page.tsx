import {AccountUnavailable} from '../_components/account-ui';
import {ChangePasswordForm} from '../_components/change-password-form';
import {AccountWorkspace} from '../_components/account-workspace';
import {requestContext} from '../../lib/context';
import '../account-management.css';
export default function ChangePasswordPage() {
  const ctx = requestContext.getStore();
  return <AccountWorkspace section="password">
    {ctx?.user ? <ChangePasswordForm/> : <AccountUnavailable failure={ctx?.failure}/>}
  </AccountWorkspace>;
}
