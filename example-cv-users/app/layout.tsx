import type {ReactNode} from 'react';
import {UiLocaleProvider, AccountShell} from './_components/ui-locale';
import {requestContext} from '../lib/context';
import './users.css';
import './dashboard.css';
export const dynamic = 'force-dynamic';
export default function Layout({children}: {children: ReactNode}) {
  const context = requestContext.getStore();
  const dashboard = context?.dashboard === true || (context?.accountWorkspace === true && !!context.user);
  return <html lang="zh-CN"><head><link rel="icon" href="data:,"/><title>{dashboard ? 'Example CV · Dashboard' : 'Example CV · 账户'}</title>
    <meta name="robots" content="noindex,nofollow"/></head>
    <body><UiLocaleProvider pageTitle={dashboard ? 'dashboard' : 'account'}>{dashboard ? children : <AccountShell clearDraftOnEntry={!context?.accountWorkspace}>{children}</AccountShell>}</UiLocaleProvider></body></html>;
}
