'use client';
import {useEffect, useState} from 'react';
import {messages, translate} from '../../lib/account/messages';
import {AccountShell, UiText} from './ui-locale';

export function DashboardUnavailable({failure}: {failure?: 'limited' | 'network' | 'unavailable'}) {
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const message = failure ? messages[failure] : messages.expiredSession;

  return <AccountShell>
    <section aria-labelledby="dashboard-unavailable-title">
      <h1 id="dashboard-unavailable-title">Example CV</h1>
      <p role="alert" className="feedback"><UiText text={message}/></p>
      <a className="button-link" href="/dashboard"><UiText text="重新载入"/></a>
      {!interactive && <details lang="en">
        <summary>English</summary>
        <p>{translate(message, 'en')}</p>
        <a href="/dashboard">{translate('重新载入', 'en')}</a>
      </details>}
    </section>
  </AccountShell>;
}
