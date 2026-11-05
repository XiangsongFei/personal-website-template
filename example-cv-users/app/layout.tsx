import type {ReactNode} from 'react';
import {UiLocaleProvider, AccountShell} from './_components/ui-locale';
import './users.css';
export const dynamic = 'force-dynamic';
export default function Layout({children}: {children: ReactNode}) {
  return <html lang="zh-CN"><head><link rel="icon" href="data:,"/><title>Example CV · 账户</title>
    <meta name="robots" content="noindex,nofollow"/></head>
    <body><UiLocaleProvider><AccountShell>{children}</AccountShell></UiLocaleProvider></body></html>;
}
