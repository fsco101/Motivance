# Booking reasons and session cards

Engineering review: Claude Code, 2026-11-17. Design: [BOOKING.md](../architecture/BOOKING.md) (decisions on the reason for a visit and the session card).

## Delivered behavior

- **Reason for the visit.** Migration `202611170003_booking_visit_reason.sql` adds `bookings.visit_reason` (3 to 500 characters, trimmed). `request_booking` takes it, `scheduler_series_create` takes one for a whole course, and moves keep it. A reason out of range is refused with `booking_visit_reason`. Both apps' booking forms require it, with a character count, and an opened waitlist place asks for it in a dialog. A Scheduler's weekly course has an optional reason field.
- **Who sees it.** The patient, the assigned therapist and Schedulers, through `booking_view`, `schedule_view` and `scheduler_bookings`. It is not in notifications, booking history, emails, pushes or calendar files.
- **Session cards.** Every booking and schedule view now returns both people's names and photos. On the web (My bookings, My Schedule for patients and therapists, the Scheduler's request panel) and on Android (Bookings and My Schedule for patients and therapists), a session shows the patient and the therapist side by side as profile cards with 48 px photos, the reader's own card marked "You", then the reason, then the details. Cards stack when narrow.

## Executed tests

| Check | Result |
| --- | --- |
| `scripts/verify_backend_migrations.py` | Passed on a fresh replay |
| `supabase test db` | 99 passed |
| Web typecheck, lint, `npm test` | Clean; 306 passed |
| Web `npm run test:contract` | 220 passed, 3 skipped (existing environment-gated tests), including the new `visit-reason.test.ts`: limits, blank as none, the patient's and Scheduler's views, both schedules with both faces, another therapist seeing nothing, moves keeping it, notifications and history without it, and a course giving it to every session |
| Web browser tests, one worker: booking, waitlist, schedule, scheduler, reschedule, signup, notifications | 17 + 31 passed, after the patient schedule card kept its "Your session" title. The booking test checks that a request without a reason is held back and that the reason shows on the card and in the database |
| Android `:app:assembleDebug :app:lintDebug :app:testDebugUnitTest :core:domain:test` | Passed; 279 app unit tests, including new checks that no request leaves without a valid reason, the reason is sent and cleared after, and bookings and schedules read both people and the reason |
| `scripts/test_booking.py` | Not passing, for reasons outside this change. It first stopped at a stale expectation (the Scheduler's patient search has returned a photo since `202611130001_avatars_everywhere.sql`), which is now updated. It then stops at "A patient cannot cancel after the cut-off": the date that check books is now about 15 days ahead, beyond the 14-day maximum cut-off it sets, so the check depends on today's date and needs reworking |

## Not executed

- The Android cards and reason field were not seen on a screen (no emulator; too little free memory with the local stack running). See the [follow-up checklist](POST-IMPLEMENTATION-CHECKLIST.md).
- The migration is not applied to the hosted project.
