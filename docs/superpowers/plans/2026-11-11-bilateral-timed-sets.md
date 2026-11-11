# Both-sides exercise sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Therapists can prescribe one exercise for both sides with an optional time per side. The phone runs left then right, keeps counting past the target while time remains, and announces the next side with a pausable 5-second countdown.

**Architecture:** One prescription with `side='bilateral'` and an optional `side_seconds` parameter. Each side is recorded as its own session, carrying its measured side, so history, sync and recovery stay one-session-one-side. A pure `SideSet` in `core/domain` decides when a side ends. `ExerciseSessionViewModel` runs the switch, and `RepCuePlayer` speaks it.

**Tech Stack:** Supabase Postgres (plpgsql RPCs), Kotlin/Jetpack Compose/Room/Hilt, React/TypeScript/Vite/Vitest/Playwright, Python stdlib test scripts.

**Spec:** `docs/superpowers/specs/2026-11-11-bilateral-timed-sets-design.md`

## Global Constraints

- `side_seconds` is an integer from 15 to 1800. Editors step by 15 seconds and start at 60 (1:00). Displayed as `m:ss`.
- Both always runs LEFT, then RIGHT.
- Countdown: 5 seconds, spoken "5, 4, 3, 2, 1, start". It begins after the announcement finishes, or straight away when the voice is off, and after at most 6000 ms if speech never reports done.
- The timer is `AssessmentSnapshot.durationMs`, the active measuring clock.
- Recorded rules keys `bilateral` and `sideSeconds` are omitted when unused (`ingest_session` rejects JSON `null`).
- `session_measurements.side` stores the measured side, never `bilateral`.
- Every new user-facing string exists in English and Filipino (`scripts/check_resources.py` enforces Android parity; web locale files must stay key-identical).
- Prescription editing ships in both the Android and web therapist editors in the same change.
- Run checks locally; GitHub Actions cannot run (billing lock).
- Before any local `db reset`, back up owner accounts. Prefer `npx --yes supabase@2.20.12 migration up` (no reset).
- Browser tests: if one is cut off by low memory, rerun only that file with `--workers=1`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Patient pauses mid-side.** The time left must freeze and resume, not keep falling. Pinned by `SideSetTest.nothingHappensWhilePaused` and by the remaining time following `durationMs` (Task 2).
2. **Consent withdrawn on the web between sides.** The next side must not auto-start or silently create a new grant. Pinned by `ExerciseSetTest.withdrawnConsentStopsTheNextSide` (Task 5).
3. **Rotation during the countdown.** The countdown must continue and no voice line may repeat. Pinned by `ExerciseSetTest.cuesAreNotReplayedToANewListener` (Task 5).
4. **Older payloads and single-side prescriptions.** These must keep uploading, and `bilateral` on a single-side prescription must be rejected. Pinned in `scripts/test_bilateral_sets.py` (Task 1).
5. **A Both plan published in one app and edited in the other.** It must open with Both and its time preselected. Pinned by the web e2e test `editing a both-sides plan keeps both sides and its time` (Task 7) and by the cross-app fixture (Task 6).

---

### Task 1: Database accepts Both and time per side

**Files:**
- Create: `supabase/migrations/202611110001_bilateral_sets.sql`
- Create: `scripts/test_bilateral_sets.py`

**Interfaces:**
- Produces: `publish_prescription(..., p_side text, ..., p_parameters jsonb)` accepts `p_side='bilateral'` and `p_parameters.side_seconds` (int 15–1800). `ingest_session` accepts recorded `rules.bilateral` (bool) and `rules.sideSeconds` (int).

- [ ] **Step 1: Write `scripts/test_bilateral_sets.py`.** Copy the harness from `scripts/test_custom_exercises.py`: `sql`, `api`, `rpc`, `check`, `user`, `link`, local-stack guard, and the scoped `finally` cleanup. Drop the adb part and use the built-in elbow `21000000-0000-0000-0000-000000000001`. Checks, by `check` name:
  - `Both sides publishes`: `p_side='bilateral'`, `p_parameters={}` → 200
  - `Both sides with a time publishes`: `{'side_seconds': 90}` → 200
  - `A time below 15 s is rejected` (14), `A time above 30 min is rejected` (1801), `A fractional time is rejected` (`20.5`), `A text time is rejected` (`'90'`) → ≥400
  - `A single side with a time publishes`: `p_side='left'`, `{'side_seconds': 15}` → 200
  - `The left side of a Both set uploads`: rules `side='LEFT', bilateral=True, sideSeconds=90` → 200. Its `session_measurements.side` is `left` (query via `sql`).
  - `The right side of a Both set uploads`: same, with `RIGHT` → 200. Its measurement side is `right`.
  - `A recorded side of BILATERAL is rejected`; `A Both set upload without the bilateral flag is rejected`; `A recorded time that differs is rejected` (`sideSeconds=60`); `A recorded time missing from a timed plan is rejected` → ≥400
  - `The bilateral flag on a single-side plan is rejected`: left plan, rules `bilateral=True` → ≥400
  - `A legacy single-side upload still works`: left plan, rules without either new key → 200
  - `A single-side upload with its matching time works`: left plan with 15 s, rules `sideSeconds=15` → 200

  Rules for the elbow: `kind='ELBOW_FLEXION'`, `version=ELBOW`, `low=20, high=90, target=5`, standard timing, `demo=False`. Each session uses a fresh `sessionId`.

