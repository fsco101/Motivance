# Production preparation and distribution

Prepared for MOT-24 on 2026-11-01. This is an executable preparation checklist, not evidence of a live deployment, account verification, signing-key creation, approved retention policy or store approval. S5 owns release execution. The local debug build is not a clinical release.

## Environments and migration procedure

Use separate local, staging and production Supabase projects. Keep synthetic accounts and fixtures local. Prefer a project region close to the actual users, subject to the owner's data-location decision. The Android application ID is `com.motivance`; debug adds `.debug`. The current version is 0.3.0 / versionCode 3; increment the versionCode before a subsequent published build.

The only client settings are the project HTTPS URL and public publishable/anon key in ignored `android/.env` or protected CI environment variables. `ANDROID_SUPABASE_URL` overrides `SUPABASE_URL`. Process variables override `local.properties`, which overrides `.env`; remove obsolete settings. Rebuild after changing the client project URL or public key. SMTP settings alone need no APK rebuild. Never put service-role credentials, SMTP secrets, database passwords or signing passwords into BuildConfig, resources, reports or Git. The public key is not an authorization boundary: RPCs and RLS are.

From the repository root, use the pinned Supabase CLI 2.20.12 for the tested migration path:

```powershell
npx --yes supabase@2.20.12 login
npx --yes supabase@2.20.12 link --project-ref YOUR_STAGING_PROJECT_REF
npx --yes supabase@2.20.12 db push --dry-run
npx --yes supabase@2.20.12 db push
```

Verify the selected project before executing the final command. Apply the same reviewed migration set to production only after staging acceptance and a recoverable backup. Order is foundation (`202610310001`), connected workflow (`202611010001`), administration (`202611010002`), bilingual catalogue (`202611010003`), prescribed focus (`202611010004`), then later versioned migrations. Do not run `db reset`, fixture seeding or local integration-test cleanup against a hosted project. A database migration does not automatically copy local email templates or dashboard settings. The migrations include explicitly development-labelled exercise definitions; review the catalogue before any patient pilot.

Rollback: preserve a pre-change database backup and the previous signed app; favor an additive forward repair. Do not delete migration history or rewrite applied migrations. Historical exercise/prescription/session rows stay immutable. For incompatible writes, stop new collection while restoring a separately verified backup to a recovery project, check RLS/RPCs and record counts, then update the backend endpoint/rebuild as necessary. Never claim a database rollback reverses records already cached on phones. Record the operator, time, incident and integrity checks. A restore drill with synthetic data remains an S5 requirement.

## Administrator bootstrap and operational access

The first admin must be provisioned by the project owner through trusted Supabase administration: create/confirm the real account, verify its identity, then insert its `user_roles` membership in trusted SQL. A role selection or signup metadata never provisions an admin. Do not expose the SQL editor or service-role key to the Android app. Subsequent staff grants, account enable/disable, links and catalogue changes use the authenticated Admin workspace. Self-status/role modifications are rejected. Keep at least two separately controlled operator identities for recovery.

Removing a therapist role revokes its links/assignments and invitations. Disabling an account blocks future authorized server operations even with an existing JWT. Offline cached instructions can remain on a disconnected phone for up to 24 hours; account changes cannot remotely erase offline records. Reactivating links does not reactivate old prescriptions. Catalogue edits append new versions; deactivation prevents new prescriptions without rewriting history. The directory uses 50-account keyset pages; the initial link/catalogue views are capped at 500/100 rows and disclose that bound. Larger deployments need corresponding pagination before relying on those views as complete inventories.

The owner must approve actual retention, local data handling, encryption needs, request response times and backup expiry. Current `development-v1` disables automatic deletion and requests review after 365 days. Export/delete requests only enter an operator queue. Follow DATA-LIFECYCLE.md; no automated production purge or export-delivery service is claimed. Name the incident/support owner and a private contact before publication.

## Hosted authentication and monitoring

Use [the Auth email runbook](AUTH-EMAIL.md) for code templates and server-only SMTP setup. Gmail TLS authentication and local Docker SMTP configuration have passed; hosted configuration and inbox acceptance remain pending.

Configure a custom SMTP provider, authenticated sender domain, provider-required DNS records and appropriate rate limits in hosted Supabase Auth. Configure confirmation and recovery templates to display `{{ .Token }}`; the app accepts entered codes and does not implement browser-link callbacks. Verify registration, confirmation, recovery, refresh, logout and delivery to non-team addresses on staging, then smoke-test production. Do not reuse the local mail viewer or the development `localhost` site URL as production settings. Configure a legitimate HTTPS site URL for the actual owner-controlled information site.

