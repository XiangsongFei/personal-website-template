import {PageIntro, UiText} from '../../_components/ui-locale';
export default function CallbackPage() {
  return <><PageIntro title="返回账户流程" description="请在发起操作的浏览器输入邮件中的验证码。"/>
    <div className="account-links"><a href="/login"><UiText text="返回登录"/></a>
    <a href="/forgot-password"><UiText text="忘记密码"/></a></div></>;
}
