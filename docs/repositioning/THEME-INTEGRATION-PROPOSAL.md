# Workspace themes through the shared theme compiler: integration proposal

**Status:** a plan for a later, separately authorized increment, 2026-11-26. **Nothing here is implemented or authorized.** It makes no change to af-site, `dspack-gen` or any other repository, adds no dependency, and copies no af-site code. It builds on the read-only discovery in [DESIGNER-FIRST-PROPOSAL.md](DESIGNER-FIRST-PROPOSAL.md#workspace-theming-and-the-aesthetic-function-theme-generator).

## The owner's decisions this plan follows

- **The af-site compiler graduates into `dspack-gen`.** Its proposal compiler (`scripts/theme-direction/`) is to become a shared compiler there. That move needs explicit licensing, ownership and cross-repository authorization first.
- **No second theme generator.** Composer does not get one of its own, and no private af-site code is copied into this public repository.
- **AF dark for D0 only.** Keeping the workspace AF dark during D0 is a temporary scope decision. Dark-only is not approved as a permanent restriction.
- **Four kinds of workspace theme in the future:**
  - **original AF**;
  - **neutral light**;
  - **neutral dark**;
  - **custom**, each produced by the shared compiler.
- **Workspace themes never change four things:**
  - composition definitions;
  - governance outcomes;
  - design-system tokens;
  - the computed styling of the canvas.

## Three things kept apart

| | What | Changed by | Reaches the canvas? |
|---|---|---|---|
| AF brand identity | The AF mark, the canonical palette and the type voice | Nobody in Composer (af-site canon) | No |
| Composer workspace appearance | The chrome: the app header, panels, toolbars and the inspector | A person, as a preference | **No, by construction and by test** |
| The canvas's design system | Astryx or shadcn/ui tokens inside the canvas | The design-system contract | It is what governance checks |

## Where Composer is today

- **An Appearance preference already exists.** It offers three governed dark themes: Aesthetic Function (the default), Ember and Slate (`apps/composer/app/appearance.ts`). It is stored as `composer.appearance.v1` and applied as `data-theme` on the root element.
- **Their values are copied by hand** from af-site into `globals.css` and `af-ui.css`.
- **All three are dark on purpose.** `globals.css` never sets `color-scheme` globally, because Astryx resolves `light-dark()` from the inherited scheme, and a light workspace would re-tint the canvas.
- **The D0 Library uses the same chrome variables.** It adds no theme of its own.

## The plan, in order

Each step needs its own authorization. The first two are outside this repository.

### 1. Licensing and ownership (owner decision, outside this repository)

- **The compiler's licence.** af-site is private and has no licence file. `dspack-gen` is Apache-2.0. The compiler can be consumed here only once its owner releases it under a licence compatible with this public repository, which is the planned graduation into `dspack-gen`.
- **Who owns the compiler after graduation.** One owner is needed for its contract (`theme-direction.v1`), its constraint set and its version, so that af-site and Composer are consumers, not forks.
- **The fonts are OFL-1.1.** Their licence texts travel with any font files bundled.

### 2. Graduation (in `dspack-gen`, separately authorized)

- **What moves.** The proposal schema, the compiler, the constraint solver and their tests move as one versioned package. They stay deterministic: no DOM, network, clock or randomness.
- **What does not.** The optional phrase-to-proposal front end needs hosted inference. It stays out of scope, with paid inference unauthorized.
- **af-site switches to the package,** so that there is one implementation.

### 3. Consumption in Composer (this repository, a later increment)

**The compiler.** Composer imports the graduated package at a pinned version. Nothing is vendored, and there is no local copy.

**Themes as proposals.**
- **Original AF** is the canonical AF proposal.
- **Neutral dark** and **neutral light** are two fixed proposals with low-chroma surfaces and accent.
- **Custom** is a proposal chosen with enum pickers: surface, accent, contrast and type voice. These are the compiler's own enums, so no raw values are ever entered.

**Semantic colours.** Composer's chrome needs colours the AF compiler does not model: error, warning, success, info, link and the violet accent. They are added to the compiler as derived outputs with constraints, so that each meets contrast on every surface it sits on. This is a compiler version bump, agreed with its owner, not a Composer-side patch.

**Typography.**
- The compiler emits family names. Composer loads faces through `next/font`, whose CSS variables are generated names. A small fixed mapping turns the compiler's type voice into one of the faces Composer bundles.
- An unknown voice falls back to the default face, and a test holds the mapping complete.
- No font is fetched at run time.

**Persistence.**
- **Store the proposal, not the values.** It goes in a versioned, validated record, beside or replacing `composer.appearance.v1`, and is recompiled at load. A malformed record gives the default theme and is kept aside, as the M1 storage already does.
- **Export.** A project export may carry the proposal, so an appearance travels without frozen values.

**Contrast validation.**
- The compiler fails closed: an unsatisfiable proposal produces no theme, and the chrome keeps the previous one.
- Composer's own tests also run axe on the workspace under each of the four kinds of theme, at 1280 and 390.

### 4. Canvas isolation (the guarantee, and how it is tested)

**Where the theme applies.**
- Theme variables are set on a chrome container, never on `:root` and never through `color-scheme` or `data-theme` where the canvas inherits.
- The canvas frame stays outside that container, or resets every chrome variable it could inherit.
- A light workspace sets `color-scheme: light` on the chrome container only.

**The isolation test.** For each kind of theme, and for both Astryx and shadcn/ui, it renders the same compositions and examples. Then it asserts:
- **Canvas styling.** Every element's computed `color`, `background-color`, `border-color`, `font-family`, `font-size` and `color-scheme` inside the canvas is identical to the default theme's.
- **Governance outcomes.** The instance, refusal and check results are identical, compared on the host's results, not the pixels.
- **Definitions.** The composition definitions and their hashes are unchanged.
- **Stored records.** No approval, draft or check record changes when the theme changes.

**Screenshots.** Pixel comparison of the canvas region under each theme is a second line of evidence. The computed-style assertions are the first.

## What this plan does not do

- No change to af-site, `dspack-gen` or any sibling repository until each is authorized.
- No hosted inference, including the phrase-to-theme front end.
- No theme inside the canvas. Design-system theming belongs to the design system's contract and to governance, not to workspace appearance.
- No change to D0, which keeps the AF dark workspace.

## Decisions needed before this increment

1. **The compiler's licence and owner**, and the authorization to graduate it into `dspack-gen`.
2. **Whether the existing Ember and Slate themes stay** as named proposals, or give way to neutral dark, neutral light and custom.
3. **The semantic colour set** Composer needs from the compiler, agreed with its owner.
4. **Whether a project export carries its appearance proposal.**
