'use client';

import Link from 'vinext/shims/link';
import type {ComponentProps} from 'react';

// Protected routes are requested on navigation, without background prefetch.
export function WorkspaceLink(props: Omit<ComponentProps<typeof Link>, 'prefetch'>) {
  return <Link {...props} prefetch={false}/>;
}
