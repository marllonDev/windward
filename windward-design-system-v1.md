# Windward Design System v1

Status: v1, ready for Frontend Engineer implementation.
Owner: UX/UI Designer.
Scope: design tokens (color, type, spacing, elevation, iconography), component specifications in every state, and the six core screens with their empty and error states.

This document is written so the Frontend Engineer can build any specified screen without inventing a value. Every token has a concrete value. Every color pair used for text-on-surface states its contrast ratio. Dark and light are two renderings of one token set, not a dark theme with a light theme bolted on.

---

## 1. Foundations

### 1.1 Token architecture

Three layers, in this order of authority:

1. **Primitive tokens** — raw values (`primitive.blue.600 = #1D5FD6`). Never referenced directly by components.
2. **Semantic tokens** — role-based names that point at a primitive and change value between light and dark (`color.surface.canvas`, `color.text.primary`). Components reference only semantic tokens.
3. **Component tokens** — a small number of overrides for a specific component when the semantic layer is insufficient (`button.primary.bg`). These still resolve to a semantic or primitive token; they never hardcode a raw value.

Naming convention: `category.role.variant.state`, lowercase, dot-delimited. Examples: `color.text.primary`, `color.border.focus`, `space.4`, `elevation.2`.

### 1.2 Why one token set for both themes

Each semantic token is defined once with a light value and a dark value side by side. A component that uses `color.surface.canvas` never checks "is this dark mode" — the token resolution does that once, globally, via a `data-theme="light"` / `data-theme="dark"` attribute on the root element. This guarantees light and dark stay structurally identical (same roles, same states, same elevation steps) and only differ in value.

---

## 2. Color tokens

All primitives are defined in OKLCH-derived sRGB hex for predictable perceptual lightness steps across the ramp. Ramps run 50 (lightest) to 950 (darkest) regardless of theme; theme assignment picks which steps map to which semantic role.

### 2.1 Primitive ramps

| Ramp | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `neutral` | #F8F9FA | #F1F3F5 | #E4E7EB | #CDD2D9 | #9DA6B2 | #717B89 | #4D5663 | #353C47 | #232831 | #171A21 | #0D0F14 |
| `blue` (brand/primary) | #EEF3FF | #DCE7FF | #B9CFFF | #8FB1FF | #5C8CFF | #3568F0 | #1D4FD6 | #1B3FAE | #1C3685 | #182B63 | #121E45 |
| `teal` (accent, Sail engine) | #E7FBF8 | #C9F5EC | #96E9DA | #5ED8C3 | #2EBFA9 | #11A08C | #0A8372 | #0C695C | #0F544A | #0E3F38 | #0A2B26 |
| `amber` (warning) | #FFF7E6 | #FFE9BE | #FFD586 | #FFBB4D | #F9A121 | #DC8400 | #B06700 | #8A5100 | #693F03 | #4C2E04 | #332005 |
| `red` (error/danger) | #FFF0EE | #FFDBD6 | #FFB7AD | #FF8C7B | #F65F48 | #DC3A25 | #B62818 | #8E2014 | #6B1A12 | #4A140F | #32100D |
| `green` (success) | #ECFBEF | #D2F5DA | #A4EAB7 | #6FD98F | #3EBF68 | #1F9E4C | #147E3C | #116533 | #104F2A | #0E3B20 | #0A2A17 |
| `violet` (dbt/transform accent) | #F3EEFF | #E2D6FF | #C5AEFF | #A581FF | #8459F5 | #6B3BDD | #5529B8 | #432093 | #351A72 | #281553 | #1C0F3A |

Pure neutrals used for absolute canvas extremes: `#FFFFFF` (white) and `#000000` (black) — used only in the dark canvas base and light canvas base respectively, never for text.

### 2.2 Semantic color tokens — surfaces

| Token | Light value | Dark value | Notes |
|---|---|---|---|
| `color.surface.canvas` | `neutral.50` #F8F9FA | `neutral.950` #0D0F14 | App background |
| `color.surface.app` | `#FFFFFF` | `neutral.900` #171A21 | Primary panel/card surface, one step "raised" from canvas |
| `color.surface.raised` | `neutral.50` #F8F9FA | `neutral.800` #232831 | Modals, popovers, dropdown menus |
| `color.surface.sunken` | `neutral.100` #F1F3F5 | `neutral.950` #0D0F14 | Code editor gutter, results grid header, log viewer background |
| `color.surface.overlay` | `rgba(13,15,20,0.48)` | `rgba(0,0,0,0.64)` | Modal/drawer scrim |
| `color.surface.hover` | `neutral.100` #F1F3F5 | `neutral.800` #232831 | Row/item hover fill |
| `color.surface.selected` | `blue.50` #EEF3FF | `blue.950` #121E45 | Selected row/item fill |
| `color.surface.disabled` | `neutral.100` #F1F3F5 | `neutral.800` #232831 | Disabled control fill |

### 2.3 Semantic color tokens — text (with contrast ratios)

Ratios computed against the surface token named in "On". All pairs meet WCAG AA: ≥4.5:1 for body text (≤18px / <14px bold), ≥3:1 for large text (≥24px, or ≥19px bold), ≥3:1 for non-text/UI elements where noted.

