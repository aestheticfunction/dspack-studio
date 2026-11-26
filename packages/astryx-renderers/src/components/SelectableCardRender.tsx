/**
 * Catalog `SelectableCard` -> Astryx SelectableCard. Presentational in
 * replay: `isSelected` is delivered state (selection lives in the shared
 * data model), so onChange is a no-op until the interaction overlay grounds
 * a select action.
 *
 * The visible name (D1, docs/repositioning/R1A-REVIEW.md §5 and §10). The
 * contract requires every option card's `label` and treats it as the option's
 * visible name (`rule.option-carries-label`: how an alternative is
 * "identified, compared, and announced"). Astryx renders `label` only as the
 * hidden checkbox's `aria-label`, by design, so an option card showed no name.
 * This adapter draws the label as the card's first line, in Astryx's own
 * `large` semibold type, and keeps the checkbox the one element that announces
 * it: the drawn name is `aria-hidden`, so a screen reader hears the name once,
 * as the checkbox's accessible name, which is the same text as the visible one
 * (WCAG 2.5.3). It is not a heading: a card inside a list is an option, not a
 * section. Where a child Text already shows the same text, nothing is added.
 * Astryx itself is unchanged.
 */
import type { FC } from "react";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Text } from "@astryxdesign/core/Text";
import { childIds } from "@dspack-studio/a2ui-ingest";

const VARIANTS = new Set([
  "default", "transparent", "muted",
  "blue", "cyan", "gray", "green", "orange", "pink", "purple", "red", "teal", "yellow",
]);

const same = (a: unknown, b: string) => typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether a Text among the card's descendants already shows the label (read from the surface, bounded). */
function childShowsName(context: any, ids: string[], label: string): boolean {
  const components = context?.surfaceComponents;
  if (!components || typeof components.get !== "function") return false;
  const seen = new Set<string>();
  const stack = [...ids];
  while (stack.length > 0 && seen.size < 200) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const c = components.get(id);
    if (!c) continue;
    if (c.type === "Text" && same(c.properties?.text, label)) return true;
    stack.push(...childIds(c.properties?.children), ...(typeof c.properties?.child === "string" ? [c.properties.child] : []));
  }
  return false;
}

export const SelectableCardRender: FC<any> = ({ props, buildChild, context }) => {
  const label = String(props.label ?? "");
  const children = childIds(props.children);
  const drawName = label.trim() !== "" && !childShowsName(context, children, label);
  return (
    <SelectableCard
      label={label}
      isSelected={Boolean(props.isSelected)}
      isDisabled={Boolean(props.isDisabled)}
      variant={VARIANTS.has(props.variant as string) ? (props.variant as any) : "default"}
      onChange={() => {}}
    >
      {drawName && (
        <Text type="large" weight="semibold" as="span" display="block" aria-hidden="true" data-selectable-card-name="" style={{ overflowWrap: "anywhere" }}>
          {label}
        </Text>
      )}
      {children.map(buildChild)}
    </SelectableCard>
  );
};
