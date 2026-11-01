# Form design and validation refinement

Codex engineering review, 2026-11-01.

Delivered separate first-name and last-name fields, grouped personal/contact/account form sections, inline validation, localized calendar dates, clearer profile labels and improved avatar/name alignment. Home session dates now use readable localized formatting. Password confirmation mismatches, short signup passwords and invalid email formats have inline feedback. Birthdate selection excludes future dates and ages beyond 120 years; history calendars retain UTC calendar-date semantics and provide a Clear dates action.

The database validates both split names, dates, contact-number format and usernames. Names accept international letters and common name punctuation. Phone numbers allow a leading plus, spaces, parentheses and hyphens with 7–15 digits. The first/last columns are new; original full names remain intact. Legacy profiles require the user to confirm a split when next edited, rather than silently assigning an assumed surname. New saves derive the compatibility full-name/display-name fields from the explicit parts.

Username policy uses the existing 3–30 ASCII letter/digit/underscore format plus a curated multilingual Latin/transliterated blocked-word expression. Case, underscore separation and common digit substitutions normalize consistently in Kotlin and SQL. Short-word boundaries avoid tested false positives such as Scunthorpe and computation. The list includes English, Filipino and several other language terms; it is not exhaustive and cannot guarantee detection across all languages, slang or adversarial spelling. Future moderation changes must update both implementations with negative and positive tests. Existing accounts are not silently renamed; the policy applies to new detailed signup and profile saves.

Executed checks:

- Debug app and test APK builds passed; lint has zero errors and 90 advisory warnings.
- 53 app JVM tests and 13 domain tests passed. Tests include multilingual/obfuscated usernames, legitimate-name exceptions, international name characters, phone format and age boundaries.
- 16 emulator tests passed: five profile/validation, eight authentication and three history tests. Calendar cancellation preserves values/results; form errors, fixed email and editable profile details are covered.
- 36 real local Auth/PostgREST checks passed, including prohibited usernames, first/last-name requirements, malformed phone numbers, privacy consent, ownership and therapist access boundaries. Fresh migration replay plus 18 foundation SQL checks passed without resetting existing local data.
- English/Filipino parity: 433 resources per locale; module boundaries and seven checked contrast pairs pass.

See [machine-readable results](form-refinement-results.json), [backend results](patient-profile-backend-results.json), [UI transcript](form-refinement/instrumentation.txt), [form screenshot](form-refinement/fields.png), and [profile screenshot](form-refinement/profile.png). Screenshots and test records are synthetic. Both new migrations were applied locally; hosted deployment is not claimed. Physical-phone, TalkBack, human translation/privacy wording and therapist reviews remain deferred in the post-implementation checklist.