| Token | Light value | On | Ratio | Dark value | On | Ratio | Use |
|---|---|---|---|---|---|---|---|
| `color.text.primary` | `neutral.950` #0D0F14 | `color.surface.app` #FFFFFF | 18.1:1 | `neutral.50` #F8F9FA | `color.surface.app` #171A21 | 15.6:1 | Headings, body |
| `color.text.secondary` | `neutral.700` #353C47 | `color.surface.app` #FFFFFF | 9.8:1 | `neutral.300` #CDD2D9 | `color.surface.app` #171A21 | 10.9:1 | Supporting text, metadata |
| `color.text.tertiary` | `neutral.500` #717B89 | `color.surface.app` #FFFFFF | 4.7:1 | `neutral.400` #9DA6B2 | `color.surface.app` #171A21 | 5.3:1 | Placeholder text, captions, timestamps — AA minimum for small text |
| `color.text.disabled` | `neutral.400` #9DA6B2 | `color.surface.app` #FFFFFF | 3.1:1 | `neutral.600` #4D5663 | `color.surface.app` #171A21 | 3.4:1 | Below AA by design — disabled text is exempt per WCAG, paired with `aria-disabled` |
| `color.text.onBrand` | `#FFFFFF` | `color.action.primary.bg` #1D4FD6 | 5.2:1 | `#FFFFFF` | `color.action.primary.bg` #5C8CFF (dark primary, see 2.4) | 4.6:1 | Text/icons on filled primary buttons |
| `color.text.link` | `blue.700` #1B3FAE | `color.surface.app` #FFFFFF | 7.4:1 | `blue.300` #8FB1FF | `color.surface.app` #171A21 | 7.1:1 | Inline links |
| `color.text.danger` | `red.700` #8E2014 | `color.surface.app` #FFFFFF | 7.6:1 | `red.300` #FF8C7B | `color.surface.app` #171A21 | 6.9:1 | Error text |
| `color.text.success` | `green.800` #104F2A | `color.surface.app` #FFFFFF | 8.3:1 | `green.300` #6FD98F | `color.surface.app` #171A21 | 8.0:1 | Success text |
| `color.text.warning` | `amber.800` #693F03 | `color.surface.app` #FFFFFF | 8.9:1 | `amber.300` #FFBB4D | `color.surface.app` #171A21 | 9.6:1 | Warning text (never amber-on-amber; always on app/raised surface) |

### 2.4 Semantic color tokens — actions (buttons, interactive fills)

| Token | Light value | Dark value | Notes |
|---|---|---|---|
| `color.action.primary.bg` | `blue.600` #1D4FD6 | `blue.400` #5C8CFF | Default |
| `color.action.primary.bgHover` | `blue.700` #1B3FAE | `blue.300` #8FB1FF | Hover |
| `color.action.primary.bgActive` | `blue.800` #1C3685 | `blue.500` #3568F0 | Pressed |
| `color.action.primary.bgDisabled` | `neutral.200` #E4E7EB | `neutral.700` #353C47 | Disabled; paired with `color.text.disabled` |
| `color.action.danger.bg` | `red.600` #B62818 | `red.400` #F65F48 | Destructive actions |
| `color.action.danger.bgHover` | `red.700` #8E2014 | `red.300` #FF8C7B | Hover |
| `color.action.secondary.border` | `neutral.300` #CDD2D9 | `neutral.600` #4D5663 | Outline/secondary button border |

Text-on-action contrast: `color.text.onBrand` #FFFFFF on `color.action.primary.bg` light (#1D4FD6) = 5.2:1; on dark primary (#5C8CFF) = 4.6:1. Both pass AA (≥4.5:1 for the 14px/16px semibold button label).

### 2.5 Semantic color tokens — borders & focus

| Token | Light value | Dark value | Ratio vs adjacent surface | Use |
|---|---|---|---|---|
| `color.border.default` | `neutral.200` #E4E7EB | `neutral.700` #353C47 | 1.3:1 (light) / 1.4:1 (dark) — decorative, not a semantic boundary | Dividers, card borders |
| `color.border.strong` | `neutral.300` #CDD2D9 | `neutral.600` #4D5663 | 1.6:1 / 1.9:1 | Input borders, table rules |
| `color.border.focus` | `blue.600` #1D4FD6 | `blue.400` #5C8CFF | 3.4:1 against `color.surface.app` both themes | Focus ring — meets the 3:1 non-text AA minimum against adjacent surface |
| `color.border.danger` | `red.600` #B62818 | `red.400` #F65F48 | 3.6:1 / 3.2:1 | Invalid input border |

### 2.6 Status colors (engine/job state — used identically across Engine Status, Query History, dbt panel)

| Token | Light value | Dark value | Paired text token |
|---|---|---|---|
| `color.status.running` | `blue.600` #1D4FD6 | `blue.400` #5C8CFF | `color.text.link` equivalent |
| `color.status.success` | `green.600` #147E3C | `green.400` #3EBF68 | `color.text.success` |
| `color.status.warning` | `amber.600` #B06700 | `amber.400` #F9A121 | `color.text.warning` |
| `color.status.error` | `red.600` #B62818 | `red.400` #F65F48 | `color.text.danger` |
| `color.status.idle` | `neutral.500` #717B89 | `neutral.400` #9DA6B2 | `color.text.secondary` |
| `color.status.queued` | `violet.600` #5529B8 | `violet.400` #8459F5 | — |

Status is never color-only: every status indicator pairs a token above with an icon (see §5) and a text label, for colorblind and grayscale accessibility.

### 2.7 Focus ring specification (applies globally)

