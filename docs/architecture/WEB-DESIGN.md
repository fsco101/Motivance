# Web workspace design

The design direction for the therapist and administrator web app (MOT-32). It extends the motion arc system in [UI-UX.md](UI-UX.md) to large screens; it is not a new brand. To review it, run the app and open `/design`, which shows every screen on sample data with real motion, or see the renders in [web-design](../validation/web-design/).

## The idea

A physical therapist measures a joint with a goniometer: a hinged protractor with a graduated scale. The workspace should feel like that instrument, precise and calm, rather than like a generic dashboard. The protractor is the one bold element. Everything around it stays quiet.

| Principle | What it means here |
| --- | --- |
| The measurement is the hero | Arcs and dials show real values. They are never decoration. |
| Spend boldness in one place | One memorable moment per page: the sign-in dial, the home fan. The rest is disciplined. |
| Only interactive things rise | Cards are for things a person can act on. Metrics and tables sit directly on the page. |
| Motion explains | Movement shows what changed or where you went. It is never the only signal. |
| Honest numbers | Show measured values only. No invented scores, and no comparison the data does not support. |

## What it deliberately avoids

The obvious brief for this product produces a wide dark sidebar, a row of metric tiles and a grid of identical white cards. That template was rejected:

| Default | Used here instead |
| --- | --- |
| Wide sidebar | A slim 96 px instrument rail with a graduated edge and a needle marking the current page |
| Boxed metric tiles | Plain readouts: large numbers on the page, with no card around them |
| Every section in a card | Tables and lists on the page ground, separated by hairlines |
| One radius and one grey shadow everywhere | Radius follows importance (28, 18 and 10 px), and elevation is tinted with Ink and reserved for interactive things |
| All-caps labels, eyebrows, middle-dot metadata, arrows on buttons | Sentence case, plain labels and two short lines instead of a joined string |

## Colour

The palette comes unchanged from `MotivanceTheme.kt`, so the two apps are recognisably one product. Tailwind's default palette is removed, so a colour outside this system cannot be used by accident.

| Token | Hex | Use |
| --- | --- | --- |
| Ink | `#0D2B36` | Text, the rail, hero surfaces |
| Lagoon | `#0E7C86` | Primary actions, measured values |
| Sprout / bright | `#1B7F45` / `#6FE08F` | A prescribed or reached range |
| Mist | `#F1F6F5` | Page ground |
| Tide | `#DCEFEC` | Tracks, tints, hover |
| Amber | `#E8A33D` | Caution and hold only, never success |

Web additions are Paper (raised surfaces), Slate (secondary text), Line (hairlines), Sprout deep (green text on its tint) and Alarm (destructive actions and errors).

## Type

| Face | Role | Why |
| --- | --- | --- |
| Bricolage Grotesque | Headings and the numbers people watch | Already the brand face on Android. Its optical sizing gives large numbers real character. |
| Atkinson Hyperlegible Next | Everything else | Designed so similar characters stay distinct. Its slashed zero is deliberate: when a value is clinical, 0 and O must never be confused. |

Both are self-hosted under the SIL Open Font License, with licences in `web/public/licenses/`. No font loads from a third party. Sizes follow the classical scale (12, 14, 16, 18, 21, 24, 36, 48, 60, 72), and text blocks stay under about 62 characters wide.

## Layout

```text
+----+------------------------------------------------------+
| o  | Home > Patients > Ana          [English|Filipino] (DR)|
| :  |                                                      |
| :- | Page title                              [One action] |
| :  | One sentence of context                              |
| :  |                                                      |
| :  | Content on a fluid grid, left aligned, up to 1600 px |
+----+------------------------------------------------------+
```

The rail never collapses, so there is one layout from 768 to 1920 px. Columns hide or stack before anything scrolls sideways. Content is left aligned, because staff scan down a left edge.

## Public pages

Visitors reach the landing page at `/`; a signed-in account skips it and goes to its workspace. These two pages also work on a phone, unlike the workspaces, which start at 768 px.

- **Landing hero.** A front-facing skeleton measures elbow flexion by itself, and anyone can take the hand and move it, by pointer or arrow keys. The angle, the prescribed band and the repetition count respond using the same rule as the app. It is labelled as sample movement, and it stops playing when it leaves the screen or someone takes over.
- **Landing content.** Three numbered steps (they really are a sequence), who each part is for, and the privacy facts in Android's own words. There are no statistics, logos or quotes, because the product has none yet.
- **Sign-in dial.** The needle answers the form: it rests at 20 degrees, climbs as the form is completed, swings past its mark while signing in, and drops back on an error. Below the desk breakpoint it becomes a compact panel above the form.
- **Sign-in details.** Warns when Caps Lock is on, moves between sign-in and the two recovery steps with a short transition, and states the 15-minute sign-out for shared computers.

## Interaction

- **Cards.** A card lifts, a soft light follows the pointer, and it settles under a press. Keyboard focus gets the same emphasis as hover.
- **Patient cards replay the movement.** On hover or focus the dial's needle sweeps from the patient's lowest to highest measured angle against the prescribed band. The card shows what happened rather than simply reacting to the pointer.
- **Expanding in place.** Detail opens inside the card, so a person keeps their place in the list.
- **Shared transition.** A patient's avatar travels from their card into the record header.
- **Tables.** The whole row is a target, and a real button in the row serves keyboards.
- **Dialogs.** Every consequential change names the record in a confirmation, using the same words as Android.

## Motion

All timing lives in `web/src/motion/tokens.ts`; no screen sets its own. The character is a goniometer needle: it travels quickly, passes its mark slightly and settles.

| Token | Value | Use |
| --- | --- | --- |
| `needle` spring | stiffness 170, damping 15 | Readings: dials, the rail marker, filter markers |
| `press` spring | stiffness 520, damping 34 | Things under the pointer, with no wobble |
| `layout` spring | stiffness 340, damping 36 | Things changing size or place |
| `quick`, `standard`, `slow`, `sweep` | 140, 220, 340, 900 ms | Fades, page changes, disclosures, arc draws |

Page changes follow navigation depth, as on Android: deeper slides in from the end edge, back from the start edge, sideways only fades.

Motion is restrained on purpose. Lists do not animate on every refresh. Administrator pages move less than therapist pages, because they are denser and used for longer.

Animations use transform and opacity, with two exceptions that do not disturb the rest of the page: SVG arc strokes draw by their dash offset, and a card expanding in place animates its height. `prefers-reduced-motion` removes all movement and shows final values at once.

## Accessibility

WCAG 2.1 AA, checked with axe on every screen. Every interactive thing works by keyboard, including both ends of the range arc, which are real sliders. Charts have a table alternative. Colour never carries meaning alone.

## Charts tell the truth

Progress charts show range of motion, which is the difference between two angles. An early draft drew the prescribed band behind that line, but the band holds absolute angles, so a line inside it would have looked on target without showing that. The band was removed, matching Android. Gaps in a line stay gaps, and nothing is smoothed.

## Known limits

- The launch theme is light only.
- Below the desk breakpoint, the account panel opens under the table rather than beside it. S8 should revisit this.
- The therapist Exercises page is not designed yet; it arrives with MOT-41.
