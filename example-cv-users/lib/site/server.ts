// Imported only by the protected server page. No S3 candidate or Supabase client
// is wired here; S2 authentication does not establish a business grant.
import {siteUnavailable, siteViewModel, type SiteStatusReader, type SiteViewModel} from './model.ts';

export async function readWithSiteAdapter(accountId: string, reader: SiteStatusReader): Promise<SiteViewModel> {
  try {return siteViewModel(await reader.readForCurrentAccount(), accountId, 'trusted-service');}
  catch {return siteUnavailable('trusted-service', 'temporary');}
}

export async function readCurrentSiteStatus(_verifiedAccountId: string): Promise<SiteViewModel> {
  // Deliberately closed until the real read service and authorization are accepted.
  return siteUnavailable();
}