- [ ] **Step 2: Run it and confirm it fails.** Run `python scripts/test_bilateral_sets.py`. Expected: an AssertionError at `Both sides publishes`.

- [ ] **Step 3: Write the migration.** `create or replace` both functions, copying their current bodies from `202611050001_custom_exercises.sql` with only these changes:
  - `publish_prescription`:
    - The side check becomes `p_side not in ('left','right','bilateral')`.
    - Add `'side_seconds'` to the allowed keys.
    - Add `or (p_parameters ? 'side_seconds' and (jsonb_typeof(p_parameters->'side_seconds') is distinct from 'number' or (p_parameters->>'side_seconds')::numeric<>trunc((p_parameters->>'side_seconds')::numeric) or (p_parameters->>'side_seconds')::numeric not between 15 and 1800))` to the parameter check.
  - `ingest_session`:
    - Replace `rules->>'side'<>upper(prescription.side)` with `(case when prescription.side='bilateral' then rules->>'side' not in ('LEFT','RIGHT') or coalesce((rules->>'bilateral')::boolean,false) is distinct from true else rules->>'side'<>upper(prescription.side) or coalesce((rules->>'bilateral')::boolean,false) end)`.
    - Add `or (rules->>'sideSeconds')::integer is distinct from (prescription.parameters->>'side_seconds')::integer` to the form/timing check.
    - Insert the measurement side as `case when prescription.side='bilateral' then lower(rules->>'side') else prescription.side end`.
  - Header comment: one line on why. Keep the existing `revoke`/`grant` lines if the original migration re-granted.

- [ ] **Step 4: Apply and test.** Run `npx --yes supabase@2.20.12 migration up`, then `python scripts/test_bilateral_sets.py` (expected: every line `PASS`, exit 0), then `python scripts/test_custom_exercises.py` and `npx --yes supabase@2.20.12 test db` (expected: still pass).

- [ ] **Step 5: Commit** both files: `feat: accept both-sides prescriptions with a time per side`.

---

### Task 2: Domain model and `SideSet`

**Files:**
- Create: `android/core/domain/src/main/kotlin/com/motivance/domain/SideSet.kt`
- Modify: `android/core/domain/src/main/kotlin/com/motivance/domain/Exercise.kt` (`ExerciseRules`)
- Modify: `android/core/domain/src/main/kotlin/com/motivance/domain/Rehabilitation.kt` (`PrescriptionDraft`)
- Modify: `android/core/domain/src/main/kotlin/com/motivance/domain/Seconds.kt`
- Test: `android/core/domain/src/test/kotlin/com/motivance/domain/SideSetTest.kt`, `SecondsTest.kt`

**Interfaces:**
- Produces:
  - `ExerciseRules(..., exerciseName:String?=null, bilateral:Boolean=false, sideSeconds:Int?=null)`. New parameters go last. `init` adds `require(sideSeconds==null || sideSeconds in SideSet.MIN_SECONDS..SideSet.MAX_SECONDS)`.
  - `PrescriptionDraft(..., focusJoint:BodyJoint?=null, bilateral:Boolean=false, sideSeconds:Int?=null)`. When `bilateral`, `side` is `LEFT`.
  - `Seconds.clock(seconds:Long):String` → `"%d:%02d"`.
  - `sealed interface SetEvent { data object TargetReached; data class SideEnded(val next:BodySide); data object SetComplete }`
  - `object SideSet { MIN_SECONDS=15; MAX_SECONDS=1800; STEP_SECONDS=15; DEFAULT_SECONDS=60; COUNTDOWN_SECONDS=5; ANNOUNCEMENT_LIMIT_MS=6000L; fun sides(rules):List<BodySide>; fun next(rules):BodySide?; fun remainingMs(rules,snapshot):Long?; fun evaluate(rules,before:AssessmentSnapshot,after:AssessmentSnapshot):SetEvent? }`

- [ ] **Step 1: Write the failing tests.** Fixture: `val both=ExerciseRules(bilateral=true,sideSeconds=60,targetRepetitions=5)` and `fun snap(done:Int,ms:Long,running:Boolean=true)=AssessmentSnapshot(completed=done,durationMs=ms,running=running)`.
  - `bothSidesRunLeftThenRight`: `sides(both)==[LEFT,RIGHT]`; `next(both)==RIGHT`; `next(both.copy(side=RIGHT))==null`; `sides(ExerciseRules(side=RIGHT))==[RIGHT]`.
  - `timeUpOnTheLeftMovesToTheRight`: `evaluate(both,snap(3,59_990),snap(3,60_000))==SideEnded(RIGHT)`.
  - `timeUpOnTheLastSideCompletesTheSet`: right side of `both` → `SetComplete`. `ExerciseRules(sideSeconds=60)` → `SetComplete`.
  - `reachingTheTargetWithTimeLeftKeepsGoing`: `evaluate(both,snap(4,10_000),snap(5,10_050))==TargetReached`; `evaluate(both,snap(5,11_000),snap(6,11_050))==null`.
  - `timeUpBeforeTheTargetStillMovesOn`: `snap(2,59_999)→snap(2,60_001)` → `SideEnded(RIGHT)`.
  - `untimedBothSidesSwitchAtTheTarget`: `both.copy(sideSeconds=null)`, 4→5 → `SideEnded(RIGHT)`; same on the right side → `null`.
  - `untimedSingleSideBehavesAsBefore`: `ExerciseRules()`, 4→5 → `null`.
  - `nothingHappensWhilePaused`: `snap(3,59_000)→snap(3,61_000,running=false)` → `null`.
  - `aRestoredSidePastItsTimeEndsOnTheNextFrame`: `snap(3,61_000)→snap(3,61_050)` → `SideEnded(RIGHT)`.
  - `remainingTimeCountsDown`: `remainingMs(both,snap(0,15_500))==44_500`; `remainingMs(both,snap(0,70_000))==0`; `remainingMs(ExerciseRules(),snap(0,1))==null`.
  - `aTimeOutsideTheLimitsIsRefused`: `assertThrows(IllegalArgumentException)` for `sideSeconds` 14 and 1801.
  - `SecondsTest.clockShowsMinutesAndSeconds`: `clock(0)=="0:00"`, `clock(15)=="0:15"`, `clock(90)=="1:30"`, `clock(1800)=="30:00"`.

