---
name: Kinetic Clinical Precision
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#43474f'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737780'
  outline-variant: '#c3c6d0'
  surface-tint: '#3f608d'
  primary: '#002042'
  on-primary: '#ffffff'
  primary-container: '#0f3661'
  on-primary-container: '#80a0d1'
  inverse-primary: '#a8c8fc'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#311c00'
  on-tertiary: '#ffffff'
  tertiary-container: '#4e2f00'
  on-tertiary-container: '#dd8d00'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d4e3ff'
  primary-fixed-dim: '#a8c8fc'
  on-primary-fixed: '#001c3a'
  on-primary-fixed-variant: '#254874'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '800'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.005em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.05em
  data-metric:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '800'
    lineHeight: 40px
    letterSpacing: -0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.25rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.25rem
---

## Brand & Style

The design system is engineered for dual-stakeholder engagement: elderly or mobility-impaired patients requiring high-clarity guidance, and clinical therapists demanding accurate biomechanical monitoring. The emotional tone bridges clinical authority with empowering encouragement—sterile enough to validate academic and medical efficacy, yet warm and vibrant enough to reduce kinesiophobia (fear of movement).

The visual aesthetic unites **Modern Clinical Minimalism** with **Biomechanical Precision**:
- **Clarity First**: Vast optical white surfaces, ultra-high contrast touch targets, and legible data telemetry reduce cognitive burden during physical exertion.
- **Dynamic Feedback**: Responsive teal and energetic amber micro-cues immediately validate pose estimation, joint alignment, and range-of-motion metrics without overwhelming the user.
- **Physical Softness**: Generous radii, pill-shaped tactile controls, and soft atmospheric shadows remove the intimidating edge of traditional hospital software, transforming the mobile screen into an intuitive rehabilitation station.

## Colors

The palette balances authoritative medical navy with kinetic rehabilitation accents, adhering rigorously to WCAG 2.1 AA/AAA contrast ratios for low-vision and senior accessibility.

- **Primary (`#0F3661`)**: Deep Clinical Navy anchors headers, primary action buttons, posture guidelines, and structural navigation. Communicates clinical validation and diagnostic reliability.
- **Secondary (`#0D9488`)**: Active Rehabilitation Teal designates active computer-vision tracking states, joint skeletal overlays, correct exercise repetitions, and progression metrics.
- **Tertiary (`#F59E0B`)**: Dynamic Amber provides real-time biomechanical feedback, angle warnings, and posture correction callouts before errors occur.
- **Neutral (`#64748B`)**: Slate neutral governs supporting metric labels, disabled controls, and secondary narrative text over pure clinical white (`#FFFFFF`) and wash backgrounds (`#F8FAFC`).
- **Semantic Accents**:
  - **Success Emerald (`#10B981`)**: Repetition completions, achieved target range-of-motion, session sign-offs.
  - **Correction Coral (`#EF4444`)**: Joint hyperextension warnings, loss of camera tracking, fatigue alerts.
  - **Surface Tiers**: Base `#FFFFFF` on `#F8FAFC` slate canvas, partitioned with crisp `#E2E8F0` clinical dividers.

## Typography

Plus Jakarta Sans serves across display, body, and telemetry roles due to its wide apertures, tall x-height, and clean geometric curves that retain optical legibility at distance—essential when a patient is standing 6–10 feet back from a smartphone camera.

- **Scale & Contrast**: Minimum standard text size for interactive states is set to `15px` (`body-md`) to ensure effortless scannability for senior users.
- **Metric Readability**: The specialized `data-metric` style prioritizes live real-time rep counts, degrees of extension, and velocity indicators. Tabular numerals (`tnum`) should be programmatically enforced across all dynamic counters to eliminate layout jitter during active vision inferencing.
- **Hierarchy Rules**: All clinical instructional titles leverage bold weight (`700`/`800`) to provide instant orientation during rapid movement exercises.

## Layout & Spacing

The layout model adheres to an 8-point harmonic rhythm mapped to a 4-column fluid mobile grid (expanding to 8 columns on tablet viewports used by attending clinicians).

- **Touch Safety & Ergonomics**: All actionable controls observe an expanded minimum touch target of 52×52px to accommodate patients with tremors, fine-motor limitations, or impaired coordination.
- **Vision Screen Architecture**: Live pose tracking interfaces use a unified safe-zone framework: bottom-anchored HUDs float over the lower third, clearing the primary camera view while placing controls within the thumb's natural sweep radius.
- **Section Rhythm**: A standard `margin` of `1.25rem` (20px) creates a continuous visual spine down the canvas, preventing cards and interactive components from binding against device bezels. Vertical stacking between disparate modules uses `space-lg` (24px) for distinct visual breathing room.

