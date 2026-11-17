# Administrator backend status

Engineering review: Claude Code, 2026-11-17. Operations: [BACKEND-STATUS.md](../operations/BACKEND-STATUS.md). Parity: [ADMIN-PARITY.md](../architecture/ADMIN-PARITY.md).

## Delivered behavior

- `admin_backend()` (migration `202611170002_admin_backend_status.sql`) returns database and file storage use against the plan limits in `backend_plan` (seeded with the Free plan), the six largest tables, files by bucket, scheduled-job health, the notification queue, sign-ins, push phones and 14 days of sessions, messages, bookings and new accounts, counted in the center's time zone. Only sizes and counts; administrators only.
- Both overviews open with it: meters that turn amber at 75% and red at 90% with words saying so, ranked size bars, a health list with icons and words for anything that needs a look, and one column chart per daily series (no shared axis). The web chart answers pointing and arrow keys and has a table view; Android reads each chart's days to TalkBack.
- The section cards moved below the charts on both apps. The order is: backend status, attention items (with the role and coverage charts on the web), section cards, recent activity.
- If the status cannot be read, the rest of the overview still loads and says so.

## Executed tests

| Check | Result |
| --- | --- |
| `scripts/verify_backend_migrations.py` | Passed on a fresh replay |
| `supabase test db` | 99 passed |
| Web typecheck, lint, `npm test` | Clean; 306 passed, including `features/admin/backend.test.ts` |
| Web contract `tests/contract/admin.test.ts` | 17 passed, including the real status read and refusal for therapists and patients |
| Web `tests/e2e/admin.spec.ts`, one worker | 20 passed, including the new section, keyboard reading of a chart, the table view, the cards sitting below the charts, and the overview surviving a failed status read |
| Android `:app:assembleDebug :app:lintDebug :app:testDebugUnitTest :core:domain:test` | Passed, including `AdministrationRepositoryTest` (5) and `BackendStatusTest` (3) |
| `check_admin_parity.py`, `test_admin_parity.py`, `check_resources.py` | Passed; 11 administrator functions in both apps |

## Not executed

- The Android overview was not seen on a screen (no emulator; too little free memory with the local stack running). It is in the [follow-up checklist](POST-IMPLEMENTATION-CHECKLIST.md).
- The migration was applied to the hosted project on 2026-11-17 (`db push` after a dry run, read back with `migration list --linked`). The hosted overview has not been opened, and the live web app has not been redeployed. If the project is not on the Free plan, `backend_plan` still needs updating.
- `scripts/check_web_bundle.py` reports 325 KB against its 300 KB budget; it was 322 KB before the photo-storage change and 323 KB before this one.