- [ ] **Step 2: Run and confirm failure.** From `android/`, run `.\gradlew.bat :core:domain:test`. Expected: compile failure (`SideSet` unresolved).

- [ ] **Step 3: Implement.** `evaluate` rules, in this order:
  1. Return `null` if `!after.running`.
  2. If timed and `after.durationMs >= sideSeconds*1000`, return `next?.let(::SideEnded) ?: SetComplete`. This is level-triggered, so a restored side past its time still ends.
  3. If `before.completed < target <= after.completed`: return `TargetReached` if timed; else `SideEnded(next)` if `next != null`; else `null`.
  4. Otherwise return `null`.

  KDoc on `SideSet` states that the caller stops calling `evaluate` once a side has ended.

- [ ] **Step 4: Run.** `.\gradlew.bat :core:domain:test`. Expected: PASS.

- [ ] **Step 5: Commit**: `feat: decide when each side of a set ends`.

---

### Task 3: Android data layer: cache, rules JSON, publish, history filter

**Files:**
- Modify: `android/app/src/main/java/com/motivance/data/local/ExerciseJson.kt`
- Modify: `android/app/src/main/java/com/motivance/data/remote/PrescriptionCache.kt:30,38`
- Modify: `android/app/src/main/java/com/motivance/data/remote/SupabaseAuthRepository.kt:263-266` (`publishPrescription`)
- Modify: `android/app/src/main/java/com/motivance/data/remote/HistoryJson.kt:11-26`
- Modify: `android/app/src/main/java/com/motivance/feature/rehabilitation/RehabilitationViewModel.kt:130` (pass `sideSeconds` into the validating `ExerciseRules`)
- Test: `android/app/src/test/java/com/motivance/data/remote/PrescriptionCacheTest.kt`, `ConnectedRepositoryTest.kt`, `HistoryRepositoryTest.kt`

**Interfaces:**
- Consumes: `ExerciseRules.bilateral`, `ExerciseRules.sideSeconds`, `PrescriptionDraft.bilateral`, `PrescriptionDraft.sideSeconds` (Task 2).
- Produces: cached rules for a Both plan have `side=LEFT, bilateral=true`. `HistoryJson.select(query:HistoryQuery):String`.

- [ ] **Step 1: Write the failing tests.**
  - `PrescriptionCacheTest.aBothSidesPrescriptionStartsOnTheLeftWithItsTime`: decode a row with `"side":"bilateral"` and `"parameters":{"side_seconds":90}` → rules `side==LEFT`, `bilateral`, `sideSeconds==90`.
  - `PrescriptionCacheTest.newSetFieldsSurviveTheRulesRoundTrip`: `ExerciseJson.rules(ExerciseJson.rules(r))==r` for `r` with `bilateral=true, sideSeconds=90`. The JSON of `ExerciseRules()` has neither the `bilateral` nor the `sideSeconds` key.
  - `ConnectedRepositoryTest.aBothSidesPrescriptionIsPublishedAsBilateralWithItsTime`: reuse the interceptor from `prescribedFocusIsSentInsideTheVersionedParameters`, also capturing `p_side`. Publish `PrescriptionDraft(..., side=LEFT, bilateral=true, sideSeconds=120)` → `p_side=="bilateral"` and `p_parameters.side_seconds==120`. Without a time → no `side_seconds` key.
  - `HistoryRepositoryTest`: change the side assertion to `url.queryParameter("measured.side")=="eq.left"`, assert `url.queryParameter("prescription.side")==null`, and assert `select` contains `measured:session_measurements!inner(side)`. Without a side filter, `select` equals `HistoryJson.SELECT`.

- [ ] **Step 2: Run and confirm failure.** `.\gradlew.bat :app:testDebugUnitTest --tests "com.motivance.data.remote.*"`. Expected: the new tests fail.

- [ ] **Step 3: Implement.**
  - `ExerciseJson`: write the keys only when used; read them with `optBoolean` and `has`.
  - `PrescriptionCache`: map `"bilateral"` to `LEFT` plus `bilateral=true`. Read `side_seconds` with `has`/`getInt`.
  - `publishPrescription`: `p_side = if(draft.bilateral) "bilateral" else draft.side.name.lowercase()`, and `draft.sideSeconds?.let {p.put("side_seconds",it)}`.
  - `HistoryJson.select(query)` appends `,measured:session_measurements!inner(side)` when `query.side != null`. `path` uses it and filters `measured.side`.

