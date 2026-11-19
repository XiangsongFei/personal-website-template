import type {ReactNode} from 'react';
import {UiLocaleProvider, AccountShell} from './_components/ui-locale';
import {requestContext} from '../lib/context';
import './users.css';
import './dashboard.css';
export const dynamic = 'force-dynamic';
export default function Layout({children}: {children: ReactNode}) {
  const dashboard = requestContext.getStore()?.dashboard === true;
  return <html lang="zh-CN"><head><link rel="icon" href="data:,"/><title>{dashboard ? 'Example CV · Dashboard' : 'Example CV · 账户'}</title>
    <meta name="robots" content="noindex,nofollow"/></head>
    <body><UiLocaleProvider pageTitle={dashboard ? 'dashboard' : 'account'}>{dashboard ? children : <AccountShell>{children}</AccountShell>}</UiLocaleProvider></body></html>;
}
