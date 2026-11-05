# Android profile page

Date: 2026-11-05. The Android profile now follows the web page, laid out for a phone. The tests ran on an emulator with sample data. Nothing here ran on a physical phone.

## What changed

| Area | Change |
| --- | --- |
| Layout | Three cards, as on the web: identity and photo, your details, and change password |
| Details | Read as a two-column list, with Edit profile in the card's corner. They stack on a narrow screen or with large text |
| Gender | A dropdown, on the profile and in signup |
| Password | The form is always visible, and it says when the new password matches the current one |
| Form | Same field order as the web, with Cancel and Save side by side |

## Buttons removed

| Button | Why |
| --- | --- |
| Refresh session | Sessions refresh by themselves |
| Refresh workspace, on this page | Pull-to-refresh already does this |
| Administration | The bottom bar already opens it |
| The full-width Edit profile and Change password toggles | Replaced by a corner action and an always-visible form |
| Local history, for therapists and administrators | It lists sessions on this phone, which is a patient's page. Staff still reach it after a camera check |

Switching roles stays for accounts that hold more than one role.

## Name rule

The owner confirmed on 2026-11-05 that names such as `Ma. Teresa` stay rejected, so the rule did not change.
