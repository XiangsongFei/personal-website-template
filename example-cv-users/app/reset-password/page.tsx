import { ResetPasswordForm } from '../_components/reset-password-form';
import { PageIntro } from '../_components/ui-locale';
export const dynamic = 'force-dynamic';
export default function ResetPasswordPage() {
  return <><PageIntro title="重置密码" description="为你的账号设置一个新密码。" /><ResetPasswordForm /></>;
}