## Elevation & Depth

Visual hierarchy uses a refined **Tonal-Atmospheric** model tailored for medical utility, avoiding heavy dramatic drop shadows in favor of pristine clinical layering:

- **Surface Level 0 (Canvas)**: Background canvas sits at `#F8FAFC`.
- **Surface Level 1 (Resting Cards & Containers)**: Crisp pure white `#FFFFFF` cards, framed with a 1px structural stroke of `#E2E8F0` and an ambient shadow: `0 4px 20px -2px rgba(15, 54, 97, 0.05)`.
- **Surface Level 2 (Interactive Floating HUD & Overlays)**: Live video feed overlays, dynamic rep counters, and therapist telemetry sheets sit atop `#FFFFFF` at 92% opacity with a `12px` backdrop blur, bordered with `rgba(226, 232, 240, 0.8)` and elevated by `0 12px 32px -4px rgba(15, 54, 97, 0.12)`.
- **Surface Level 3 (Critical Modals & Biomechanical Alerts)**: Direct clinician prompts and alert dialogs leverage `0 20px 48px -8px rgba(15, 54, 97, 0.20)` to immediately isolate focus from ambient motion.

## Shapes

The design system deploys balanced curvature (`roundedness: 2`) tailored to high-grade clinical hardware and software:

- **Base Components**: Text inputs, session chips, and standard list items use `rounded-md` (0.5rem / 8px).
- **Primary Patient Cards**: Metric summaries, movement guides, and diagnostic summaries use `rounded-2xl` (1rem / 16px) and `rounded-3xl` (1.5rem / 24px) to convey an approachable, non-intimidating clinical atmosphere.
- **Camera Frame Overlay**: Live computer-vision targeting reticles and skeleton tracking landmarks utilize fully rounded circular markers and pill caps (`9999px`) to eliminate harsh vertex points within the video feed.

## Components

### Buttons
- **Primary Action**: Solid `#0F3661` with `#FFFFFF` text, `56px` height for effortless reach, `rounded-xl`, with bold 16px typography. Focus and active states scale subtly (`scale(0.98)`) and introduce a `0 0 0 3px rgba(13, 148, 136, 0.35)` ring.
- **Active Movement / Start Session**: Dual-accent teal button `#0D9488` with crisp white text, deploying an animated subtle emerald glow when the vision model confirms the patient is in frame.
- **Secondary Clinical**: Surface `#FFFFFF`, 1.5px border `#E2E8F0`, text `#0F3661`. Hover/Tap shifts background to `#F1F5F9`.

### Telemetry Cards & Metric Blocks
- Structured on pure `#FFFFFF` with `rounded-2xl` geometry and `space-md` internal padding.
- Displays prominent real-time numbers using the `data-metric` font style, flanked by directional progress indicators: Teal `#0D9488` for target reached, Amber `#F59E0B` for range calibration needed.
- Cards host an optional upper status-rail: a 3px accent line indicating active joint focus (e.g., knee flexion, shoulder abduction).

### Chips & Filter Badges
- Height of `36px` to maintain touch standards.
- Resting: `#F1F5F9` background, `#475569` text, no border.
- Selected / Clinical Active: `#0F3661` background with `#FFFFFF` text or `#CCFBF1` (Teal-tint) with `#0F766E` text for completed rehabilitation milestones.

### Camera HUD & Joint Angle Overlay
- Semi-transparent HUD floats over the camera feed using 85% opacity dark navy (`rgba(15, 54, 97, 0.85)`) with white crisp lettering for high-noon or uneven room lighting conditions.
- Real-time joint trajectory circles feature a 2px stroke in `#14B8A6` with an inner white core, morphing to `#EF4444` if unsafe extension limits are breached.

### Form Inputs & Adjusters
- Height of `52px` with a 1.5px `#E2E8F0` border, `rounded-lg`, and `#FFFFFF` fill.
- Focus switches border to `#0D9488` with a 2px soft ring.
- High-contrast clinical labels rest securely above inputs in `label-md` with neutral `#334155`.

### Lists & Protocol Steps
- Inset cards separated by `space-sm` rather than hairline dividers, creating distinct tactile rows.
- Each row integrates a leading numeric or status avatar (e.g., green check or exercise icon in a `40x40px` circular container with `#F0FDFA` background) and a trailing Chevron for unambiguous touch affordance.