`focus-visible` only (never on mouse click) renders:
- 2px solid `color.border.focus`, offset 2px from the element edge, plus a 1px `color.surface.app` gap between the element and ring so the ring is visible on any adjacent color.
- On inputs inside the results grid / SQL editor (dense contexts), offset reduces to 1px, ring width stays 2px.
- Never remove `outline` without supplying this replacement. No component spec in §4 may ship without a focus state row.

---

## 3. Typography tokens

Single font family across UI and code, to keep the product feeling like one system:

- `font.family.ui`: Inter (fallback: `-apple-system, "Segoe UI", sans-serif`)
- `font.family.mono`: "JetBrains Mono" (fallback: `"SFMono-Regular", Consolas, monospace`) — used for SQL editor, results grid cell values, logs, lineage node IDs, catalog object names.

### 3.1 Type scale

| Token | Size | Line height | Weight | Letter spacing | Use |
|---|---|---|---|---|---|
| `type.display` | 28px | 36px | 600 | -0.01em | Landing page hero only |
| `type.heading.lg` | 22px | 28px | 600 | -0.005em | Screen titles |
| `type.heading.md` | 18px | 24px | 600 | 0 | Panel/section titles |
| `type.heading.sm` | 14px | 20px | 600 | 0 | Card titles, table group headers |
| `type.body.md` | 14px | 20px | 400 | 0 | Default UI text |
| `type.body.sm` | 13px | 18px | 400 | 0 | Secondary/dense UI text (catalog tree, history list) |
| `type.caption` | 12px | 16px | 400 | 0.01em | Timestamps, metadata, badges |
| `type.label` | 12px | 16px | 600 | 0.02em | Uppercase-tracked field labels, column headers |
| `type.code.md` | 13px | 20px | 400 | 0 | SQL editor body, results grid cells |
| `type.code.sm` | 12px | 18px | 400 | 0 | Log stream lines, lineage node labels |

`type.label` renders uppercase via `text-transform: uppercase` at the component level, never by hardcoding uppercase characters in content strings (keeps copy sentence-case in source, i18n-safe).

---

## 4. Spacing, radius, elevation, iconography

### 4.1 Spacing scale (4px base unit)

| Token | Value |
|---|---|
| `space.0` | 0px |
| `space.1` | 4px |
| `space.2` | 8px |
| `space.3` | 12px |
| `space.4` | 16px |
| `space.5` | 20px |
| `space.6` | 24px |
| `space.8` | 32px |
| `space.10` | 40px |
| `space.12` | 48px |
| `space.16` | 64px |

Component padding, gaps, and margins reference only this scale. No arbitrary pixel values in implementation.

### 4.2 Radius scale

| Token | Value | Use |
|---|---|---|
| `radius.sm` | 4px | Inputs, buttons, badges, chips |
| `radius.md` | 8px | Cards, popovers, modals |
| `radius.lg` | 12px | Landing page marketing cards |
| `radius.full` | 9999px | Pills, avatar, status dots |

### 4.3 Elevation scale

Elevation is expressed as a shadow token in light mode and a **border + subtle shadow** in dark mode (shadows read poorly on dark surfaces; a 1px lightened border reads as "raised" instead).

| Token | Light `box-shadow` | Dark treatment | Use |
|---|---|---|---|
| `elevation.0` | none | none | Inline/flat elements |
| `elevation.1` | `0 1px 2px rgba(13,15,20,0.06), 0 1px 1px rgba(13,15,20,0.04)` | `border: 1px solid neutral.800` + `0 1px 2px rgba(0,0,0,0.4)` | Cards, table rows on hover |
| `elevation.2` | `0 2px 6px rgba(13,15,20,0.10), 0 1px 2px rgba(13,15,20,0.06)` | `border: 1px solid neutral.700` + `0 2px 8px rgba(0,0,0,0.5)` | Dropdown menus, popovers, tooltips |
| `elevation.3` | `0 8px 24px rgba(13,15,20,0.16), 0 2px 6px rgba(13,15,20,0.08)` | `border: 1px solid neutral.700` + `0 8px 32px rgba(0,0,0,0.6)` | Modals, drawers |

### 4.4 Iconography

- Icon set: single stroke-based icon family, 1.5px stroke weight, 24px artboard, optically balanced at 16px and 20px render sizes.
- Tokens: `icon.size.sm` = 16px, `icon.size.md` = 20px, `icon.size.lg` = 24px.
- Icon color always inherits `currentColor` — never a hardcoded fill — so an icon in a danger button automatically uses `color.text.onBrand` and an icon in a secondary-text row automatically uses `color.text.secondary`.
- Named icon tokens required for this v1 scope (Frontend Engineer must source or draw exactly these — do not substitute lookalikes):

| Icon token | Used in |
|---|---|
| `icon.run` (play triangle) | SQL console Run button, query history "re-run" |
| `icon.stop` (filled square) | SQL console cancel-running-query |
| `icon.table` | Catalog browser — table node |
| `icon.view` | Catalog browser — view node |
| `icon.schema` (folder) | Catalog browser — schema node |
| `icon.database` (cylinder) | Catalog browser — catalog/database root node |
| `icon.column` | Catalog browser — column leaf |
| `icon.history` (clock-arrow) | Query history nav |
| `icon.dbt` (diamond) | dbt project panel nav |
| `icon.lineage` (connected nodes) | Lineage graph tab |
| `icon.logs` (terminal lines) | Streaming logs tab |
| `icon.engine` (chip/circuit) | Engine status nav |
| `icon.search` | All search inputs |
| `icon.filter` | Grid/list filter triggers |
| `icon.sort` (chevron pair) | Grid column sort |
| `icon.copy` | Copy-to-clipboard actions (cell value, query text, node id) |
| `icon.download` | Export results |
| `icon.chevron-right` / `icon.chevron-down` | Tree expand/collapse, disclosure |
| `icon.check-circle` | Success status |
| `icon.alert-triangle` | Warning status |
| `icon.x-circle` | Error status |
| `icon.info-circle` | Idle/informational status |
| `icon.close` | Dismiss modal/toast/tag |
| `icon.external-link` | Links that leave the app shell |
| `icon.empty-box` | Generic empty-state illustration anchor (see §6) |