- [ ] **Step 4: Run.** The same command, then the full `.\gradlew.bat :app:testDebugUnitTest`. Expected: PASS.

- [ ] **Step 5: Commit**: `feat: carry both-sides plans through the phone's cache, upload and history`.

---

### Task 4: Android therapist editor and side labels

**Files:**
- Modify: `android/app/src/main/java/com/motivance/feature/rehabilitation/ConnectedScreens.kt` (`PrescriptionEditor` 284–440, `AssignedPrescriptionCard` ~188–195, patient card ~233–250)
- Modify: `android/app/src/main/java/com/motivance/navigation/MotivanceApp.kt:594` (`TodayPlan`)
- Modify: `android/app/src/main/java/com/motivance/feature/exercise/CameraPrototype.kt:198`
- Modify: `android/app/src/main/res/values/strings.xml`, `values-fil/strings.xml`
- Test: `android/app/src/androidTest/java/com/motivance/feature/rehabilitation/BothSidesEditorTest.kt`

**Interfaces:**
- Consumes: `SideSet.MIN_SECONDS/MAX_SECONDS/STEP_SECONDS/DEFAULT_SECONDS`, `Seconds.clock`, `PrescriptionDraft(bilateral, sideSeconds)`.
- Produces:
  - `@Composable internal fun sideText(side:String):String`, for the server values `left`/`right`/`bilateral`.
  - `@Composable internal fun ExerciseRules.sideText():String`, which gives Both sides when `bilateral`.
  - `@Composable internal fun sideTimeText(seconds:Int?,both:Boolean):String?`, which gives `"2:00 per side"`, `"1:30"`, or `null`.
- Strings (en / fil):

  | Key | English | Filipino |
  | --- | --- | --- |
  | `both_sides` | Both sides | Magkabilang panig |
  | `ui_set_time` | Set a time | Magtakda ng oras |
  | `ui_time` | Time | Oras |
  | `ui_time_per_side` | Time per side | Oras bawat panig |
  | `ui_time_help` | Measuring continues after the target until the time is up. | Tuloy ang pagsukat kahit naabot na ang target hanggang matapos ang oras. |
  | `ui_time_per_side_value` | %1$s per side | %1$s bawat panig |
  | `ui_less_time` | Less time | Bawasan ang oras |
  | `ui_more_time` | More time | Dagdagan ang oras |
  | `ui_review_time` | Time | Oras |
  | `ui_no_time_limit` | No time limit | Walang takdang oras |

- [ ] **Step 1: Write the failing instrumented test `BothSidesEditorTest`.** Model it on `PrescribedFocusTest`: render `PrescriptionEditor` with a fake state, one patient and the elbow catalogue item.
  - `choosingBothAndATimePublishesThem`: select the elbow, click "Both sides", turn on "Set a time", click "More time" 4× (shows "2:00"), Publish. The captured draft has `bilateral && side==LEFT && sideSeconds==120`.
  - `anExistingBothPlanOpensWithBothAndItsTime`: `existing=PrescriptionSummary(..., side="bilateral", parameters="{\"side_seconds\":90}")`. "Both sides" is selected and "1:30" is displayed.

- [ ] **Step 2: Build the test APK and confirm the failure.** `.\gradlew.bat :app:assembleDebugAndroidTest` fails to compile until the strings exist. Run it with `:app:connectedDebugAndroidTest --tests` only if an emulator is attached (`adb devices`). Otherwise record it as not executed.

- [ ] **Step 3: Implement.**
  - Side choices: `left`, `right`, `bilateral`. The guide preview uses `LEFT` for `bilateral`.
  - Add `timed` and `sideSeconds` state from `parameters.has("side_seconds")` and `optInt("side_seconds",SideSet.DEFAULT_SECONDS)`.
  - Add a `SideTimeStepper(seconds,timed,both,enabled,onTimed,onSeconds)` composable after `RepetitionStepper` in step 3: a `Switch` row labelled `ui_set_time`, then −/+ `FilledTonalIconButton`s (52 dp, content descriptions `ui_less_time`/`ui_more_time`), coerced to 15..1800 in 15-second steps, showing `Seconds.clock`. The label is `ui_time_per_side` when `both`, else `ui_time`, followed by help text `ui_time_help`. Every change calls `changed()`.
  - Add a review row `ui_review_time`: the `sideTimeText` value or `ui_no_time_limit`.
  - Publish `bilateral=side=="bilateral"` and `sideSeconds=sideSeconds.takeIf {timed}`.
  - Replace the four inline left/right label expressions with `sideText`. `AssignedPrescriptionCard` adds the `sideTimeText` from `p.parameters`.

- [ ] **Step 4: Verify.** Run `.\gradlew.bat :app:assembleDebug :app:lintDebug :app:testDebugUnitTest`, `python scripts/check_resources.py` and, with an emulator, the two connected tests. Expected: PASS.

- [ ] **Step 5: Commit**: `feat: prescribe both sides and a time per side on Android`.

---

### Task 5: Android set run: switching, countdown, voice, results

