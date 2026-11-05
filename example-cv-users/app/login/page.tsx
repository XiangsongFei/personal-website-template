import { AccountForm } from '../_components/account-form';
import { PageIntro, UiText } from '../_components/ui-locale';
export default function LoginPage() {
  return <><PageIntro title="欢迎回来" description="登录以继续管理你的个人网站。" />
    <AccountForm mode="login" />
    <div className="account-links"><a href="/register"><UiText text="注册账号" /></a><a href="/forgot-password"><UiText text="忘记密码？" /></a></div></>;
}
