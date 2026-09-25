# Example CV CMS — Stage 4F

This isolated admin app uses Supabase email/password authentication and the existing `public.is_resume_admin()` function to authorize access. After authorization, it loads the current `example-cv` resume. Profile has three separate production save boundaries: **Shared details** updates `resume_profile`; **Chinese** and **English** each update their existing row in `resume_profile_translations`. All other editor saves remain local drafts.

## Local setup

```sh
npm install
```

Create a local `.env.local` using `.env.example` as a template:

```dotenv
VITE_SUPABASE_URL=<project URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Use only the publishable key. Never put a service-role key, secret key, or database password in this browser app. `.env.local` is ignored by Git. The app shows a configuration message when either value is missing.

Run `npm run dev` and open the local URL printed by Vite. The app does not create users or reset passwords.

## Manual Stage 4F verification checklist

1. Start `resume-admin` with `npm run dev` and sign in as the allowlisted administrator.
2. Open **Profile** and note one harmless existing Chinese or English translation value.
3. Change only that value and click its language-specific **Save Chinese** or **Save English** button.
4. Confirm the success message for that language appears and its Save button becomes disabled.
5. Refresh the browser and confirm the changed value remains.
6. Optionally inspect the matching `resume_profile_translations` row in Supabase.
7. Restore the original value, save that language again, refresh, and verify restoration.
8. Confirm **Shared details** still has its separate production save. In another section, confirm **Save local draft** does not change Supabase.
9. Sign out and confirm production content disappears. Check that the browser console contains no credentials or tokens.

The shared Profile save writes only `graduation_value`, `avatar_initials`, `footer_name`, and `copyright`, filtered by the loaded `resume_id`. Each translation save updates only its seven Profile translation fields, filtered by both `resume_id` and `locale`. Chinese and English are separate requests, not one database transaction. If one succeeds and the other fails, the successful language keeps its confirmed baseline while the failed language retains its unsaved edits for retry. Missing translation rows cause an error; the app never creates them.

**Save local draft** in every other section stores the draft in memory only. It survives section navigation during that loaded session, but refresh and sign-out discard it and reload the production source. Old Stage 4B fixture session-storage keys are ignored; they are not deleted. If production loading fails, the app shows an error and Retry rather than showing fixtures.

## Checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Other production resume writes belong to later stages. The first translation mutation must be performed manually by the administrator; automated tests use mocks only.
