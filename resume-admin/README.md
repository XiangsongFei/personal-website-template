# Resume Admin

Resume Admin is the authenticated CMS for the published `example-cv` resume and the separate, unpublished Test resume. Owner and Test accounts are authorized for their own resume targets; their content and Activity Log data remain isolated. The Test account is used for future authenticated acceptance testing on the Production Admin website. There is no separate QA website or Admin QA Worker.

## Local development

Install dependencies from this directory:

```sh
npm install
```

For local development, copy `.env.example` to `.env.local` and set the Supabase URL and publishable key for the environment you are authorized to use:

```dotenv
VITE_SUPABASE_URL=<project URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Use only the publishable key in this browser app. Never put a service-role key, secret key, or database password in `.env.local`. The file is ignored by Git. If either setting is missing, the app shows a configuration message.

Start the local Vite development server with:

```sh
npm run dev
```

Local development and automated tests do not authorize Production writes. Do not use Owner content for acceptance testing. Perform future authenticated acceptance on the Production Admin website with the Test account, and obtain separate approval before making acceptance writes.

## Validation

Run these commands from this directory:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` runs the Admin frontend, repository, and Worker tests. The pull request workflow runs the full `npm test` suite, dependency audit, production build with synthetic CI-only Supabase settings, migration staging consistency checks, and the local Supabase SQL test lab. Follow the safety instructions in [the local RLS runtime lab](tests/rls-runtime/README.md) when running that lab locally; it uses a disposable local Supabase instance and synthetic data.

## Production data and features

- Owner and Test remain separate authorization targets. The Test resume is unpublished and must not be exposed through the Public Worker.
- Restore remains disabled. Activity Log and Version History remain available and must be preserved.
- Historical Profile images are retained so older history entries continue to display their images.
- Resume PDFs are uploaded for the selected Chinese or English locale and then saved as the corresponding resume file reference. Keep the selected file unchanged while resolving an uncertain upload or save result; retry and reconciliation depend on the original request and file.
- Profile images and Resume PDFs use the existing upload and save flows. This README does not authorize changing their retention, storage policies, or behavior.

## Production approvals

Each of these actions requires its own approval: merging a pull request, executing Production SQL, deploying the Admin Worker to Cloudflare, and performing authenticated acceptance writes on the Production Admin website. Use the existing reviewed migration and deployment records for those actions; this README adds no deployment procedure. Production automatic builds remain disabled. Deploy only the reviewed Production Admin Worker after its separate approval. Do not create or deploy a separate QA website or QA Worker.