**Files:**
- Create: `android/app/src/main/java/com/motivance/feature/exercise/SideSwitch.kt` (switch models, `SetCue`, `SetCueLines`, `SideSwitchCard`)
- Modify: `android/app/src/main/java/com/motivance/feature/exercise/ExerciseSessionViewModel.kt`
- Modify: `android/app/src/main/java/com/motivance/feature/exercise/RepCues.kt` (`RepCuePlayer.announce`)
- Modify: `android/app/src/main/java/com/motivance/feature/exercise/CameraPrototype.kt:68-70,163-170,216-250`
- Modify: `android/app/src/main/java/com/motivance/feature/exercise/SkeletonPreview.kt` (time-left tile near the reps tile, ~line 180)
- Modify: `android/app/src/main/java/com/motivance/navigation/MotivanceApp.kt:261,546` (`SessionComplete` per-side rows)
- Modify: strings `values/`, `values-fil/`
- Test: `android/app/src/test/java/com/motivance/feature/exercise/SetCueLinesTest.kt`, `android/app/src/androidTest/java/com/motivance/feature/exercise/ExerciseSetTest.kt`

**Interfaces:**
- Consumes: `SideSet`, `SetEvent` (Task 2); cached Both rules (Task 3); `sideText` (Task 4).
- Produces:
  - `enum class SwitchStage { ANNOUNCING, COUNTING, PAUSED, WAITING_FOR_TRACKING }`
  - `data class SideSwitch(val next:BodySide,val stage:SwitchStage,val secondsLeft:Int=SideSet.COUNTDOWN_SECONDS)`
  - `data class SideResult(val side:BodySide,val target:Int,val metrics:AssessmentSnapshot)`
  - `sealed interface SetCue { data object TargetReached; data class SideDone(val done:BodySide,val next:BodySide); data class Count(val n:Int); data object Go; data object Complete }`
  - `class SetCueLines(targetReached:String,sideDone:String,go:String,complete:String,sideNames:Map<BodySide,String>) { fun lineFor(cue:SetCue,exerciseName:String):String }`
  - `ExerciseSessionState.switching:SideSwitch?=null` and `ExerciseSessionState.sides:List<SideResult> = emptyList()`
  - `ExerciseSessionViewModel.cues:SharedFlow<SetCue>` (replay 0), `fun announced()`, `fun pauseSwitch()`, `fun startNextSide()`
  - `RepCuePlayer.announce(cue:SetCue,exerciseName:String,finished:()->Unit)`
- Strings (en / fil):

  | Key | English | Filipino |
  | --- | --- | --- |
  | `cue_target_keep_going` | Target reached. Keep going until the time is up. | Naabot mo na ang target. Ituloy lang hanggang matapos ang oras. |
  | `cue_side_done` | %1$s done. Next: %2$s, %3$s. | Tapos na ang %1$s. Susunod: %2$s, %3$s. |
  | `cue_go` | Start. | Simulan. |
  | `cue_set_complete` | Exercise complete. | Tapos na ang ehersisyo. |
  | `set_next_side` | Next: %1$s | Susunod: %1$s |
  | `set_starting_in` | Starting in %1$d | Magsisimula sa %1$d |
  | `set_pause` | Pause | I-pause |
  | `set_start` | Start | Simulan |
  | `set_get_in_view` | Step into view to start the %1$s. | Pumuwesto sa harap ng camera para simulan ang %1$s. |
  | `set_time_left` | Time left | Natitirang oras |
  | `set_side_result` | %1$s: %2$d of %3$d reps, %4$s range, %5$s | %1$s: %2$d sa %3$d ulit, %4$s saklaw, %5$s |

- [ ] **Step 1: Write the failing JVM test `SetCueLinesTest`.** Use `lines=SetCueLines("Target reached. Keep going until the time is up.","%1\$s done. Next: %2\$s, %3\$s.","Start.","Exercise complete.",mapOf(LEFT to "Left side",RIGHT to "Right side"))`.
  - `SideDone(LEFT,RIGHT)` with `"Elbow flexion"` → `"Left side done. Next: Right side, Elbow flexion."`
  - `Count(3)` → `"3"`; `Go` → `"Start."`; `Complete` → `"Exercise complete."`; `TargetReached` → the target line.

