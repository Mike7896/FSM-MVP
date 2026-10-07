---
name: ServiceClerk authentication
description: Auth-scoped documentation of the inherited Archivo/Inter charcoal and amber identity.
colors:
  brand-ink: "#16202a"
  brand-amber: "#e8a317"
  brand-amber-700: "#96620a"
  brand-amber-300: "#f7ce85"
  brand-neutral-100: "#f4f6f8"
  brand-neutral-800: "#1f2933"
typography:
  display:
    fontFamily: "Archivo, sans-serif"
    fontSize: "clamp(56px, 6.4vw, 102px)"
    fontWeight: 650
    lineHeight: 1.02
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Archivo, sans-serif"
    fontSize: "clamp(30px, 3vw, 38px)"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.7
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 550
rounded:
  control: "8px"
spacing:
  field-gap: "9px"
  form-gap: "22px"
  section-gap: "24px"
  card-gap: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brand-amber}"
    textColor: "{colors.brand-neutral-800}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  input:
    rounded: "{rounded.control}"
    height: "48px"
  form:
    width: "100%"
---

# Design System: ServiceClerk authentication

## Overview

**Creative North Star: "Less paperwork. More day."**

This records the completed authentication surfaces only. The existing global Archivo/Inter typography and charcoal/amber identity are inherited. It does not prescribe changes to the dashboard or public marketing surfaces. The auth direction is grounded in `docs/auth-redesign/direction.md`; no new product identity is inferred in the absence of PRODUCT.md.

Generous type and a quiet, unboxed form support contractors entering their workspace between jobs. A charcoal story panel establishes recognition; the theme-aware form ground keeps the task legible.

**Key Characteristics:**
- Strong typographic hierarchy.
- Spacious controls and compact mobile navigation.
- Flat surfaces, fine rules, and amber emphasis.

## Colors

### Primary
Amber supplies the primary action fill and the large story emphasis. Deep amber carries accent text in light mode; pale amber carries it in dark mode. Use the existing semantic CSS variables so theme changes remain coherent.

### Neutral
Charcoal anchors the story panel in both themes. Light neutral supplies its text. The form uses the global background in light mode and the global card surface in dark mode; field backgrounds retain the global background.

**The Amber Ink Rule.** Primary buttons use dark ink on amber. Small accent text uses the theme's primary-ink role.

## Typography

Archivo provides the manifesto and form heading; Inter provides explanatory copy, fields, and actions. The display and headline roles are auth-specific extensions of the inherited identity. Story description uses relaxed leading (16px / 1.75); field text remains readable on phones (16px).

## Layout

The full-height shell uses a two-column grid (0.95fr / 1.05fr) and a minimum height of 100svh. The centered form has a maximum width of 416px. At 900px and below, the columns become 0.8fr / 1fr and the manifesto uses clamp(42px, 6vw, 54px). At 700px and below, the story panel disappears and the compact brand header precedes the form, with 24px horizontal gutters. Large screens at 1600px and above constrain story copy to 600px.

## Elevation & Depth

The auth form is transparent, borderless, and shadowless. Tonal separation and fine divider rules organize the shell. Focus rings communicate interaction state rather than depth.

## Shapes

Controls and alerts have gently rounded corners. The unboxed form and its divider footer have square corners. Buttons have a minimum height of 48px; shell navigation and footer links have 44px minimum targets.

## Components

- **Buttons:** Amber primary action, inherited outline secondary action, wrapping labels, and visible focus rings. Background and border transitions use 160ms ease-out when reduced motion is not requested.
- **Inputs:** Full-width fields with visible semantic input borders, theme background, and 14px horizontal padding. Focus and invalid states come from the shared input component.
- **Forms:** Shared card markup becomes an unboxed reading column inside the auth shell. Labels, descriptions, feedback, and route-specific behavior remain part of each form.
- **Navigation:** Home and support links frame the task. Mobile replaces the back label with the wordmark. Privacy and terms remain accessible in the footer.

## Do's and Don'ts

- Do keep auth sizing scoped to the auth shell.
- Do use the inherited semantic theme variables and visible keyboard focus.
- Do use the shared shell for account, recovery, invitation, and OAuth error screens.
- Don't apply the auth composition or larger controls globally.
- Don't introduce decorative raster imagery to this code-led auth direction. The captured screenshots are review evidence, not shipping assets.
