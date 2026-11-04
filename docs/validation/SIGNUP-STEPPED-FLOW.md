# Stepped patient signup

Implemented 2026-11-04. This change redesigns the patient "Create patient account" screen. It changes the layout and interaction only. The required fields, validation rules, privacy agreement text and version (`system-purpose-v1`), and the registration call are unchanged.

## Problem

Signup was one long scroll:

- email and password;
- three profile sections;
- a 15-line privacy paragraph;
- a rules paragraph;
- a "Create patient account" button that stayed disabled without saying which field was wrong.

There was no password confirmation. The age showed as a chip that looked like a button. The avatar was picked with chips and previewed separately.

## Design

Signup is now four steps. Each step has a "Step N of 4" counter, a 4-segment progress bar and a heading.

1. **Sign-in details:**
   - email, password and a new confirm-password field;
   - a live checklist (valid email, at least 8 characters, passwords match) where each item turns green when met.
2. **Personal details:**
   - first and last name, using word capitalization;
   - birthdate from the calendar, with the age shown as plain text;
   - gender chips with a check mark on the selected one.
3. **Contact and username:**
   - address (multi-line) and contact number;
   - username;
   - three large avatar tiles (person, star, heart) that act as radio buttons and are themselves the preview.
4. **Review and agree:**
   - summary cards for Sign-in, Personal details and Contact/username, each with an **Edit** button that returns to that step with the entries kept;
   - a privacy card with four key points and a "Read the full agreement" toggle that reveals the unchanged full text;
   - a highlighted consent row;
   - **Create patient account**.

**How errors work:**

- **Continue is always available.** If the step is incomplete, it stays put, shows every error on that step (including "Choose your birthdate." and "Choose one option."), and shows "Check the highlighted fields to continue." Untouched fields never show errors when you first arrive at a step.
- **Create patient account** is only enabled when all steps are valid and the agreement is accepted. Until then, a line says that the agreement must be accepted.

**Layout details:**

- The large "Your next step starts here." headline appears only on step 1. Each new step scrolls back to the top.
- The keyboard's Done key on "Confirm password" closes the keyboard.
- At font scales of 1.3× and above, decorative leading icons are hidden so labels keep their width. At 1.6× in Filipino, labels no longer break mid-word.

**Implementation:**

- The validation is split into per-step checks in the domain layer, `PatientProfile.personalValid` and `PatientProfile.contactValid`. `valid()` is now `personalValid && contactValid && consent`, which is the same rule as before.
- The profile editor reuses the same `PersonalFields`, `ContactFields` and `IdentityFields` components, so editing a profile gets the new avatar tiles and age text as well.
- Server errors (for example a username already taken, or the password policy) still appear in the existing notice card, on whichever step is showing.

## Executed checks

- **JVM unit tests:**
  - `:core:domain:test` ran 14 tests, all passing. That includes the new `signupStepChecksPartitionTheFullValidation`, which checks that each step fails only on its own fields and that consent belongs only to the review step.
  - `:core:assessment:test` ran 41 tests and `:app:testDebugUnitTest` ran 53, all passing.
- **Static checks:** `:app:lintDebug` passed with 0 errors. `python scripts/check_resources.py` reported 477 strings per language, with format parity and contrast pairs passing. `git diff --check` passed.
- **Emulator (Pixel_6 AVD, API 35, cold boot):** the full instrumented suite passed **48/48**. Signup coverage:
  - `AuthScreenTest`:
    - the email is kept and the password cleared when entering signup;
    - the 4 steps lead to a REGISTER submission and then the confirmation-code step;
    - Continue stays reachable in Filipino at 1.6× font on a 320dp screen.
  - `PatientProfileTest.signupStepsBlockIncompleteDetails`:
    - a mismatched confirmation keeps you on step 1 with a visible reason;
    - an empty personal step shows no errors until Continue is pressed, then shows them all;
    - no submission happens.
  - `PatientProfileTest.signupReviewRequiresConsentAndSubmitsTheReviewedProfile`:
    - Create stays disabled until consent;
    - the full agreement opens and closes;
    - Edit returns to step 2 and keeps the values;
    - the submitted email, password and profile match what was entered.
- **Stability:** after a cold boot, the auth and profile suites passed 6 consecutive runs (84/84).

  Earlier warm-emulator runs showed intermittent failures in tests that tap a button right after typing. The open keyboard animates `imePadding`, so a coordinate tap can land on a stale position. `AuthScreenTest` now uses a semantic click (`tap()`).

  A comparison against the original code was cut short when the emulator's system server crashed. Whether that flakiness existed before this change is therefore not established.

## Visual evidence

These screenshots use synthetic fixture data, not real patient data.

- [Step 1 with the requirements checklist met](ui/signup-step-account.png)
- [Step 1 in Filipino at 1.6× font, 320dp wide](ui/signup-step-account-large-fil.png)
- [Step 2 personal details with derived age](ui/signup-step-personal.png)
- [Step 2 errors after Continue on an empty step](ui/signup-step-errors.png)
- [Step 3 contact, username and avatar tiles](ui/signup-step-contact.png)
- [Step 4 review, privacy key points and accepted consent](ui/signup-step-review.png)

## Deferred (not executed)

These checks are recorded in `POST-IMPLEMENTATION-CHECKLIST.md`:

- usability with representative patients on physical phones;
- TalkBack;
- keyboard order on a real keyboard;
- review of the new Filipino strings by a fluent reviewer;
- confirmation by the deployment owner that the four privacy key points accurately summarize the full agreement.
