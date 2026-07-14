/**
 * Catalog `Text` -> shadcn/ui typography recipes. shadcn ships typography as
 * documented class recipes rather than a component; the catalog's variant
 * maps onto those recipes. Container Text (nested children) renders as div —
 * p cannot contain p — mirroring the Astryx renderer's rule.
 */
import type { FC } from "react";
import { childIds } from "@dspack-studio/a2ui-ingest";
import { cn } from "../cn";

const VARIANT_CLASS: Record<string, { cls: string; as: "h1" | "h2" | "h3" | "p" | "span" }> = {
  h1: { cls: "scroll-m-20 text-3xl font-extrabold tracking-tight", as: "h1" },
  h2: { cls: "scroll-m-20 text-2xl font-semibold tracking-tight", as: "h2" },
  h3: { cls: "scroll-m-20 text-lg font-semibold tracking-tight", as: "h3" },
  body: { cls: "text-sm leading-6", as: "p" },
  caption: { cls: "text-sm text-muted-foreground", as: "span" },
};

export const TextRender: FC<any> = ({ props, buildChild }) => {
  const m = VARIANT_CLASS[props.variant as string] ?? VARIANT_CLASS.body;
  const nested = childIds(props.children);
  const Tag = nested.length > 0 ? "div" : m.as;
  return (
    <Tag className={cn(m.cls, "block")}>
      {props.text}
      {nested.map((id) => (
        <span key={id} style={{ display: "contents" }}>
          {buildChild(id)}
        </span>
      ))}
    </Tag>
  );
};
