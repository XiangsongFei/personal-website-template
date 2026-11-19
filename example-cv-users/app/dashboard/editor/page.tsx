import {requestContext} from '../../../lib/context';
import {AccountUnavailable} from '../../_components/account-ui';
import {ResumeEditor} from '../../_components/resume-editor';
import '../../editor.css';

export default function EditorPage() {
  const ctx = requestContext.getStore();
  if (!ctx?.user) {
    return <section className="dashboard-unavailable">
      <h1>Example CV</h1><AccountUnavailable failure={ctx?.failure}/>
    </section>;
  }
  return <ResumeEditor/>;
}