Monitor failed sign-ins, API errors, database disk/compute, egress, MAU/email quotas and rejected/exhausted session uploads. Enable the provider's spending controls and alerts, noting which products they actually cover. Alert a named operator before capacity is exhausted. Do not add raw camera frames, passwords, JWTs, invitation tokens or identifiable pose traces to telemetry.

Planning allowance is USD 25–50/month for a small metrics-only backend and basic email; it excludes extra environments, taxes, labor, devices and clinical evaluation. Supabase Pro currently starts at USD 25/month; compute/add-ons/usage and email are additional where applicable. Get an account-specific quote before purchasing. No subscription or production resource was created during S4.

## Signing and distribution checklist

- [ ] Owner confirms Play account type, verified identity, organization details where applicable, and control of the final package identifier.
- [ ] Create a protected upload keystore outside the repository; store its password in the owner's password manager/CI secret store. Keep an encrypted offline backup with a second authorized custodian. Never attach a key to an issue or build artifact. Enable Play App Signing for the chosen distribution path and document upload-key recovery.
- [ ] Use Android Studio's Generate Signed Bundle/APK for release; Gradle currently has no production signing configuration. A debug signature or an unsigned artifact is not a release.
- [ ] Build with the correct hosted endpoint; inspect the APK/AAB for accidental privileged values and debug-only content, install the signed artifact, and exercise the whole hosted workflow.
- [ ] Resolve the current target SDK gap before Play submission: the app is pinned to API 35, while new phone apps/updates require API 36 as of August 31, 2026. Upgrade the tested SDK/AGP tuple together and repeat behavior, native runtime and release tests in S5.
- [ ] Check bundled ARM64 native libraries for 16 KB page compatibility and test that environment. Native packaging completeness is not a page-alignment test. The current official page lists February 1, 2027 as the update enforcement date; verify again at submission.
- [ ] Review MediaPipe/model redistribution terms; `pose-model.json` still marks this pending.
- [ ] Publish an owner-approved privacy policy and account deletion/request information at real public URLs. Complete Data safety and applicable health-app declarations; provide reviewer app-access instructions without publishing real patient credentials.
- [ ] For applicable personal developer accounts created after November 13, 2023, schedule at least 12 continuously opted-in closed testers for 14 days, followed by the production-access application. Actual applicability, verification status and review duration require the account owner/Play Console; none is claimed complete here.
- [ ] Record tested device inventory, deferred clinical/physical checks, production backup restore evidence, support owner and explicit release decision. Complete S5 gates before live clinical use. Direct APK distribution still requires a protected signing identity and release validation; it does not establish store approval.

## Privacy notice draft for owner completion

Motivance processes your camera feed on your phone to estimate supported movements. It does not save or upload camera video or per-frame skeleton traces. With separate movement-summary consent it stores exercise results and consent events locally and synchronizes prescribed results to your rehabilitation account. Your assigned therapist can review authorized records; trusted administrators manage access and operations. Account identity, exercise prescriptions, timestamps, movement summaries and consent/request/audit records are processed to provide this service. Credentials are handled by Supabase Authentication, with session tokens protected through Android Keystore. Local summaries are app-private; Room is not itself encrypted. Signing out removes tokens and downloaded prescriptions while retaining account-scoped unsent results. You can withdraw collection consent or request export/deletion in Profile; requesting deletion does not itself erase history or backups. Before publication the owner must supply the organization/contact, hosting region, actual retention/backup expiry, request response process, lawful policy wording and public deletion URL. This draft is not an approved legal notice.

## Sources verified on 2026-11-01

- [Supabase migration deployment](https://supabase.com/docs/guides/deployment/database-migrations)
- [Hosted SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase pricing](https://supabase.com/pricing) and [cost controls](https://supabase.com/docs/guides/platform/cost-control)
- [Play target API requirements](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Personal account testing](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Play Data safety declarations](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Android signing](https://developer.android.com/studio/publish/app-signing)
- [16 KB page support](https://developer.android.com/guide/practices/page-sizes)

These sources verify general preparation requirements, not the owner's account status or store approval. Recheck at release because provider requirements change.