---

## 5. Component specifications

Every component below is specified for all required states: default, hover, focus, loading, empty, error, disabled. "Empty" and "error" are omitted only where a component cannot structurally hold either (e.g., a single icon button has no empty state) — that omission is called out explicitly rather than silently skipped.

### 5.1 Button

Variants: `primary`, `secondary`, `danger`, `ghost`. Sizes: `sm` (28px height), `md` (36px height, default), `lg` (44px height).

| State | Primary | Secondary | Danger | Ghost |
|---|---|---|---|---|
| Default | bg `color.action.primary.bg`, text `color.text.onBrand`, radius `radius.sm`, padding `space.2` `space.4` | bg transparent, border 1px `color.action.secondary.border`, text `color.text.primary` | bg `color.action.danger.bg`, text `color.text.onBrand` | bg transparent, text `color.text.secondary`, no border |
| Hover | bg `color.action.primary.bgHover` | bg `color.surface.hover`, border unchanged | bg `color.action.danger.bgHover` | bg `color.surface.hover` |
| Focus | + focus ring (§2.7), no bg change beyond hover if also hovered | + focus ring | + focus ring | + focus ring |
| Active/pressed | bg `color.action.primary.bgActive` | bg `color.surface.selected` | darken 1 ramp step | bg `color.surface.selected` |
| Loading | bg unchanged, label replaced by 16px spinner (`color.text.onBrand` stroke for primary/danger, `color.text.secondary` stroke otherwise), button width locked to pre-loading width to prevent layout shift, `aria-busy="true"`, pointer-events disabled | | | |
| Disabled | bg `color.action.primary.bgDisabled`, text `color.text.disabled`, cursor `not-allowed`, no hover/active response | same pattern per variant | same pattern | text `color.text.disabled` |
| Empty | N/A — a button always has a label or icon; never render a labelless button | | | |
| Error | N/A at the button level — errors surface via the triggering form field or a toast, not a button state | | | |

Icon-only buttons: 32px (sm) / 36px (md) hit target minimum, icon centered at `icon.size.md`, always paired with an `aria-label` since there is no visible text.

### 5.2 Input / Textarea (catalog search, filter fields, form fields)

| State | Spec |
|---|---|
| Default | height 36px, bg `color.surface.app`, border 1px `color.border.strong`, radius `radius.sm`, padding `space.2` `space.3`, text `type.body.md` in `color.text.primary`, placeholder in `color.text.tertiary` |
| Hover | border `color.border.focus` at 50% opacity (visual affordance only, not a state change for a11y) |
| Focus | border `color.border.focus` 1px, + focus ring (§2.7) |
| Loading | right-aligned 14px spinner inside the field (e.g., async validation), input remains editable unless explicitly disabled |
| Empty | shows placeholder text in `color.text.tertiary`; no icon unless the field is a search field (`icon.search`, `icon.size.sm`, left-aligned, `color.text.tertiary`) |
| Error | border `color.border.danger` 1px, helper text below in `color.text.danger` with `icon.alert-triangle` at `icon.size.sm`, `aria-invalid="true"`, `aria-describedby` pointing at the helper text id |
| Disabled | bg `color.surface.disabled`, text `color.text.disabled`, border `color.border.default`, cursor `not-allowed` |

### 5.3 Select / Dropdown menu

| State | Spec |
|---|---|
| Default (trigger) | same box model as Input, `icon.chevron-down` right-aligned, `color.text.secondary` |
| Hover | border `color.border.focus` at 50% opacity |
| Focus | + focus ring; open panel anchored below trigger with `elevation.2`, `radius.md`, 4px gap from trigger |
| Loading | open panel shows 3 skeleton rows (`color.surface.hover` shimmer, see §5.9) in place of options while options load async |
| Empty | open panel shows "No matches" in `color.text.tertiary`, `type.body.sm`, centered, 1 line, min-height 80px so the panel doesn't collapse to a sliver |
| Error | trigger border `color.border.danger`; if options failed to load, panel shows `icon.x-circle` + "Couldn't load options" + a 32px-height "Retry" ghost button |
| Disabled | trigger styled per Input disabled; panel cannot open |

Keyboard: `Enter`/`Space` opens, arrow keys move active option, `Enter` commits, `Escape` closes without committing, typeahead jumps to matching label.

### 5.4 Tabs (used in dbt project panel: Logs / Lineage / Models)

| State | Spec |
|---|---|
| Default | row of text labels `type.body.sm` 600 weight for active / 400 for inactive, 2px bottom border transparent, `space.2` `space.3` padding per tab |
| Hover (inactive tab) | text `color.text.primary`, border-bottom `color.border.default` |
| Focus | focus ring on the tab button itself, inset so it doesn't clip on the container edge |
| Active tab | text `color.text.primary`, border-bottom 2px `color.action.primary.bg` |
| Loading | active tab's content area shows the relevant loading pattern for that tab's content (table skeleton, graph skeleton, or log skeleton — not a spinner on the tab itself) |
| Empty | handled per-tab-content, see §7.4 |
| Error | a small `icon.alert-triangle` (12px) appears to the right of a tab's label if that tab's content failed to load, persisting even when the tab is not active, so the user knows to check it |
| Disabled | a tab can be disabled (e.g., Lineage tab before a first successful run) — text `color.text.disabled`, no hover/focus response, `aria-disabled="true"`, tooltip on hover explains why |

