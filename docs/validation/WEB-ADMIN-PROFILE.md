# Administrator workspace and staff profiles

Date: 2026-11-05. Local engineering evidence for MOT-43 to MOT-46: a development machine, a headless browser and the local Supabase stack. No administrator has used these screens, and nothing here is clinical validation.

## What exists

| Issue | Delivered |
| --- | --- |
| MOT-43 | The parity rule, [ADMIN-PARITY.md](../architecture/ADMIN-PARITY.md), and `scripts/check_admin_parity.py` with its own test |
| MOT-44 | Overview and account management on live data |
| MOT-45 | Links, catalogue and activity on live data |
| MOT-46 | A profile page for therapists and administrators: details, photo and password |

## Results

| Check | Result |
| --- | --- |
| Type check and lint | Clean |
| Unit tests | 169 passed |
| Contract tests on the local Supabase stack | 32 passed |
| Browser tests | All passed, on-demand captures and frame-rate tests skipped |
| Android administrator and web prescription tests | 17 passed |
| Parity check | 10 functions called by both apps, and the check's own test passes |
| Initial JavaScript | 293 KB compressed, budget 300 KB |

**CI has not run this work.** GitHub Actions cannot start jobs while the account is locked over billing. The owner decided not to depend on it, because the account is on GitHub's free tier. MOT-43-AC3 asks for the parity check to run in CI, so that criterion is recorded as deferred, not passed.

## Acceptance evidence

| Criterion | Proven by |
| --- | --- |
| MOT-43-AC1 | [ADMIN-PARITY.md](../architecture/ADMIN-PARITY.md) |
| MOT-43-AC2 | `check_admin_parity.py`, `test_admin_parity.py` |
| MOT-43-AC3 | **Deferred, not passed.** The step is in `web-ci.yml`, `android-ci.yml` and `database-ci.yml`, but no job can start. It passes locally |
| MOT-43-AC4 | `AGENTS.md`, `docs/PLAN.md` |
| MOT-43-AC5 | The gaps section of the matrix |
| MOT-44-AC1, AC2 | `the overview shows every count and leads to each section`, contract `counts the whole system, not one page` |
| MOT-44-AC3 | `the directory searches the server…`, `filters narrow the loaded accounts`, contract search test, paging unit tests |
| MOT-44-AC4 | `a role is granted and removed…`, `a disabled account shows why…`, `another account's photo can be removed…` |
| MOT-44-AC5 | `an administrator cannot change their own account…`, contract `needs an active account before changing its roles` |
| MOT-44-AC6 | `a failed read clears the list…`, contract `refuses every administrator function to anyone else` |
| MOT-45-AC1 | `a link is made, revoked and restored…`, `a picker refuses text that is not an account`, `who can be linked` |
| MOT-45-AC2, AC3 | `the catalogue lists therapists' exercises…`, `a failed publish keeps the draft open`, `an exercise can be deactivated…` |
| MOT-45-AC4 | `activity uses Android's wording…`, the audit wording unit tests, contract `pages through activity…` |
| MOT-45-AC5 | The matrix, and both apps call the same database functions. Contract tests check the audit records for the web's calls |
| MOT-46-AC1 | `each field explains its own rule…`, `saving updates the name across the app`, `profile rules match PatientProfile.kt`, contract `saves details through save_my_profile…` |
| MOT-46-AC2 | `a photo is prepared as a square JPEG…`. The real database functions sign and verify with throwaway Vault secrets. Only Cloudinary's own endpoint is stood in for |
| MOT-46-AC3 | `a photo can be removed…` |
| MOT-46-AC4 | `the password needs the current one…`, `the new password works…`, `the session keeps working after a password change…` |

## What review and testing found

| Problem | Effect | Fix |
| --- | --- | --- |
| Changing a password ended the session in use | The page said it worked, then the user was signed out when the access token next refreshed | The app adopts the session that made the change, as Android does |
| A second change made while the first was saving was dropped | An administrator could believe access had been removed when it had not | Changes now run one after another |
| A failed publish discarded the draft | Up to 8000 characters of instructions lost | The editor stays open with the draft |
| The link pickers offered disabled accounts and staff | The server refused the link with a generic error | They match Android |
| Links could only pick from the first 50 accounts | Later accounts needed a pasted ID | The form can load more accounts |
| The 500-link notice could never appear | Links past the limit disappeared silently | The check now fires at the limit |
| Android read only 100 exercises | Custom exercises could drop off the list | Both apps read up to 500 |
| The parity check accepted a name that was only the start of a real call, kept dropped functions, ignored capitals and could skip files because of the checkout folder | False passes and false failures | All fixed, each with a test |

## Known limits

- Android and the web both reject `Ma. Teresa`, because their name rule does not allow a period followed by a space. The owner confirmed on 2026-11-05 that this stays. The server's own rule is looser, so only the apps enforce it.
- A real upload to Cloudinary from a browser has not been run, because no Cloudinary account is configured here.
- New Filipino text has not had a native review.
