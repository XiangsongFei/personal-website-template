import { AccountForm } from '../_components/account-form';
import { PageIntro, UiText } from '../_components/ui-locale';
export default function VerifyPage() {
  return <><PageIntro title="验证邮箱" description="输入验证码，完成邮箱验证。" />
    <AccountForm mode="verify" />
    <div className="account-links"><a href="/register"><UiText text="更换邮箱" /></a><a href="/login"><UiText text="返回登录" /></a></div></>;
}
