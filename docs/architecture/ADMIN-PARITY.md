# Administrator parity

**The rule.** Android and the web app have the same administrator features. Layout can differ, because a large screen fits more, but capabilities cannot. A new administrator feature ships to both apps in the same change. A web-only bulk action or export counts as a new feature and needs Android too.

`scripts/check_admin_parity.py` enforces the core of this. It fails when an `admin_*` database function is not called by both apps, or is missing from this page. It runs in the Android, web and database CI jobs.

Both apps call the same database functions, so the same action writes the same audit record, whichever app it came from.

## Capabilities

Android paths are under `android/app/src/main/java/com/motivance/`. Web paths are under `web/src/`.

| Capability | Backend | Android | Web | Android tests | Web tests | State |
| --- | --- | --- | --- | --- | --- | --- |
| Whole-system counts | `admin_summary` | `feature/admin/AdminOverview.kt` | `features/admin/AdminOverviewView.tsx` | `AdministrationRepositoryTest`, `test_administration.py` | `admin.spec.ts`, contract `admin.test.ts` | Done |
| Attention items that open their section | `admin_summary` | `feature/admin/AdminOverview.kt` | `features/admin/AdminOverviewView.tsx` | `AdministrationScreenTest` | `admin.spec.ts` | Done |
| Directory, 50 accounts at a time, server search | `admin_accounts` | `feature/admin/AdminAccounts.kt` | `features/admin/AccountsView.tsx`, `data/admin.ts` | `AdministrationViewModelTest`, `test_administration.py` | `admin.spec.ts`, `admin.test.ts` | Done |
| Filters: all, patients, therapists, Schedulers, administrators, disabled | Loaded accounts | `feature/admin/AdminAccounts.kt` | `features/admin/AccountsView.tsx` | `AdministrationScreenTest` | `admin.spec.ts` | Done |
| Enable or disable an account | `admin_set_account` | `feature/admin/AdminAccounts.kt` | `features/admin/AccountsView.tsx` | `AdministrationViewModelTest`, `test_administration.py` | `admin.spec.ts`, contract `admin.test.ts` | Done |
| Grant or remove the therapist, Scheduler and administrator roles | `admin_set_role` | `feature/admin/AdminAccounts.kt` | `features/admin/AccountsView.tsx` | `AdministrationViewModelTest`, `test_administration.py` | `admin.spec.ts`, contract `admin.test.ts` | Done |
| Remove another account's photo | `admin_clear_photo` | `feature/admin/AdminAccounts.kt` | `features/admin/AccountsView.tsx` | `AdministrationViewModelTest` | `admin.spec.ts`, contract `admin.test.ts` | Done |
| Copy an account ID | Loaded accounts | `feature/admin/AdminAccounts.kt` | `features/admin/AccountsView.tsx` | `AdministrationScreenTest` | `admin.spec.ts` | Done |
| No change to your own account, with the reason shown | `admin_set_account`, `admin_set_role` | `feature/admin/AdminAccounts.kt` | `features/admin/AccountsView.tsx` | `test_administration.py` | `admin.spec.ts`, contract `admin.test.ts` | Done |
| Links grouped by therapist, with filters | `admin_links` | `feature/admin/AdminLinks.kt` | `features/admin/LinksView.tsx` | `AdministrationScreenTest`, `test_administration.py` | `admin.spec.ts`, contract `admin.test.ts` | Done |
| Link, unlink and restore | `admin_set_link` | `feature/admin/AdminLinks.kt` | `features/admin/LinksView.tsx` | `AdministrationViewModelTest`, `test_administration.py` | `admin.spec.ts`, contract `admin.test.ts` | Done |
| Catalogue with therapists' exercises, up to 500 | Administrator row policy on `exercises` | `data/remote/SupabaseAuthRepository.kt` | `data/admin.ts` | `AdministrationRepositoryTest` | `admin.spec.ts`, contract `admin.test.ts` | Done |
| Activate or deactivate an exercise | `admin_set_exercise` | `feature/admin/AdminCatalogue.kt` | `features/admin/CatalogueView.tsx` | `AdministrationViewModelTest`, `test_administration.py` | `admin.spec.ts`, contract `admin.test.ts` | Done |
| Publish a new exercise version | `admin_publish_exercise` | `feature/admin/AdminCatalogue.kt` | `features/admin/CatalogueView.tsx` | `AdministrationViewModelTest`, `test_administration.py` | `admin.spec.ts`, contract `admin.test.ts` | Done |
| Activity feed, categories including bookings, older events, system label | `admin_activity` | `feature/admin/AdminActivity.kt` | `features/admin/ActivityView.tsx`, `data/admin.ts` | `AdministrationTest`, `test_administration.py` | `admin.spec.ts`, `admin.test.ts`, contract `admin.test.ts` | Done |
| A failed read clears loaded records | Client rule | `feature/admin/AdministrationViewModel.kt` | `features/admin/pages.tsx` | `AdministrationViewModelTest` | `admin.spec.ts` | Done |

The web app refreshes itself after every change and when you return to the tab, so it has no separate Refresh button. Android's Refresh does the same job.

## Gaps found while building the web pages

| Gap | Resolution |
| --- | --- |
| Android read only the first 100 exercises, so therapists' custom exercises could silently drop off the list | Both apps now read up to 500 |
| The web app had no wording for the "Role changed" audit event | Added, using Android's wording |
| The web link pickers offered disabled accounts and staff | They now match Android: active therapists, and active accounts with no staff role |

## Differences that are not capabilities

- **Layout.** The web app shows account details beside the table, and the overview puts its counts in two rows.
- **After a failed change.** Android clears loaded records. The web app reports the failure, then reloads the lists, which keeps an unpublished catalogue edit on screen. A failed read still clears account and link lists on both.
- **Changes in quick succession.** Android disables its buttons while saving. The web app runs them one after another, in order.
