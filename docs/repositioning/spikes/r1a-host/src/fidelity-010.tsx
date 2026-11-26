import { createElement } from "react";
import { A2uiCanvas } from "@dspack-studio/a2ui-ingest";
import { astryxRegistry } from "@dspack-studio/astryx-renderers";
import { mountFidelity, type Renderer } from "./fidelity-app";

const Render: Renderer = ({ catalog, messages, onAction }) => createElement(A2uiCanvas, { catalog, registry: astryxRegistry, messages, onAction });
mountFidelity("Composer's canvas: a2ui-ingest on @a2ui/react 0.10 + Composer's Astryx renderers", Render);
