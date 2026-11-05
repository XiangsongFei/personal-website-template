import {AccountHome} from '../_components/account-home';
import {AccountUnavailable} from '../_components/account-ui';
import {PageIntro} from '../_components/ui-locale';
import {requestContext} from '../../lib/context';
export default function AccountPage() {
  const ctx = requestContext.getStore();
  return <><PageIntro title="我的账户" description="查看登录状态，管理账户安全。"/>
    {ctx?.user ? <AccountHome user={ctx.user}/> : <AccountUnavailable failure={ctx?.failure}/>}</>;
}
