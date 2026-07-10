/**
 * The Astryx A2UI mapping profile: pure data describing how the Astryx dspack
 * contract's components correspond to A2UI catalog components.
 *
 * Unlike the shadcn contract, the Astryx contract is props-based (AlertDialog
 * carries title/description/actionLabel directly; Button carries label), so
 * most props map verbatim and far less flattening is required. Only two
 * synthesis classes remain:
 *   - declarative Actions (A2UI requires them; the contract expresses onClick
 *     handlers, which a declarative catalog cannot carry), and
 *   - the Column layout primitive (dspack describes a component library, not
 *     a layout system).
 *
 * dropdown-menu is the one casualty: its `items` array has no defined item
 * shape in the contract yet, so a faithful A2UI projection is deferred until
 * the contract specifies it (scenario 3 work).
 */
import type { Profile } from "@aestheticfunction/dspack-emit";

const DynStr = { $ref: "#/$defs/DynamicString" };
const CompId = { $ref: "#/$defs/ComponentId" };
const ActionRef = { $ref: "#/$defs/Action" };

export const astryxProfile: Profile = {
  catalogTitle: "Astryx — A2UI catalog (compiled from dspack)",
  catalogDescription:
    "A2UI catalog compiled from the Astryx dspack v0.4 contract. The Astryx contract is " +
    "props-based, so component shapes and variant enums project onto A2UI mostly verbatim; " +
    "declarative actions and the Column layout primitive are synthesized and warned.",
  catalogIdBase: "https://aestheticfunction.github.io/dspack-studio/catalogs/astryx",
  instructions: "For layout, use the Column component to organize other components.",
  // The Astryx contract carries no token block; theming is deferred to the
  // Astryx theme layer at render time (primaryColor resolves to null, warned).
  primaryColorToken: { category: "color", name: "primary" },
  surfaceSynthesis: {
    textComponent: "Text",
    textProp: "text",
    wrapComponent: "Column",
    wrapChildrenProp: "children",
  },

  components: [
    {
      a2ui: "Button",
      dspackId: "button",
      commons: ["ComponentCommon", "Checkable"],
      structural: {
        action: {
          schema: ActionRef,
          description: "The interaction dispatched when the button is activated.",
          synthNote:
            "A2UI requires a declarative action; the contract expresses this as an onPress " +
            "handler prop, which is not representable in a declarative catalog.",
        },
      },
      propMap: {
        label: {
          a2ui: "label",
          kind: "string",
          description: "The button's visible label (required by rule.button-carries-label).",
        },
        variant: {
          a2ui: "variant",
          kind: "enum",
          targetEnum: ["primary", "secondary", "ghost", "destructive"],
          default: "primary",
          description: "Button visual treatment, carried verbatim from the Astryx contract.",
        },
        size: {
          a2ui: "size",
          kind: "enum",
          targetEnum: ["sm", "md", "lg"],
          default: "md",
          description: "Button size, carried verbatim.",
        },
        isDisabled: {
          a2ui: "isDisabled",
          kind: "boolean",
          description: "Disables the button.",
        },
        isIconOnly: {
          a2ui: "isIconOnly",
          kind: "boolean",
          description: "Renders the button as icon-only; the label becomes the accessible name.",
        },
        tooltip: {
          a2ui: "tooltip",
          kind: "string",
          description: "Optional tooltip text.",
        },
      },
      required: ["label", "action"],
      surfacePlan: { actionProp: "action" },
    },

    {
      a2ui: "Card",
      dspackId: "card",
      commons: ["ComponentCommon"],
      structural: {
        child: {
          schema: CompId,
          description:
            "The ID of the single child component. Wrap multiple elements in a Column and pass its ID.",
          synthNote:
            "A2UI Card takes exactly one child by ID; the contract's Card takes arbitrary " +
            "children, which collapse to a single (possibly wrapped) child slot.",
        },
      },
      propMap: {
        variant: {
          a2ui: "variant",
          kind: "enum",
          targetEnum: [
            "default", "muted",
            "blue", "cyan", "gray", "green", "orange", "pink", "purple", "red", "teal", "yellow",
          ],
          default: "default",
          description:
            "Card background variant, carried verbatim (default/muted plus the color variants, " +
            "which categorize rather than signal status).",
        },
      },
      required: ["child"],
      surfacePlan: { childProp: "child" },
    },

    {
      a2ui: "TextField",
      dspackId: "text-input",
      commons: ["ComponentCommon", "Checkable"],
      structural: {
        value: {
          schema: DynStr,
          description: "The bound value of the text field.",
          synthNote:
            "A2UI two-way-binds value; the contract's TextInput has no value prop (state " +
            "lives outside the component library).",
        },
      },
      propMap: {
        label: {
          a2ui: "label",
          kind: "string",
          description: "The visible field label (required by rule.input-carries-label).",
        },
        type: {
          a2ui: "variant",
          kind: "enum",
          targetEnum: ["shortText", "obscured"],
          valueMap: { text: "shortText", email: "shortText", password: "obscured" },
          default: "shortText",
          description: "Input kind, projected from the contract's input type onto A2UI TextField variants.",
        },
        placeholder: {
          a2ui: "placeholder",
          kind: "string",
          description: "Placeholder text shown when the field is empty.",
        },
        description: {
          a2ui: "description",
          kind: "string",
          description: "Helper text describing the field.",
        },
        isLabelHidden: {
          a2ui: "isLabelHidden",
          kind: "boolean",
          description: "Visually hides the label while keeping it accessible.",
        },
        isRequired: {
          a2ui: "isRequired",
          kind: "boolean",
          description: "Marks the field as required.",
        },
        size: {
          a2ui: "size",
          kind: "enum",
          targetEnum: ["sm", "md", "lg"],
          default: "md",
          description: "Field size, carried verbatim.",
        },
      },
      required: ["label"],
      surfacePlan: {},
    },

    {
      a2ui: "Badge",
      dspackId: "badge",
      commons: ["ComponentCommon"],
      structural: {},
      propMap: {
        label: {
          a2ui: "label",
          kind: "string",
          description: "The badge text.",
        },
        variant: {
          a2ui: "variant",
          kind: "enum",
          targetEnum: [
            "neutral", "info", "success", "warning", "error",
            "blue", "cyan", "green", "orange", "pink", "purple", "red", "teal", "yellow",
          ],
          default: "neutral",
          description: "Badge visual treatment, carried verbatim (all fourteen Astryx variants).",
        },
      },
      required: ["label"],
      surfacePlan: {},
    },

    {
      a2ui: "Table",
      dspackId: "table",
      commons: ["ComponentCommon"],
      structural: {
        columns: {
          schema: { type: "array", items: { type: "string" } },
          description: "Header labels for the data columns.",
          synthNote:
            "The contract's columns prop is an array without an item shape; projected as " +
            "static header labels.",
        },
        data: {
          schema: { type: "array", items: { type: "object" } },
          description: "Row records, each { cells: string[], status?: { label, variant } }.",
          synthNote: "Row data carried as a static array; A2UI has no tabular data model.",
        },
      },
      propMap: {
        density: {
          a2ui: "density",
          kind: "enum",
          targetEnum: ["compact", "balanced", "spacious"],
          default: "balanced",
          description: "Row density, carried verbatim.",
        },
        dividers: {
          a2ui: "dividers",
          kind: "enum",
          targetEnum: ["rows", "columns", "grid", "none"],
          default: "rows",
          description: "Divider style, carried verbatim.",
        },
        isStriped: {
          a2ui: "isStriped",
          kind: "boolean",
          description: "Alternates row backgrounds.",
        },
      },
      required: ["columns", "data"],
      surfacePlan: { structuralPassthrough: ["columns", "data"] },
    },

    {
      a2ui: "AlertDialog",
      dspackId: "alert-dialog",
      commons: ["ComponentCommon"],
      structural: {
        action: {
          schema: ActionRef,
          description: "Event dispatched when the user confirms the action.",
          synthNote:
            "A2UI declarative action; the contract expresses confirmation as an onAction handler.",
        },
      },
      propMap: {
        title: {
          a2ui: "title",
          kind: "string",
          description: "Confirmation title (required by rule.alertdialog-carries-content).",
        },
        description: {
          a2ui: "description",
          kind: "string",
          description: "Consequence description (required by rule.alertdialog-carries-content).",
        },
        actionLabel: {
          a2ui: "actionLabel",
          kind: "string",
          description:
            "Label of the confirm action. Must name the action specifically " +
            "(rule.alertdialog-action-label-specific forbids OK/Confirm/Yes/Continue).",
        },
        cancelLabel: {
          a2ui: "cancelLabel",
          kind: "string",
          description: "Label of the cancel action.",
        },
        actionVariant: {
          a2ui: "actionVariant",
          kind: "enum",
          targetEnum: ["primary", "secondary", "ghost", "destructive"],
          default: "primary",
          description: "Visual treatment of the confirm action button, carried verbatim.",
        },
      },
      required: ["title", "actionLabel", "action"],
      surfacePlan: { actionProp: "action" },
    },

    {
      a2ui: "Dialog",
      dspackId: "dialog",
      commons: ["ComponentCommon"],
      structural: {
        child: {
          schema: CompId,
          description:
            "The ID of the dialog's content component. Wrap multiple elements in a Column and pass its ID.",
          synthNote:
            "The contract's Dialog takes arbitrary children, which collapse to a single " +
            "(possibly wrapped) child slot.",
        },
        title: {
          schema: DynStr,
          description: "Dialog title shown in the header.",
          synthNote: "Synthesized from the Astryx DialogHeader idiom; not a contract prop.",
        },
      },
      propMap: {
        variant: {
          a2ui: "variant",
          kind: "enum",
          targetEnum: ["standard", "fullscreen"],
          default: "standard",
          description: "Dialog presentation, carried verbatim.",
        },
        purpose: {
          a2ui: "purpose",
          kind: "enum",
          targetEnum: ["required", "form", "info"],
          default: "info",
          description: "Dialog dismissal semantics, carried verbatim.",
        },
      },
      required: ["child"],
      surfacePlan: { childProp: "child" },
    },

    {
      a2ui: "Text",
      dspackId: "text",
      commons: ["ComponentCommon"],
      structural: {
        text: {
          schema: DynStr,
          description: "The text content to display (optional when the node only nests children).",
          synthNote:
            "The contract's Text takes children (ReactNode); surfaces express content as the " +
            "node's text, projected into this property.",
        },
        children: {
          schema: { $ref: "#/$defs/ChildList" },
          description: "Nested child component IDs rendered after the text content.",
          synthNote:
            "The contract's Text takes arbitrary children; models routinely nest text nodes " +
            "(measured 10/12 emitter refusals before this slot existed), and Astryx Text " +
            "renders nested children natively — so the projection carries them.",
        },
      },
      // The contract's `as` prop (rendered HTML element: span/p/div/label) has
      // no A2UI counterpart and is a deliberate dropped-prop casualty.
      propMap: {
        type: {
          a2ui: "variant",
          kind: "enum",
          targetEnum: ["h1", "h2", "h3", "body", "caption"],
          valueMap: {
            "display-1": "h1", "display-2": "h1", "display-3": "h2", large: "h3",
            body: "body", code: "body", label: "caption", supporting: "caption",
          },
          default: "body",
          description:
            "Base text style, projected from the contract's semantic text type (the display " +
            "scale collapses onto the heading variants; label/supporting project to caption; " +
            "code collapses to body).",
        },
      },
      // `text` is optional: container text nodes (children only) are valid.
      required: [],
      surfacePlan: { textProp: "text", childrenProp: "children" },
    },
  ],

  synthesized: [
    {
      a2ui: "Column",
      commons: ["ComponentCommon"],
      description:
        "Arranges children vertically. Synthesized A2UI structural primitive (the contract " +
        "has no layout component; its layout knowledge is descriptive only).",
      structural: {
        children: {
          schema: { $ref: "#/$defs/ChildList" },
          description: "Child component IDs (or a template).",
          synthNote: "A2UI structural primitive required to compose multiple children.",
        },
      },
      propMap: {
        justify: {
          a2ui: "justify",
          kind: "enum",
          targetEnum: ["start", "center", "end", "spaceBetween", "spaceAround", "spaceEvenly", "stretch"],
          default: "start",
          description: "Arrangement of children along the vertical main axis.",
        },
        align: {
          a2ui: "align",
          kind: "enum",
          targetEnum: ["center", "end", "start", "stretch"],
          default: "stretch",
          description: "Alignment of children along the horizontal cross axis.",
        },
      },
      required: ["children"],
    },
  ],

  casualtyComponents: [
    {
      dspackId: "dropdown-menu",
      attempted: "(none)",
      class: "cannot-represent",
      reason:
        "The contract's dropdown-menu carries an `items` array with no declared item shape " +
        "(labels? actions? separators?). A faithful A2UI projection is deferred until the " +
        "contract specifies the item vocabulary.",
    },
  ],
};
