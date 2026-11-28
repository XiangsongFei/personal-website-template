'use client';
import {WorkspaceLink} from './workspace-link';
import {AccountHome} from './account-home';
import {ChangePasswordForm} from './change-password-form';
import {DashboardIcon, DashboardShell} from './dashboard';
import {useUiLocale} from './ui-locale';

export function AccountWorkspace({section, email}: {section: 'account' | 'password'; email: string}) {
  const {t, locale} = useUiLocale();
  const password = section === 'password';
  return <DashboardShell section={section}>
    <div className={`account-workspace account-workspace-${section}`}>
      <div className="account-layout">
        <section className="account-overview" aria-labelledby="account-title">
          <h1 id="account-title" className="account-page-heading">{t('账户与安全')}</h1>
          <AccountHome email={email} passwordOpen={password}/>
        </section>
        {password && <section className="account-password-panel" aria-labelledby="account-password-title">
          <div className="account-password-heading">
            <h2 id="account-password-title" className="account-panel-title">{t('修改密码')}</h2>
            <WorkspaceLink className="dashboard-action dashboard-action-icon" href="/account"
              aria-label={locale === 'zh' ? '关闭修改密码' : 'Close password panel'}><DashboardIcon kind="close"/></WorkspaceLink>
          </div>
          <ChangePasswordForm/>
        </section>}
      </div>
    </div>
  </DashboardShell>;
}
