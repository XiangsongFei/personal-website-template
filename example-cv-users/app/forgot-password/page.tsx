import { RecoveryRequestForm } from '../_components/recovery-otp-form';
import { PageIntro, UiText } from '../_components/ui-locale';
export const dynamic = 'force-dynamic';
export default function ForgotPasswordPage() {
  return <><PageIntro title="忘记密码" description="输入邮箱，获取重置密码的下一步说明。" />
    <RecoveryRequestForm /><a className="text-link" href="/login"><UiText text="返回登录" /></a></>;
}