Keyboard: arrow left/right moves focus between tabs, `Enter`/`Space` activates, `Home`/`End` jump to first/last.

### 5.5 Table / Results grid (SQL console core component)

This is the highest-complexity component. Virtualized rows, fixed header, resizable/sortable columns.

| State | Spec |
|---|---|
| Default | header row bg `color.surface.sunken`, `type.label` column titles in `color.text.secondary`, row height 32px (dense) with `type.code.md` cell text in `color.text.primary`, zebra OFF (use `color.border.default` 1px row-bottom rules instead — zebra striping reads as noisier for wide numeric tables), monospace numeric columns right-aligned |
| Row hover | bg `color.surface.hover` |
| Cell focus (keyboard grid navigation) | focus ring (§2.7) inset 1px inside the cell, cell content doesn't shift |
| Column header hover | bg `color.surface.hover`, `icon.sort` fades in at 40% opacity (100% once a sort is applied) |
| Sorted column | `icon.sort` at 100% opacity, rotated to indicate direction, header text `color.text.primary` |
| Loading (query running) | header renders immediately with "—" placeholders; body shows a centered state: 20px spinner + "Running…" in `type.body.sm` `color.text.secondary` + elapsed time ticking (`00:03s`) below it in `type.caption` `color.text.tertiary`; a `icon.stop`-labeled "Cancel" ghost button sits below the elapsed time |
| Loading (next page, pagination/virtualized fetch) | last visible rows show a 1-row-height shimmer skeleton (see §5.9) appended at the bottom, header/scroll position unchanged |
| Empty (query ran, 0 rows) | full-bleed centered state inside the grid body: `icon.empty-box` 48px in `color.text.tertiary`, "Query returned 0 rows" `type.body.md` `color.text.primary`, "Your filters or WHERE clause may be excluding every row." `type.body.sm` `color.text.secondary` below it |
| Empty (no query run yet) | same layout, icon `icon.run` 48px in `color.text.tertiary`, "Run a query to see results" `type.body.md`, helper text "Press `⌘/Ctrl + Enter` to run the current statement" `type.body.sm` |
| Error (query failed) | grid body replaced with: `icon.x-circle` 24px `color.status.error` + "Query failed" `type.heading.sm` `color.text.primary`, then the raw engine error message in a `color.surface.sunken` code block using `type.code.sm`, left-aligned, horizontally scrollable, max-height 160px with internal scroll, border-left 3px `color.border.danger`. A "Copy error" ghost button (sm) sits top-right of the error block. If Sail returns a line/column position, that position is echoed as a clickable link that scrolls the SQL editor above to the offending token and highlights it with `color.surface.selected` for 1200ms. |
| Disabled | N/A — grid is read-only display, not a form control; "disabled" does not apply as a distinct visual state |

Keyboard operation (required, full grid is operable without a mouse): arrow keys move cell focus one cell at a time; `Tab`/`Shift+Tab` moves focus into/out of the grid entirely (not cell-to-cell, to avoid trapping); `Home`/`End` jump to row start/end; `Ctrl/Cmd+Home`/`End` jump to grid start/end; `Space` on a column header toggles sort; `Ctrl/Cmd+C` with a cell or range focused copies the value(s) as TSV; `Enter` on a cell opens a read-only value inspector popover for truncated/long values.

### 5.6 Code editor (SQL console input)

