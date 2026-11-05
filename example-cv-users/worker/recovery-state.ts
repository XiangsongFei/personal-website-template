import { DurableObject } from 'cloudflare:workers';
import type { UsersEnv } from '../lib/config';
import { ATTEMPT_SECONDS, MAX_ATTEMPTS, TRANSACTION_SECONDS, RESEND_SECONDS, GRANT_SECONDS } from '../lib/account/policy';

type AttemptBudget = { times: number[]; expires: number } | { until: number; count: number };
const windowMs = ATTEMPT_SECONDS * 1000;
const txMs = TRANSACTION_SECONDS * 1000;
const grantMs = GRANT_SECONDS * 1000;
// One stable object per normalized account. SQL is the source of truth; no Map.
// No password, OTP, email or session credential is stored in this object.
export class RecoveryState extends DurableObject<UsersEnv> {
    constructor(ctx: DurableObjectState, env: UsersEnv) {
        super(ctx, env);
        ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    }
    #read<T>(key: string): T | undefined {
        const r = this.ctx.storage.sql.exec<{
            value: string;
        }>('SELECT value FROM state WHERE key=?', key).toArray()[0];
        return r ? JSON.parse(r.value) : undefined;
    }
    #write(key: string, value: unknown) { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO state VALUES (?,?)', key, JSON.stringify(value)); }
    #remove(key: string) { this.ctx.storage.sql.exec('DELETE FROM state WHERE key=?', key); }
    async #atomic<T>(fn: () => T) {
        const value = this.ctx.storage.transactionSync(fn);
        await this.ctx.storage.sync();
        if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 2 * txMs);
        return value;
    }
    async rate(kind: string, limit: number, window: number) {
        return this.#atomic(() => {
            const now = Date.now(), key = 'rate:' + kind;
            const old = this.#read<{
                until: number;
                count: number;
            }>(key);
            const row = old && old.until > now ? old : { until: now + window, count: 0 };
            if (row.count >= limit)
                return false;
            row.count++;
            this.#write(key, row);
            return true;
        });
    }
    #attempts(now: number): number[] {
        const row = this.#read<AttemptBudget>('attempts');
        if (!row) return [];
        if ('times' in row) return row.times.filter(t => t + windowMs > now);
        // Old fixed-window rows have no individual timestamps. Honor their
        // recorded count through their original deadline on first access.
        return row.until > now ? Array(row.count).fill(row.until - windowMs) : [];
    }
    #transactions() {
        return this.ctx.storage.sql.exec<{key: string; value: string}>(
            "SELECT key,value FROM state WHERE key LIKE 'tx:%'"
        ).toArray().map(r => ({key: r.key, tx: JSON.parse(r.value) as Tx}));
    }
    async beginSend(id: string) {
        return this.#atomic(() => {
            const now = Date.now();
            const last = this.#read<number>('lastSend') ?? 0;
            if (now - last < RESEND_SECONDS * 1000 || this.#attempts(now).length >= MAX_ATTEMPTS) return false;
            if (this.#transactions().some(({tx}) =>
                tx.expires > now && (tx.state === 'sending' || tx.state === 'verifying'))) return false;
            this.#write('lastSend', now);
            this.#write('tx:' + id, {state: 'sending', expires: now + txMs});
            return true;
        });
    }
    // Read-only. A refresh never starts a send, verifies a code or consumes a grant.
    progress(id: string) {
        const now = Date.now();
        const tx = this.#read<Tx>('tx:' + id);
        if (!tx || tx.expires <= now) return null;
        const last = this.#read<number>('lastSend') ?? 0;
        return {phase: tx.state, retryAfter: Math.max(0, Math.ceil((last + RESEND_SECONDS * 1000 - now) / 1000))};
    }
    async finishSend(id: string, accepted: boolean) {
        return this.#atomic(() => {
            const tx = this.#read<Tx>('tx:' + id);
            if (!tx || tx.state !== 'sending' || tx.expires <= Date.now())
                return false;
            if (!accepted) {
                this.#remove('tx:' + id);
                return false;
            }
            for (const old of this.#transactions()) {
                if (old.tx.state === 'ready' && old.key !== 'tx:' + id) this.#remove(old.key);
            }
            tx.state = 'ready';
            this.#write('tx:' + id, tx);
            return true;
        });
    }
    async beginVerify(id: string) {
        return this.#atomic(() => {
            const now = Date.now(), tx = this.#read<Tx>('tx:' + id);
            if (!tx || tx.expires <= now || tx.state !== 'ready')
                return 'missing';
            const attempts = this.#attempts(now);
            if (attempts.length >= MAX_ATTEMPTS) return 'limited';
            attempts.push(now);
            this.#write('attempts', {times: attempts, expires: now + windowMs});
            tx.state = 'verifying';
            this.#write('tx:' + id, tx);
            return 'accepted';
        });
    }
    async finishVerify(id: string, retry: boolean) {
        return this.#atomic(() => {
            const tx = this.#read<Tx>('tx:' + id);
            if (tx?.state === 'verifying') {
                if (retry) {
                    tx.state = 'ready';
                    this.#write('tx:' + id, tx);
                }
                else
                    this.#remove('tx:' + id);
            }
        });
    }
    async issue(id: string, hash: string, user: string, session: string) {
        return this.#atomic(() => {
            const tx = this.#read<Tx>('tx:' + id);
            if (!tx || tx.state !== 'verifying' || tx.expires <= Date.now())
                return false;
            tx.state = 'verified';
            tx.expires = Date.now() + grantMs;
            this.#write('tx:' + id, tx);
            this.#write('grant:' + hash, { tx: id, user, session, expires: tx.expires, status: 'ready' });
            return true;
        });
    }
    async grant(hash: string, tx: string, user?: string, session?: string, consume = false) {
        return this.#atomic(() => {
            const row = this.#read<Grant>('grant:' + hash);
            if (consume && (!user || !session))
                return false;
            if (!row || row.status !== 'ready' || row.expires <= Date.now() || row.tx !== tx || user !== undefined && row.user !== user || session !== undefined && row.session !== session)
                return false;
            if (consume) {
                row.status = 'attempted';
                this.#write('grant:' + hash, row);
            }
            return true;
        });
    }
    async finish(hash: string, outcome: 'updated' | 'rejected' | 'unknown') {
        return this.#atomic(() => {
            const row = this.#read<Grant>('grant:' + hash);
            if (row?.status === 'attempted') {
                row.status = outcome;
                this.#write('grant:' + hash, row);
            }
        });
    }
    async revoke(hash: string) {
        return this.#atomic(() => {
            const row = this.#read<Grant>('grant:' + hash);
            if (row) {
                row.status = 'revoked';
                this.#write('grant:' + hash, row);
            }
        });
    }
    async cancelTransaction(id: string) {
        return this.#atomic(() => {
            this.#remove('tx:' + id);
            // Also revoke a verified transaction if the grant cookie was lost.
            for (const r of this.ctx.storage.sql.exec<{key: string; value: string}>(
                "SELECT key,value FROM state WHERE key LIKE 'grant:%'").toArray()) {
                const row = JSON.parse(r.value) as Grant;
                if (row.tx === id && row.status === 'ready') {
                    this.#write(r.key, {...row, status: 'revoked'});
                }
            }
        });
    }
    async claimChange(session: string, operation: string) {
        return this.#atomic(() => {
            const now = Date.now();
            const key = 'change:' + session;
            const attemptKey = key + ':' + operation;
            if ((this.#read<{expires: number}>(key)?.expires ?? 0) > now ||
                (this.#read<{expires: number}>(attemptKey)?.expires ?? 0) > now) return false;
            const claim = {operation, expires: now + grantMs};
            this.#write(key, claim);
            this.#write(attemptKey, claim);
            return true;
        });
    }
    async finishKnownChange(session: string, operation: string) {
        return this.#atomic(() => {
            // Retain the operation tombstone. Only a new explicit submission
            // may proceed after a definitive receipt. UNKNOWN never reaches here.
            const key = 'change:' + session;
            if (this.#read<{operation: string}>(key)?.operation === operation) this.#remove(key);
        });
    }
    async alarm() {
        const now = Date.now();
        for (const r of this.ctx.storage.sql.exec<{
            key: string;
            value: string;
        }>('SELECT key,value FROM state')) {
            const v = JSON.parse(r.value);
            if (typeof v === 'object' && (v.expires ?? v.until ?? Infinity) <= now || r.key === 'lastSend' && v + txMs < now)
                this.#remove(r.key);
        }
        if (this.ctx.storage.sql.exec('SELECT key FROM state LIMIT 1').toArray().length)
            await this.ctx.storage.setAlarm(now + txMs);
    }
}
type Tx = {
    state: 'sending' | 'ready' | 'verifying' | 'verified';
    expires: number;
};
type Grant = {
    tx: string;
    user: string;
    session: string;
    expires: number;
    status: string;
};
