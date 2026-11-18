import {createRoot} from 'react-dom/client';
import {UiLocaleProvider} from '../../app/_components/ui-locale';
import {DashboardShell} from '../../app/_components/dashboard';
import {WebsiteWorkspace} from '../../app/_components/website-workspace';
import {siteFixtures} from './fixtures.mjs';
import '../../app/users.css';
import '../../app/dashboard.css';
import '../../app/website.css';
const state=new URLSearchParams(location.search).get('state') ?? 'empty';
const model=siteFixtures[state] ?? siteFixtures.unavailable;
// This query selector exists only in this loopback test document, never in the app.
createRoot(document.getElementById('root')!).render(<UiLocaleProvider pageTitle="dashboard"><DashboardShell section="website"><WebsiteWorkspace model={model}/></DashboardShell></UiLocaleProvider>);
