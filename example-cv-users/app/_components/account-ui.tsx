'use client';
import {UiText} from './ui-locale';
import {messages} from '../../lib/account/messages';

// A failed private SSR check has no identity to render. Keep the location
// reloadable when Auth was temporarily unavailable.
export function AccountUnavailable({failure}: {failure?: 'limited'|'network'|'unavailable'}) {
  const message = failure ? messages[failure] : messages.expiredSession;
  return <><p role="alert" className="feedback"><UiText text={message}/></p>
    <button type="button" className="outline-button" onClick={() => location.reload()}><UiText text="重新载入"/></button></>;
}