- [ ] **Step 2: Write the failing instrumented test `ExerciseSetTest`.** Set it up like `ExerciseLifecycleTest`: in-memory Room, a real `ExerciseSessionViewModel`, the landmark fixture `p`, and a cached Both prescription with `sideSeconds=15`. A helper coroutine feeds `vm.frame(listOf(p),640,480,SystemClock.uptimeMillis())` on the main thread every 50 ms.
  - `aTimedBothSetRunsLeftThenRight`: use, start(true), feed 15.5 s of frames. Then:
    - `switching==SideSwitch(RIGHT,ANNOUNCING)`, and the DAO has one `COMPLETED` row whose rules are `side LEFT, bilateral`.
    - Call `announced()` → `COUNTING`.
    - After about 5.5 s of frames → `switching==null`, `id!=null`, `rules.side==RIGHT`.
    - After 15.5 s more → `saved`, `sides.map{it.side}==[LEFT,RIGHT]`, and two `COMPLETED` rows with the same `prescriptionVersionId` and `consentId`.
    - The cues collected in order include `SideDone(LEFT,RIGHT)`, `Count(5)`…`Count(1)`, `Go`, `Complete`.
  - `pauseHoldsTheCountdownUntilStart`: reach `COUNTING`, call `pauseSwitch()`, wait 2 s → `stage==PAUSED`, `secondsLeft` unchanged, `id==null`. Call `startNextSide()` with frames flowing → `id!=null` and `rules.side==RIGHT`.
  - `theCountdownStartsWithoutTheVoiceAfterSixSeconds`: reach `ANNOUNCING` and never call `announced()`. After 6.5 s → `stage==COUNTING`.
  - `withdrawnConsentStopsTheNextSide`: reach `ANNOUNCING`, call `store.recordConsent(owner,false)`, call `announced()`, wait for the countdown → `id==null` and `switching==null`. `dao.latestConsent(owner).event=="withdrawn"`, so no new grant was created.
  - `cuesAreNotReplayedToANewListener`: after `SideDone` is emitted, `vm.cues.replayCache.isEmpty()`.
  - `finishDuringTheCountdownEndsTheSet`: reach `COUNTING`, call `finish()` → `saved`, `switching==null`, `sides.size==1`, and one `COMPLETED` row.

- [ ] **Step 3: Run and confirm failure.** `.\gradlew.bat :app:testDebugUnitTest --tests "*SetCueLinesTest"` fails, and `:app:assembleDebugAndroidTest` fails to compile.

- [ ] **Step 4: Implement the ViewModel.**
  - `frame()`: if `switching==null && id!=null`, evaluate `SideSet.evaluate(rules,before,metrics)`:
    - `TargetReached` → `cues.tryEmit(TargetReached)`.
    - `SideEnded(next)` → `endSide(next)`.
    - `SetComplete` → `endSide(null)`.
    - If `switching?.stage==WAITING_FOR_TRACKING`, try `beginNextSide()`; it is guarded so only one launch is in flight.
  - `endSide(next)` (private):
    - Call `engine.pause(now)` and append a `SideResult`.
    - If `next==null`: run `finish()`'s path, which saves `COMPLETED` with its toast and sets `saved`, then emit `Complete`.
    - Otherwise: save the captured side as `COMPLETED` with no toast and no `saved` flag, and schedule sync. Then `engine=MovementAssessment(rules.copy(side=next))`, set `id=null, result=null, switching=SideSwitch(next,ANNOUNCING)`, emit `SideDone`, and launch the 6000 ms fallback that calls `announced()`.
    - Refactor `persist` to take the captured state and a `quiet` flag.
  - `announced()`: `ANNOUNCING`→`COUNTING`. Launch the countdown job: for `n` in 5 downTo 1, emit `Count(n)`, set `secondsLeft=n`, then `delay(1000)`. Then emit `Go`, set `WAITING_FOR_TRACKING`, and call `beginNextSide()`.
  - `pauseSwitch()`: cancel the jobs and set `PAUSED`. `startNextSide()`: `PAUSED`→`WAITING_FOR_TRACKING`, then `beginNextSide()`.
  - `beginNextSide()` (suspend inside `viewModelScope`, with the `lifecycleRevision` guard):
    - If `store.dao.latestConsent(owner)?.event!="granted"`, set `switching=null` and stop, which leaves the normal consent-and-Start path. Never call `recordConsent` here.
    - If `!engine.start(uptime)`, stay in `WAITING_FOR_TRACKING`.
    - Otherwise set `startedAt`, a new `id`, `switching=null`, and persist a `DRAFT`.
  - `interrupt()` pauses an active switch, since every non-`PAUSED` stage becomes `PAUSED`.
  - `start()` returns early while `switching!=null`.
  - `finish()` during a switch cancels it and sets `saved=true`, with the last finished side's `rules`/`metrics`. When a side is running, it appends that side to `sides` before saving.
  - `newSession()`, `configure()` and `restore()` clear `switching` and `sides`.
  - Results stay on `results` as before. `cues` is a separate `MutableSharedFlow(extraBufferCapacity=8, onBufferOverflow=DROP_OLDEST)`.

- [ ] **Step 5: Implement voice and UI.**
  - `RepCuePlayer.announce`:
    - Speak `SetCueLines.lineFor` with `QUEUE_ADD`. `SideDone` uses utterance id `side-done`, and an `UtteranceProgressListener.onDone` posts `finished()` to the main looper.
    - Without a voice: `SideDone`/`Complete` play `TONE_PROP_BEEP2`, `Count` plays `TONE_PROP_BEEP`, `Go` plays `TONE_PROP_ACK`, and `finished()` is called at once.
    - Build `SetCueLines` in `scriptIn` from the same localized resources.
  - `CameraPrototype`:
    - Collect `session.cues` into `player.announce(it,currentName,session::announced)`, using `rememberUpdatedState` for the name.
    - When `!voice` and `switching?.stage==ANNOUNCING`, call `session.announced()`.
    - Show `SideSwitchCard` instead of `MeasurementControls` while switching.
    - Navigate to completion when `saved && (exitRequested || sides.isNotEmpty())`.
  - `SideSwitchCard`:
    - `set_next_side`, a big `secondsLeft` with `set_starting_in`, and one 52 dp button: `set_pause` while counting or announcing, `set_start` while paused.
    - In `WAITING_FOR_TRACKING`, show `set_get_in_view` with the side text.
    - Use `liveRegion=Polite`.
  - `SkeletonPreview`: show a `MetricTile(set_time_left, Seconds.clock(remainingMs/1000 rounded up))` when `SideSet.remainingMs` is not null.
  - `SessionComplete`: take `sides:List<SideResult>`. When `sides.size>=2`, list `set_side_result` per side.

