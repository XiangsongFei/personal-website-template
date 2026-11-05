import {AccountUnavailable} from '../_components/account-ui';
import {ChangePasswordForm} from '../_components/change-password-form';
import {PageIntro, UiText} from '../_components/ui-locale';
import {requestContext} from '../../lib/context';
export default function ChangePasswordPage() {
  const ctx = requestContext.getStore();
  return <><PageIntro title="修改密码" description="确认当前密码，然后设置新密码。"/>
    {ctx?.user ? <ChangePasswordForm/> : <AccountUnavailable failure={ctx?.failure}/>}
    <a className="text-link" href="/account"><UiText text="返回账户"/></a></>;
}
