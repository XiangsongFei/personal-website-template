import { AsyncLocalStorage } from 'node:async_hooks';
import type {SiteViewModel} from './site/model.ts';
export const requestContext = new AsyncLocalStorage<{
    dashboard?: boolean;
    introduction?: boolean;
    readSite?: () => Promise<SiteViewModel>;
    workspaceDraftScope?: string;
    workspacePath?: string;
    accountWorkspace?: boolean;
    failure?: 'network' | 'limited' | 'unavailable';
    user?: {
        id: string;
        email: string;
    };
}>();
