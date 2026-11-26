import { createElement, useMemo } from "react";
import { buildCatalog016, Surface016 } from "./bridge-016";
import { mountFidelity, type Renderer } from "./fidelity-app";

const Render: Renderer = ({ catalog, messages, onAction }) => {
  const built = useMemo(() => buildCatalog016(catalog), [catalog]);
  (window as any).__fidelity.unrendered = built.unrendered;
  return createElement(Surface016, { built, messages, onAction });
};
mountFidelity("upstream @a2ui/react 0.16.1 + spike bridge + Composer's Astryx renderers", Render);
