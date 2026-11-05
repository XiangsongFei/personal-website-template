import { AccountForm } from '../_components/account-form';
import { PageIntro, UiText } from '../_components/ui-locale';
export default function RegisterPage() {
  return <><PageIntro title="创建你的账号" description="从一个账号开始，准备你的个人网站。" />
    <AccountForm mode="signup" />
    <p className="footnote"><UiText text="已有账号？" /> <a href="/login"><UiText text="登录" /></a></p></>;
}
