# Repository instructions

- Store project documentation, architecture decisions, plans, reports and runbooks in `docs/`.
- Keep sprint planning JSON flat in the root `sprints/` folder. This is the user's explicit exception to the documentation location rule.
- Maintain `docs/PLAN.md` as the implementation, Kotlin dependency, database and folder architecture authority. Do not recreate a redundant backlog snapshot.
- Follow `docs/SPRINTS.md` when recording completion and syncing GitHub issues. Do not mark work complete without acceptance evidence.
- Always close solved GitHub issues as part of the implementation workflow, and close implemented sprint milestones when all their implementation issues are resolved. Do not wait for the entire sprint to close individual solved issues. Record evidence and sync GitHub; user-deferred therapist/device checks remain unexecuted in the follow-up checklist and are not claimed as passed. Keep actual engineering failures open.
- The root README is only a navigation entry point. Keep operational scripts and CI configuration in their normal executable locations.
- Preserve imported prototype assets and source material unless the user requests changes to them.
- Keep Android client environment configuration in ignored `android/.env`, with `android/.env.example` as the public template. Do not place service-role keys in the app.
- Per the user's implementation instruction, therapist and physical-device checks must not block development. Record them in `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md` for later execution, and distinguish deferred checks from executed tests without claiming clinical validation.
