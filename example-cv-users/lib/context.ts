import { AsyncLocalStorage } from 'node:async_hooks';
export const requestContext = new AsyncLocalStorage<{
    failure?: 'network' | 'limited' | 'unavailable';
    user?: {
        id: string;
        email: string;
    };
}>();
