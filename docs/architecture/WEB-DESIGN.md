# Web workspace design

The design direction for the therapist and administrator web app (MOT-32). It extends the motion arc system in [UI-UX.md](UI-UX.md) to large screens; it is not a new brand. To review it, run the app and open `/design`, which shows every screen on sample data with real motion, or see the renders in [web-design](../validation/web-design/).

## The idea

A physical therapist measures a joint with a goniometer: a hinged protractor with a graduated scale. The workspace should feel like that instrument, precise and calm, rather than like a generic dashboard. The protractor is the one bold element. Everything around it stays quiet.

| Principle | What it means here |
| --- | --- |
| The measurement is the hero | Arcs and dials show real values. They are never decoration. |
| Spend boldness in one place | One memorable moment per page: the sign-in dial, the home fan. The rest is disciplined. |
| Built for a desk | Mouse, keyboard and a wide screen come first. Lists are data tables, not stacked phone cards. |
| Only interactive things rise | Panels stay flat. Only what opens something, like a stat card, lifts under the pointer. |
| Motion explains | Movement shows what changed or where you went. It is never the only signal. |
| Honest numbers | Show measured values only. No invented scores, and no comparison the data does not support. |

## What it deliberately avoids

The first version kept a slim icon rail, 48 px titles, 60 px numbers and lists sitting on the page. The owner reviewed it and said it read as a mobile design, so the workspace was rebuilt as a desktop application. The goniometer idea stays, in the sidebar's graduated edge and needle, the home fan and the care coverage arc.

| Mobile habit | Used here instead |
| --- | --- |
| Icon bar with stacked labels | A 240 px sidebar with a row per page, folding to icons below 1024 px |
| Oversized titles and figures | 26 px page titles and 30 px figures |
| Timelines and stacked cards for lists | Data tables with sticky headers, in panels with a toolbar and footer |
| Expanding a card to see more | A row selects, and its details open beside the table |
| 44 px touch-sized controls | 40 px controls and 32 px table actions, sized for a mouse |
| All-caps labels, eyebrows, middle-dot metadata, arrows on buttons | Sentence case, plain labels and two short lines instead of a joined string |

## Colour

The palette comes unchanged from `MotivanceTheme.kt`, so the two apps are recognisably one product. Tailwind's default palette is removed, so a colour outside this system cannot be used by accident.

| Token | Hex | Use |
| --- | --- | --- |
| Ink | `#0D2B36` | Text, the sidebar, hero surfaces |
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
+-----------+------------------------------------------------+
| Motivance | Home > Patients > Ana     [English|Filipino] (DR)|
|           +------------------------------------------------+
| Workspace | Page title                         [One action] |
| > Home  --| One sentence of context                         |
|   Patients|                                                 |
|   Progress| [stat] [stat] [stat] [stat]                     |
|           | +---------------------------------------------+ |
|           | | Toolbar: search and filters                 | |
|           | | Table with a sticky header                  | |
|           | | Footer: count and Load more                 | |
|           | +---------------------------------------------+ |
+-----------+------------------------------------------------+
```

The sidebar and top bar stay in place while the page scrolls. Below 1024 px the sidebar folds to icons, with its labels kept for screen readers. Columns hide or stack before anything scrolls sideways. Content is left aligned, because staff scan down a left edge.

**Building blocks.** `Panel` is the surface, with an optional title, toolbar and footer. `DataTable` lists records, with sorting, grouping and a selected row. `StatCard` shows one server count and opens the page that explains it. `BarList` compares a few counts, and `RangeBar` shows prescribed and measured range on the 0 to 180 degree scale.

**Dashboards.** Both open with stat cards, then what needs a decision, then the detail. Every figure is a real count. A share such as care coverage is calculated from those counts, and nothing is estimated or scored. Account roles can overlap, so roles are compared with separate bars rather than as parts of one whole.

## Public pages

Visitors reach the landing page at `/`; a signed-in account skips it and goes to its workspace. These two pages also work on a phone, unlike the workspaces, which start at 768 px.

- **Landing hero.** A front-facing skeleton measures elbow flexion by itself, and anyone can take the hand and move it, by pointer or arrow keys. The angle, the prescribed band and the repetition count respond using the same rule as the app. It is labelled as sample movement, and it stops playing when it leaves the screen or someone takes over.
- **Landing content.** Three numbered steps (they really are a sequence), who each part is for, and the privacy facts in Android's own words. There are no statistics, logos or quotes, because the product has none yet.
- **Sign-in dial.** The needle answers the form: it rests at 20 degrees, climbs as the form is completed, swings past its mark while signing in, and drops back on an error. Below the desk breakpoint it becomes a compact panel above the form.
- **Sign-in details.** Warns when Caps Lock is on, moves between sign-in and the two recovery steps with a short transition, and states the 15-minute sign-out for shared computers.

## Interaction

- **Stat cards.** A card lifts, a soft light follows the pointer, and it settles under a press. Keyboard focus gets the same emphasis as hover.
- **Details beside the table.** Selecting an account or exercise opens it next to the list, so a person keeps their place.
- **Shared transition.** A patient's avatar travels from their table row into the record.
- **Tables.** The whole row is a target, and a real button in the row serves keyboards.
- **Toasts.** Results appear at the top right, just below the top bar, so they never cover the account menu or the page's main action.
- **Dialogs.** Every consequential change names the record in a confirmation, using the same words as Android.

## Motion

All timing lives in `web/src/motion/tokens.ts`; no screen sets its own. The character is a goniometer needle: it travels quickly, passes its mark slightly and settles.

| Token | Value | Use |
| --- | --- | --- |
| `needle` spring | stiffness 170, damping 15 | Readings: dials, the sidebar marker, filter markers |
| `press` spring | stiffness 520, damping 34 | Things under the pointer, with no wobble |
| `layout` spring | stiffness 340, damping 36 | Things changing size or place |
| `quick`, `standard`, `slow`, `sweep` | 140, 220, 340, 900 ms | Fades, page changes, disclosures, arc draws |

Page changes follow navigation depth, as on Android: deeper slides in from the end edge, back from the start edge, sideways only fades.

Motion is restrained on purpose. Lists do not animate on every refresh. Administrator pages move less than therapist pages, because they are denser and used for longer.

Animations use transform and opacity, with two exceptions that do not disturb the rest of the page: SVG arc strokes draw by their dash offset, and a card expanding in place animates its height. `prefers-reduced-motion` removes all movement and shows final values at once.

## Accessibility

WCAG 2.1 AA, checked with axe on every screen. Every interactive thing works by keyboard, including both ends of the range arc, which are real sliders. Charts have a table alternative. Colour never carries meaning alone.

Motion's press gesture has two side effects worth knowing. It makes the element focusable, so a card surface sets `tabIndex={-1}` and leaves the tab stops to the link and buttons inside it. It also turns Enter into a pointer press, so a button that opens a Radix menu passes `press={false}`, or the menu opens and closes at once.

## Charts tell the truth

Progress charts show range of motion, which is the difference between two angles. An early draft drew the prescribed band behind that line, but the band holds absolute angles, so a line inside it would have looked on target without showing that. The band was removed, matching Android. Gaps in a line stay gaps, and nothing is smoothed.

## Known limits

- The launch theme is light only.
- Below 1024 px, account and exercise details open under the table rather than beside it.
- The therapist Exercises page is not designed yet; it arrives with MOT-41.