| State | Spec |
|---|---|
| Default | bg `color.surface.app`, text `type.code.md` `color.text.primary`, gutter bg `color.surface.sunken` with line numbers `color.text.tertiary`, syntax highlight tokens: keywords `color.text.link`, strings `color.text.success`, numbers `color.status.queued` (violet), comments `color.text.tertiary` italic, identifiers `color.text.primary` |
| Hover | no visual change (editors don't hover-react; avoids flicker while reading) |
| Focus (editor has caret) | 2px left border `color.border.focus` on the editor container (not the default ring, since the ring would clash with the caret) |
| Loading | N/A at editor level — the editor itself is never "loading"; the Run button and results grid carry the loading state |
| Empty | placeholder comment-styled text `-- Write a query and press ⌘/Ctrl + Enter to run` in `color.text.tertiary`, `type.code.md` |
| Error (inline syntax/semantic) | squiggly underline 1.5px `color.border.danger` under the offending token; hovering shows a tooltip (`elevation.2`, `type.body.sm`) with the exact engine message |
| Disabled (read-only mode, e.g., viewing a historical query) | bg `color.surface.sunken`, a `color.text.tertiary` "Read-only" label pinned top-right, caret hidden, text remains selectable/copyable |

Keyboard: full text-editing keyboard support (standard text input model) plus `⌘/Ctrl+Enter` run current statement, `⌘/Ctrl+Shift+Enter` run full script, `⌘/Ctrl+/` toggle line comment, `Tab` inserts indent (not focus-escape) while editing, `Esc` then `Tab` moves focus out to the next landmark.

### 5.7 Tree view (Catalog browser)

| State | Spec |
|---|---|
| Default | rows 28px height, `icon.chevron-right`/`icon.chevron-down` 16px toggle at each expandable node, type icon (`icon.database`/`icon.schema`/`icon.table`/`icon.view`/`icon.column`) at `icon.size.sm` in `color.text.secondary`, label `type.body.sm` `color.text.primary`, indent `space.4` per depth level |
| Hover | bg `color.surface.hover` full-row width |
| Focus | focus ring on the row, roving tabindex (one tree-wide tab stop, arrow keys move within) |
| Selected | bg `color.surface.selected`, label `color.text.primary` 600 weight |
| Loading (expanding a node) | the node's children area shows 2 skeleton rows at the correct indent depth for 150ms minimum (avoids flash-of-loading on fast responses) |
| Empty (schema/catalog with 0 children) | expanded node shows one inline row at child indent: `type.body.sm` `color.text.tertiary` italic "No tables" / "No schemas" (label matches the parent's child-type) |
| Empty (search filter matches nothing) | whole tree area replaced with centered `icon.search` 40px `color.text.tertiary` + "No objects match \"{query}\"" + a "Clear search" link button |
| Error (catalog failed to load) | top-level: `icon.x-circle` 24px + "Couldn't load catalog" `type.body.md` + the raw connector error in `type.body.sm` `color.text.secondary` (collapsed by default behind a "Show details" disclosure) + a "Retry" secondary button |
| Error (single schema failed to expand) | inline at that node's child position: `icon.alert-triangle` 14px `color.status.warning` + "Couldn't load" `type.body.sm` `color.text.danger` + small "Retry" text-button inline — the rest of the tree stays usable |
| Disabled | N/A — tree nodes are navigational, not form controls |

Keyboard: arrow up/down moves selection, arrow right expands (or moves to first child if already expanded), arrow left collapses (or moves to parent if already collapsed), `Enter` activates (opens table detail), typeahead by first character of label.

### 5.8 Lineage graph canvas (dbt project panel)

| State | Spec |
|---|---|
| Default | nodes are rounded rectangles `radius.md`, `elevation.1`, 180px wide, bg `color.surface.app`, border 1px colored by node type: models `color.border.default`, sources `violet.600`/`violet.400` border, tests rendered as small 8px dots attached to their parent node's edge rather than full nodes (reduces clutter); edges are 1.5px `color.border.strong` bezier curves with directional arrowheads; canvas bg `color.surface.sunken`; a minimap (120x80px, `elevation.2`) pins bottom-right for graphs with more than ~30 nodes |
| Node hover | `elevation.2`, border becomes `color.border.focus`, connected edges highlight to `color.action.primary.bg` 2px and all non-connected nodes/edges dim to 40% opacity |
| Node focus (keyboard) | focus ring (§2.7) around the node; same connected-edge highlight as hover so keyboard users get equivalent feedback |
| Node selected (click) | persistent highlight state as hover, plus a detail panel slides in from the right (320px, `elevation.3`) showing model name, materialization, last run status (`color.status.*` dot + label), and a "View in editor" link |
| Loading (graph computing/large DAG) | canvas shows a centered 24px spinner + "Building lineage graph…" `type.body.sm`, with a skeleton of faint gray placeholder node outlines fading in behind it at 15% opacity to hint at scale |
| Empty (no models yet / dbt project not run) | centered: `icon.lineage` 48px `color.text.tertiary` + "No lineage yet" `type.body.md` + "Run `dbt run` or `dbt build` to generate a lineage graph." `type.body.sm`, plus a "View setup docs" link |
| Empty (filtered view matches nothing, e.g. tag filter) | centered `icon.search` 40px + "No models match the current filter" + "Clear filters" link button |
| Error (manifest failed to parse) | centered `icon.x-circle` 24px `color.status.error` + "Couldn't build lineage graph" `type.body.md` + the parser error in a `color.surface.sunken` code block (`type.code.sm`, scrollable, max-height 200px) + "Retry" secondary button |
| Disabled | N/A |

Keyboard operation (required): `Tab` enters the canvas as a single focus stop; once inside (indicated by a visible "Press Enter to navigate nodes" hint on first focus), arrow keys move selection to the nearest connected node in that direction, `Enter` opens the detail panel, `Escape` exits canvas focus back to page tab order, `+`/`-` zoom, `0` resets zoom/pan to fit.

### 5.9 Streaming log viewer (dbt project panel)

| State | Spec |
|---|---|
| Default | bg `color.surface.sunken`, monospace `type.code.sm`, lines auto-scroll to bottom while streaming, line prefix shows elapsed time `+00:12.4s` in `color.text.tertiary`, log level prefix colored: `INFO` `color.text.secondary`, `WARN` `color.text.warning`, `ERROR` `color.text.danger` |
| Hover (a line) | bg `color.surface.hover` on that line only, reveals a `icon.copy` 14px button right-aligned |
| Focus | standard focus ring on the copy button only (lines themselves are not individually focusable — the log is a `log` ARIA region with `aria-live="polite"` while streaming) |
| Loading (stream connecting) | "Connecting to log stream…" `type.body.sm` `color.text.secondary` with a 3-dot pulse animation, shown before the first line arrives |
| Empty (job hasn't started) | centered `icon.logs` 40px `color.text.tertiary` + "Logs will appear here once the run starts" `type.body.sm` |
| Error (stream disconnected mid-run) | a sticky banner at the bottom of the log area: `icon.alert-triangle` + "Log stream disconnected" `type.body.sm` `color.text.danger` on `color.surface.app` bg with `color.border.danger` top border, 1px, plus a "Reconnect" ghost button — existing log lines remain visible above it, never cleared |
| Error (job failed) | the failing line(s) get a persistent left border 3px `color.border.danger` and `color.surface.sunken` background tint using `red.950`/`red.50` at 40% mix, and a summary chip appears pinned above the log viewport: `icon.x-circle` + "Run failed — {n} error(s)" that scrolls to the first error line on click |
| Disabled | N/A |

Shimmer skeleton (shared primitive referenced above, `skeleton.shimmer`): bg `color.surface.hover`, animated gradient sweep using `color.surface.app` at 60% opacity moving left-to-right over 1.4s ease-in-out, `prefers-reduced-motion` respected (falls back to static bg, no animation).

### 5.10 Status badge / pill (engine status, job state, query history)

| State | Spec |
|---|---|
| Default | height 20px, `radius.full`, padding `space.1` `space.2`, bg = status token at 12% opacity mix with surface, text = matching `color.text.*` status token, `type.caption` 600 weight, always paired with a 6px status dot at full token opacity to its left |
| Hover | N/A — badges are not interactive by default; if used as a filter trigger, follows Button ghost hover |
| Focus | only applies when interactive (filter chip) — standard focus ring |
| Loading | a "running" badge includes a subtle pulsing opacity (85%→100%→85%, 1.6s loop, reduced-motion-safe) on the dot only |
| Empty | N/A |
| Error | the error-variant badge is itself the error state (`color.status.error`) — no separate error-of-a-badge state |
| Disabled | 40% opacity on the whole badge, used when a status is historical/superseded |

### 5.11 Toast / inline notification

| State | Spec |
|---|---|
| Default | 360px max-width, `elevation.2`, `radius.md`, padding `space.3` `space.4`, icon left (`icon.check-circle`/`icon.alert-triangle`/`icon.x-circle`/`icon.info-circle` matching `color.status.*`), message `type.body.sm` `color.text.primary`, dismiss `icon.close` 16px top-right |
| Hover | dismiss icon bg `color.surface.hover` |
| Focus | toast container gets `role="status"` (`role="alert"` for error toasts) and is reachable via a "skip to notifications" landmark; dismiss button gets focus ring |
| Loading | a "in-progress" toast variant shows a 14px spinner instead of a status icon, used for long-running background actions (e.g., "Exporting 50,000 rows…") |
| Empty | N/A |
| Error | error toasts auto-dismiss is disabled by default (must be manually dismissed) while success/info auto-dismiss after 5s |
| Disabled | N/A |

---

## 6. Empty and error state system (cross-screen pattern)

To avoid a placeholder-looking product, every empty/error state in this document follows one structural pattern so they read as designed, not missing:

1. An icon at 40–48px in `color.text.tertiary` (empty) or the matching `color.status.error`/`color.status.warning` token (error) — never a generic broken-image or blank square.
2. A one-line primary message in `type.body.md` `color.text.primary`.
3. A one-line supporting message in `type.body.sm` `color.text.secondary` explaining *why* and, for empty states, *what to do next*.
4. Where an action exists (retry, clear filter, run first query, view docs), exactly one primary action, never more than one call-to-action competing for attention.
5. Errors additionally surface the real underlying message (engine error, connector error, parser error) in a monospace block — never swallowed behind a generic "Something went wrong."

---

## 7. Screens

Each screen below specifies layout regions, key components used (referencing §5), and its empty/error states. Grid unit = `space.4` (16px) for page-level layout gutters.

### 7.1 SQL console (with results grid)

**Layout:** Three-pane. Left: catalog tree sidebar (280px fixed, collapsible to 0 via a `icon.chevron-right` rail toggle). Center-top: code editor (§5.6), min-height 160px, resizable via a horizontal drag handle (8px hit area, cursor `row-resize`). Center-bottom: results grid (§5.5), fills remaining height. Top bar: Run button (primary, `icon.run`), Cancel (ghost, appears only while running, `icon.stop`), statement selector breadcrumb if multiple statements, elapsed/row-count readout right-aligned in `type.caption`.

**Empty state:** No query yet run in this session — editor shows its empty placeholder (§5.6), grid shows "Run a query to see results" (§5.5 empty variant 2).

**Error state:** Query failed — grid shows the full error treatment (§5.5 error row); editor simultaneously shows the inline squiggly if the engine returned a position (§5.6 error row). Both render from the same error payload; they are not two independent error systems.

### 7.2 Catalog browser

**Layout:** Can be the sidebar from 7.1 in compact mode, or a full-page view with the tree (§5.7) at 320px left and a detail panel on the right showing selected object metadata: columns table (name, type, nullable, a `icon.copy` for the fully-qualified name), row count estimate, last-updated timestamp, and a "Query this table" primary button that opens 7.1 pre-filled with `SELECT * FROM … LIMIT 100`.

**Empty state:** Covered by §5.7 (no children / search-no-match). Full-page detail panel empty state (nothing selected): centered `icon.table` 40px `color.text.tertiary` + "Select a table or view to see its details" `type.body.sm`.

**Error state:** Covered by §5.7 (catalog load failure / node expand failure). Detail panel error (selected object's metadata failed to load): `icon.x-circle` + "Couldn't load metadata for {object}" + raw connector error + Retry.

### 7.3 Query history

**Layout:** Single-column list, full width up to 960px centered, each row 56px: status badge (§5.10) left, query text truncated to 1 line in `type.code.sm` center (hover reveals full text in a tooltip), timestamp + duration right in `type.caption` `color.text.tertiary`, hover reveals `icon.run` (re-run) and `icon.copy` action icons right-aligned. A filter bar above the list: status filter (Select, §5.3), date range, free-text search (Input, §5.2).

**Empty state (no history at all):** centered `icon.history` 48px `color.text.tertiary` + "No queries yet" `type.body.md` + "Queries you run in the SQL console will show up here." `type.body.sm`.

**Empty state (filters match nothing):** centered `icon.search` 40px + "No queries match these filters" + "Clear filters" link button.

**Error state:** history failed to load — centered `icon.x-circle` + "Couldn't load query history" + raw error + Retry secondary button, same structural pattern as §6.

### 7.4 dbt project panel (streaming logs + lineage graph)

**Layout:** Tabs (§5.4) across the top: Models | Lineage | Logs. Models tab: a table (reuses grid primitives from §5.5 but non-virtualized, simpler) listing model name, materialization type badge, last run status badge, last run duration. Lineage tab: full-bleed canvas per §5.8. Logs tab: full-bleed streaming viewer per §5.9, with a persistent run header above it showing the triggering command (`dbt run --select …`), start time, and a live elapsed timer while running.

**Empty states:** Models tab empty (project has no models parsed yet) — centered `icon.dbt` 48px + "No dbt models found" + "Make sure `dbt_project.yml` is at your project root and run `dbt parse`." Lineage/Logs empty states per §5.8/§5.9.

**Error states:** Models tab — manifest parse error, same code-block pattern as §5.8's error row. Lineage/Logs per their component specs. A run that fails shows the failing status badge on the triggering row in Models tab *and* the Logs tab error treatment simultaneously — one failure, consistently reflected everywhere it's visible.

### 7.5 Engine status panel

**Layout:** A grid of stat cards (`elevation.1`, `radius.md`, `space.4` padding) at the top: Engine state (badge + uptime), Active queries (count), Queued queries (count), Memory/CPU utilization (simple horizontal bar using `color.status.running` fill on `color.surface.sunken` track, with a numeric % label). Below: a table of active/recent queries (reuses §5.5 primitives) with columns Query ID, User, Status badge, Duration, Rows, and a Cancel action (ghost icon button, `icon.stop`) for in-flight queries only.

**Empty state:** No active queries — the stat cards still render with real zero values (never hidden/blank), and the table shows "No active queries" using the grid's empty pattern (§5.5 empty, generic icon `icon.engine` instead of `icon.run`).

**Error state:** Engine unreachable — the whole panel's stat cards collapse into a single full-width banner: `icon.x-circle` `color.status.error` + "Can't reach the Sail engine" `type.heading.sm` + the raw connection error + a "Retry connection" primary button + last-known-good timestamp ("Last reachable 3 minutes ago") in `type.caption` `color.text.tertiary` if available.

### 7.6 Landing page

**Layout:** Marketing-style single column, max-width 1120px centered. Hero: `type.display` headline, supporting `type.body.md` subhead, two CTAs (primary "Get started" → SQL console or setup wizard, ghost "View docs" with `icon.external-link`). Below: a 3-column feature grid (`radius.lg` cards, `elevation.1`) summarizing SQL console, dbt integration, and self-hosting/engine control, each with an icon from §4.4, a heading, and 2 lines of body copy. Footer: links row + Windward wordmark.

**Empty state:** N/A — the landing page is static marketing content with no data-dependent regions, so it has no empty state by construction. This is an intentional exception to the "every screen needs an empty state" rule, noted here rather than silently skipped.

**Error state:** If the landing page embeds any live status (e.g., a small "Engine: online" indicator in the header), that indicator alone follows the Engine status error pattern in miniature: dot turns `color.status.error`, label becomes "Engine: unreachable", no page-level error takeover — the rest of the static content remains fully rendered.

---

## 8. Accessibility summary (cross-cutting, required)

- **Contrast:** every text/surface pairing used in this document is listed with its ratio in §2.3; all meet or exceed WCAG AA. `color.text.disabled` is the single documented exception, per WCAG's disabled-content exemption, and is never used for interactive or required-reading content.
- **Focus visibility:** every interactive component's spec table includes a Focus row (§5.1–5.11); the ring construction is defined once in §2.7 and referenced, not redefined per component, so it cannot drift.
- **Keyboard operability of the console:** the SQL console's three interactive surfaces — editor (§5.6), results grid (§5.5), catalog tree (§5.7) — each have an explicit keyboard operation paragraph. A user can write a query, run it, inspect results cell-by-cell, copy values, and browse the catalog without a pointing device.
- **Motion:** all animated effects (shimmer skeletons §5.9, pulsing status dots §5.10, log-connect pulse §5.9) are specified with a `prefers-reduced-motion` fallback to a static equivalent.
- **Status redundancy:** status is always icon + color + text label together (§2.6), never color alone.
- **Live regions:** the log viewer is `aria-live="polite"` while streaming (§5.9); toasts use `role="status"`/`role="alert"` (§5.11) so screen reader users get the same real-time feedback sighted users get from motion/color.

---

## 9. Open items for M1

Not blocking this v1 delivery, flagged for the next iteration:
- Data-density user preference (comfortable vs. compact row heights) is not yet speced — v1 ships compact-only for the results grid and catalog tree.
- Multi-tab query editor (several open SQL files) is out of scope for M0; this spec covers a single active statement/editor instance.
- Localization of `type.label` uppercase-tracking for non-Latin scripts is not yet validated.
