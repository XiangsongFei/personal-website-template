import { AsyncLocalStorage } from 'node:async_hooks';
export const requestContext = new AsyncLocalStorage<{
    dashboard?: boolean;
    failure?: 'network' | 'limited' | 'unavailable';
    user?: {
        id: string;
        email: string;
    };
}>();
