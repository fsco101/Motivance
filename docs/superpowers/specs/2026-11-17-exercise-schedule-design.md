# Exercise schedule: date ranges, rest days and daily follow-up

Date: 2026-11-17. Issues: epic #124, with #125 (server), #126 (therapist), #127 (patient) and #128 (missed days).
Status: the owner asked for the feature on 2026-11-17 and asked for implementation to start the same day. The proposals in the epic's "To decide" list are taken as the defaults below until the owner says otherwise.

## Goal

A therapist puts exercises on a calendar. A **schedule** has a start date, an end date and rest days, and holds one or more of a patient's exercises (the "set"). On each exercise day the patient sees that day's exercises. A finished one leaves the list until its next exercise day. A missed day is not carried over; the therapist is told about it instead.

## Decisions taken as defaults

| Question | Default |
| --- | --- |
| Rest days | Weekly days (ISO 1 = Monday to 7 = Sunday) and specific dates, both. |
| Repeating an exercise already done today | Not offered from today's list. It is done until its next exercise day. |
| Exercises assigned before schedules existed | They keep working as "every day, no end date". The patient's list also treats them as done for the day once finished. |
| The 3-day inactivity alert | Stays for patients with at least one every-day exercise. A patient whose exercises are all scheduled gets the missed-day alert instead, so a therapist is not told twice. |
| When a day counts as missed | When it ends in the center's time zone. The therapist is told the next morning, inside the existing 08:00–20:00 window. |
| What "done" means | A finished session for that exercise that started on the day, in the center's time zone. Every session on the server is a finished one; interrupted ones never leave the phone. A both-sides exercise needs both sides. |
| Name | "Exercise schedule" in the apps, `exercise_schedules` in the database. "Set" already means the two sides of a both-sides exercise. |

## Data

```text
exercise_schedules
  id uuid primary key            -- made by the client, so a retried save cannot create two
  patient_id, therapist_id       -- an active therapist_patients link when saved
  starts_on date, ends_on date   -- inclusive; at most 366 days long
  rest_weekdays smallint[]       -- ISO weekdays; never all seven
  rest_dates date[]              -- inside the range
  cancelled_at timestamptz       -- a schedule ended before it started
  created_at, updated_at

exercise_assignments.schedule_id uuid null   -- null is an every-day exercise, as before

exercise_day_results              -- #128: what happened on each past exercise day
  patient_id, therapist_id, day   -- primary key
  due integer, done integer, missed uuid[]   -- assignments not done
  recorded_at, notified_at
```

Patients and their linked therapists read schedules through row-level security, as they read assignments. Nothing is written directly; every change goes through a function.

## Server functions

- `center_date(timestamptz)`: the calendar day at the center.
- `schedule_has_day(schedule, day)`: inside the range, not cancelled, not a rest weekday, not a rest date.
- `save_exercise_schedule(id, patient, starts_on, ends_on, rest_weekdays, rest_dates)` creates or edits a schedule.
  - Only a therapist actively linked to the patient, and only their own schedule.
  - New: starts today or later. Edited after it started: the start date and the rest dates already past cannot change, so past days are never rewritten.
  - The end date is today or later and not before the start, and at least one exercise day remains.
- `publish_scheduled_prescription(schedule, ...publish_prescription's arguments)`: publishes as today and puts the exercise in the schedule, in one transaction. Editing an exercise later with `publish_prescription` keeps its schedule.
- `stop_exercise(assignment)`: the therapist takes one exercise off the patient's plan, scheduled or not.
- `end_exercise_schedule(schedule)`: a schedule that has started ends today. One that has not started is cancelled, and its exercises are stopped.
- `exercise_day(patient, day)`: for the patient themself or a linked therapist. For each active exercise it gives its schedule, whether it is due that day and whether it is done. It also gives each schedule's state (`upcoming`, `exercise`, `rest`, `ended`) and next exercise day.

## Apps

- **Therapist (#126), web and Android:** the patient record lists schedules with dates, rest days, today's state, days left and their exercises. A schedule is created or edited in a form with a start date, an end date, weekday toggles and rest dates, and a summary such as "12 exercise days and 3 rest days". "Add exercise" opens the existing assignment editor inside that schedule. There are also "Remove" for one exercise and "End schedule".
- **Patient (#127), web and Android:** today's exercises only. A rest day says so and names the next exercise day. When everything is done, the page says so. Android counts a session waiting in its outbox as done. The daily practice reminder is sent only on an exercise day with something left to do.
- **Missed days (#128):** a job records each finished exercise day and notifies each therapist once per patient and day (`exercise_missed`), with a push switch of its own. The patient record marks missed days.

## Rollout

Apply the migration before redeploying the web app. Older Android builds ignore schedules and keep listing every active exercise every day, so patients need the new build to see rest days.

## Testing

Contract tests cover access, validation, day states around midnight, both-sides exercises, legacy exercises and the job's idempotence. Unit tests cover the client-side day rules on both platforms. Browser tests cover the therapist and patient flows on the web. Device and therapist checks go to `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`.
