// Presentation projection only. This ViewModel is never an authorization credential.
export const ACCOUNT_SITE_LIMIT = 1;
export type SiteSummary = Readonly<{siteId: string; name?: string; slug?: string; contentLanguage?: 'zh' | 'en'}>;
export type SiteSource = 'not-connected' | 'trusted-service' | 'synthetic';
type Common = {source: SiteSource; creationEnabled: false};
export type SiteViewModel = Common & (
  {state: 'loading' | 'empty' | 'denied' | 'revoked'} |
  {state: 'ready'; sites: readonly SiteSummary[]} |
  {state: 'unavailable'; reason: 'not-connected' | 'temporary' | 'invalid-receipt'}
);

export function siteStatusTitle(model: SiteViewModel, locale: 'zh' | 'en') {
  const labels = {
    loading: {zh: '正在读取站点状态', en: 'Reading website status'},
    empty: {zh: '已确认没有网站', en: 'No website found'},
    ready: {zh: '我的网站', en: 'Your website'},
    denied: {zh: '暂无站点访问权限', en: 'Website access denied'},
    revoked: {zh: '建站资格已撤销', en: 'Website eligibility revoked'},
    unavailable: model.state === 'unavailable' && model.reason === 'not-connected'
      ? {zh: '站点服务尚未接入', en: 'Website service is not connected'}
      : {zh: '暂时无法读取站点状态', en: 'Website status is unavailable'},
  };
  return labels[model.state][locale];
}

// Proposed application port, not the S3 wire schema and not an enabled API.
export type SiteReadReceipt = {
  version: 1; accountId: string; complete: true;
} & ({state: 'empty'; sites: []} | {state: 'ready'; sites: SiteSummary[]} | {state: 'denied' | 'revoked'});
export type SiteStatusReader = {readForCurrentAccount: () => Promise<unknown>};
export type SiteCreationIntent = {name: string; slug: string; contentLanguage: 'zh' | 'en'; initialTemplate: 'minimal-resume'};
// Future server-scoped implementation must recheck eligibility, ownership, capacity,
// operation/payload binding and UNKNOWN reconciliation. No implementation is exported.
export type SiteCreationPort = {
  createForCurrentAccount(command: {intent: SiteCreationIntent; operationId: string}): Promise<
    {state: 'created'; siteId: string; operationId: string} |
    {state: 'denied' | 'revoked' | 'unavailable' | 'capacity-reached'} |
    {state: 'unknown'; operationId: string}
  >;
};
// Local syntax guidance mirrors the frozen candidate; it is not an availability check.
const reservedSiteSlugs = new Set(['admin','cms-admin','www','api','auth','hr','mail','support','static','assets']);
export const validSiteSlug = (value: string) => /^[a-z][a-z0-9-]{1,46}[a-z0-9]$/.test(value) && !reservedSiteSlugs.has(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const siteUnavailable = (source: SiteSource = 'not-connected', reason: 'not-connected' | 'temporary' | 'invalid-receipt' = 'not-connected'): SiteViewModel => ({state: 'unavailable', source, reason, creationEnabled: false});

// Only a trusted, authenticated server adapter may supply a receipt. Schema checks
// are fail-closed validation, not proof that an arbitrary object is authoritative.
export function siteViewModel(receipt: unknown, accountId: string, source: 'trusted-service' | 'synthetic'): SiteViewModel {
  const invalid = () => siteUnavailable(source, 'invalid-receipt');
  try {
    if (!accountId || !record(receipt) || receipt.version !== 1 || receipt.accountId !== accountId || receipt.complete !== true) return invalid();
    const common = {source, creationEnabled: false as const};
    if (receipt.state === 'denied' || receipt.state === 'revoked') return {...common, state: receipt.state};
    if (!Array.isArray(receipt.sites)) return invalid();
    if (receipt.state === 'empty' && receipt.sites.length === 0) return {...common, state: 'empty'};
    if (receipt.state !== 'ready' || receipt.sites.length !== ACCOUNT_SITE_LIMIT) return invalid();
    const sites: SiteSummary[] = [];
    for (const site of receipt.sites) {
      if (!record(site) || !uuid(site.siteId) ||
        (site.name !== undefined && (typeof site.name !== 'string' || !site.name.trim() || site.name.length > 80)) ||
        (site.slug !== undefined && (typeof site.slug !== 'string' || !validSiteSlug(site.slug))) ||
        (site.contentLanguage !== undefined && !['zh', 'en'].includes(String(site.contentLanguage)))) return invalid();
      sites.push({siteId: site.siteId, ...(site.name === undefined ? {} : {name: String(site.name)}), ...(site.slug === undefined ? {} : {slug: String(site.slug)}), ...(site.contentLanguage === undefined ? {} : {contentLanguage: site.contentLanguage as 'zh' | 'en'})});
    }
    return {...common, state: 'ready', sites};
  } catch {return invalid();}
}