- [ ] **Step 6: Run.** `.\gradlew.bat :app:assembleDebug :app:lintDebug :app:testDebugUnitTest :core:domain:test :core:assessment:test`, plus `python scripts/check_resources.py`. Expected: PASS. With an emulator attached, also run `:app:connectedDebugAndroidTest`; otherwise record `ExerciseSetTest` as not executed.

- [ ] **Step 7: Commit**: `feat: run both sides with a timed switch and spoken countdown`.

---

### Task 6: Web data and cross-app contract

**Files:**
- Modify: `web/src/data/therapist.ts` (`PrescriptionDraft`, `publishPrescription`, new helpers)
- Modify: `web/src/data/workspace.ts:49-60` (`PlanSummary.sideSeconds`)
- Modify: `web/src/data/patient.ts:13-40` (patient exercise `sideSeconds`)
- Modify: `web/src/data/history.ts:126-130` (`loadHistory` side filter)
- Modify: `web/tests/contract/crossApp.test.ts:39` and regenerate `android/app/src/test/resources/web-published-prescriptions.json`
- Modify: `android/app/src/test/java/com/motivance/data/remote/WebPublishedPrescriptionTest.kt`
- Test: `web/src/data/therapist.test.ts`, `web/src/data/patient.test.ts`, `web/tests/contract/queries.test.ts`

**Interfaces:**
- Consumes: the Task 1 server contract and Android decoding (Task 3).
- Produces:
  - `PrescriptionDraft.side:'left'|'right'|'bilateral'`, `PrescriptionDraft.sideSeconds?:number|null`
  - `SIDE_SECONDS={min:15,max:1800,step:15,initial:60}`
  - `validSideSeconds(value:number|null):boolean`, `clock(seconds:number):string`
  - `PlanSummary.sideSeconds:number|null`, patient exercise `sideSeconds:number|null`

- [ ] **Step 1: Write the failing tests.**
  - `therapist.test.ts`:
    - `clock` maps 0→`'0:00'`, 15→`'0:15'`, 90→`'1:30'`, 1800→`'30:00'`.
    - `validSideSeconds` is true for `null`, 15 and 1800, and false for 14, 1801 and 20.5.
  - `patient.test.ts`: a plan row with `parameters:{side_seconds:90}` decodes `sideSeconds:90`, and without it `null`. Follow the file's existing decode test.
  - `queries.test.ts`, new `it('a both-sides plan files each session under the side measured')`:
    - Publish `side:'bilateral', sideSeconds:90`.
    - Ingest two sessions with rules `{...LEFT, bilateral:true, sideSeconds:90}` and `RIGHT`.
    - `loadHistory` with `side:'left'` → 1 session whose measurement side is `left`. With `'right'` → 1. With no side → 2.
    - The existing `side:'left'`/`'right'` assertions at lines 171–172 still pass.

- [ ] **Step 2: Run and confirm failure.** `cd web; npm test` (unit) and `npm run test:contract` (needs local Supabase). Expected: the new cases fail.

- [ ] **Step 3: Implement.**
  - `publishPrescription` sets `parameters.side_seconds` when `sideSeconds != null`.
  - `PlanSummary` and the patient decoder read `side_seconds` only when it is a number.
  - `loadHistory`: when `query.side` is set, select `` `${HISTORY_SELECT},measured:session_measurements!inner(side)` `` and filter with `.eq('measured.side', query.side)`. Remove the `prescription.side` filter.

- [ ] **Step 4: Run.** `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:contract`. Expected: PASS.

- [ ] **Step 5: Update the cross-app fixture.**
  - In `crossApp.test.ts`, change the custom prescription to `side: 'bilateral', sideSeconds: 90`.
  - Run `$env:UPDATE_ANDROID_FIXTURE=1; npm run test:contract -- crossApp`, then unset the variable and run it again (expected: PASS).
  - In `WebPublishedPrescriptionTest.aCustomExerciseKeepsItsNameAndJoint`, assert `side==LEFT`, `bilateral` and `sideSeconds==90`.
  - Run `.\gradlew.bat :app:testDebugUnitTest --tests "*WebPublishedPrescriptionTest"`. Expected: PASS.

- [ ] **Step 6: Commit**: `feat: publish and read both-sides plans on the web`.

---

### Task 7: Web therapist editor, labels and progress

**Files:**
- Modify: `web/src/features/therapist/AssignmentEditorView.tsx:57,99-102,109-126,148-156`
- Modify: `web/src/features/therapist/PatientRecordView.tsx:14,33`, `web/src/features/therapist/pages.tsx:99`
- Modify: `web/src/features/patient/PatientExercisesView.tsx`, `web/src/features/patient/PatientHomeView.tsx:23`
- Modify: `web/src/features/therapist/ProgressView.tsx:72` (session side = measured side)
- Modify: `web/src/locales/en.json`, `web/src/locales/fil.json`
- Test: `web/tests/e2e/therapist.spec.ts`, `web/tests/e2e/patient.spec.ts`

