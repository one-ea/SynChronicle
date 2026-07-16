# Workbench UI Polish Design

## Scope

Optimize two existing Workbench controls without changing API behavior:

1. The create-run form in the right sidebar.
2. The desktop panel-width controls in the top bar.

## Create Run Form

- Present the form as a visually distinct sidebar card.
- Keep labels visible and add concise helper copy for model-set selection.
- Use a minimum 48px select and primary action height.
- Add sufficient sidebar bottom padding so the action remains reachable above the viewport edge.
- Keep the sidebar scrollable; the card participates in normal scrolling rather than covering other controls.
- Disable the primary action until a model set is selected and while submission is pending.
- Preserve keyboard focus, error feedback, and existing submission behavior.

## Layout Controls

- Replace the two always-visible range inputs with a single `布局` button in the desktop top bar.
- Open an anchored popover containing labeled controls for `作品栏` and `状态栏`.
- Display the current width in pixels beside each label.
- Include a `重置` action that restores the existing default widths.
- Close on Escape, outside click, or a second click on the trigger.
- Move initial focus into the popover and restore focus to the trigger when it closes.
- Hide the control on mobile, where the three-panel bottom navigation remains authoritative.

## Visual Direction

- Reuse the current literary editorial palette, typography, border, and spacing tokens.
- Keep the popover compact and rectangular with restrained elevation.
- Maintain 44px minimum interactive targets and visible focus states.
- Avoid layout shifts when opening or closing the popover.

## Verification

- Component tests cover disabled start state, model-set selection, reset, Escape, outside click, and focus restoration.
- Accessibility tests cover labels, dialog/popover semantics, and keyboard operation.
- Responsive checks cover 375px, 768px, 1024px, and 1440px widths.
- Existing Workbench controls and run creation tests remain green.
