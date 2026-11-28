import type {ReactNode} from 'react';
import {requestContext} from '../../lib/context';
import {WorkspaceDraftScope} from './workspace-draft';

export function VerifiedWorkspace({children}: {children: ReactNode}) {
  const ctx = requestContext.getStore();
  return <WorkspaceDraftScope scope={ctx?.workspaceDraftScope} path={ctx?.workspacePath} unavailable={!!ctx?.failure}>{children}</WorkspaceDraftScope>;
}