**Interfaces:**
- Consumes: `SIDE_SECONDS`, `validSideSeconds`, `clock`, `PrescriptionDraft`, `PlanSummary.sideSeconds` (Task 6).
- Locale keys (en / fil):

  | Key | English | Filipino |
  | --- | --- | --- |
  | `common.bilateral` | Both sides | Magkabilang panig |
  | `assign.timeSwitch` | Set a time | Magtakda ng oras |
  | `assign.time` | Time | Oras |
  | `assign.timePerSide` | Time per side | Oras bawat panig |
  | `assign.timeHelp` | Measuring continues after the target until the time is up. | Tuloy ang pagsukat kahit naabot na ang target hanggang matapos ang oras. |
  | `assign.lessTime` | Less time | Bawasan ang oras |
  | `assign.moreTime` | More time | Dagdagan ang oras |
  | `assign.noTime` | No time limit | Walang takdang oras |
  | `record.time` | Time: {{time}} | Oras: {{time}} |
  | `record.timeEach` | Time per side: {{time}} | Oras bawat panig: {{time}} |

- [ ] **Step 1: Write the failing e2e tests** in `therapist.spec.ts`, following the existing `a published prescription lands with the chosen values` test.
  - `a both-sides plan with a time per side is published`: pick the elbow, choose radio "Both sides", turn on switch "Set a time", click "More time" 4× and expect the output "2:00", then Publish. The record shows "Both sides" and "Time per side: 2:00".
  - `editing a both-sides plan keeps both sides and its time`: open the plan from the previous test. "Both sides" has `aria-checked=true` and the output reads "2:00".

  In `patient.spec.ts`: the patient's exercise page shows "Both sides" and "Time per side: 2:00" for such a plan. Seed it through the existing helpers.

- [ ] **Step 2: Run and confirm failure.** `npx playwright test therapist.spec.ts patient.spec.ts --workers=1`. Expected: the new tests fail.

- [ ] **Step 3: Implement.**
  - Side state: `'left'|'right'|'bilateral'`, initialised from `existing?.side`.
  - Add `timed`/`seconds` state from `existing?.sideSeconds`.
  - In Step 3 of the editor, under repetitions, add a `role="switch"` button labelled `assign.timeSwitch`. When on, show a stepper like the repetitions one: `IconButton` `assign.lessTime`/`assign.moreTime`, `output aria-live="polite"` showing `clock(seconds)`, limited by `SIDE_SECONDS`. Its label is `assign.timePerSide` for Both, else `assign.time`, with `assign.timeHelp` below.
  - Add a review row with the time, or `assign.noTime`.
  - `publishable` also requires `validSideSeconds(timed ? seconds : null)`. Publish `side, sideSeconds: timed ? seconds : null`.
  - `PlanCard`: `side` gains `'bilateral'`, plus `sideSeconds`. Show `record.timeEach` for Both and `record.time` otherwise, under the plan line. Do the same on the patient views.
  - `ProgressView` session side column: `s.measurements[0]?.side ?? s.prescription?.side`.

- [ ] **Step 4: Run.** `npm run typecheck`, `npm run lint`, `npm test`, `npx playwright test therapist.spec.ts patient.spec.ts --workers=1`, and `npm run build`. Expected: PASS. Rerun any file cut off by memory with `--workers=1`.

- [ ] **Step 5: Commit**: `feat: prescribe both sides and a time per side on the web`.

---

### Task 8: Documentation, validation record and tracking

**Files:**
- Modify: `docs/architecture/DATABASE.md`: one paragraph on `bilateral`, `side_seconds`, the measured-side storage and the history filter.
- Modify: `docs/PLAN.md:200`: the `prescription_versions` row mentions side `left/right/bilateral` and the optional time per side.
- Create: `docs/validation/BOTH-SIDES-SETS.md`: executed commands with their pass/fail output, and tests not executed (for example, connected tests without an emulator) listed as such. Add a rollout note: older installed Android builds skip `bilateral` prescriptions until the patient updates.
- Modify: `docs/validation/POST-IMPLEMENTATION-CHECKLIST.md`: deferred entries for the physical-phone check (voice timing, countdown, auto-start, repositioning, English and Filipino) and the therapist review (flow, default time, right-side framing). Mark them deferred, not passed.

- [ ] **Step 1: Write the docs** above with the real results from Tasks 1–7.
- [ ] **Step 2: Run `python scripts/check_admin_parity.py`.** It is unaffected because no `admin_*` function changes, but CI runs it. Run `python scripts/sync_sprints.py --validate-only`. Expected: both pass.
- [ ] **Step 3: Track it.** Create the GitHub issue `[MOT-NN] Both-sides exercise sets with a time per side` with `gh issue create`, using the next free MOT number and the labels `type:feature`, `area:android` and `priority:p1`. Link it to the commits, then close it with an evidence comment pointing to `docs/validation/BOTH-SIDES-SETS.md`. Deferred device and therapist checks stay in the checklist.
- [ ] **Step 4: Commit**: `docs: record both-sides sets and their validation`.
- [ ] **Step 5: Hosted rollout: ask the owner first.** Applying `202611110001_bilateral_sets.sql` to hosted Supabase, redeploying Vercel and building an Android release are outward-facing, so stop and ask before doing them.
