import "katex/dist/katex.min.css";
import "../../../src/editor/editor-theme.css";
import { mountRichReadonlyDocument } from "../../../rich-readonly";
import { requiredHTMLElement } from "./utils";

const source = `# Upgrade Target

Read-only first paint with $x^2$ and [@sec:next].

## Next {#sec:next}

Body text.
`;

const root = requiredHTMLElement("root");
const lifecycle: string[] = [];
const readyFeatures: string[] = [];
const changes: string[] = [];
const documentChanges: number[] = [];
const dirtyStates: boolean[] = [];
const saves: string[] = [];
const mounted = mountRichReadonlyDocument({
  root,
  source,
  renderOptions: {
    resolveReferences: true,
    sourcePositions: true,
  },
  hydration: {
    math: true,
    references: true,
  },
  onLifecycle(event) {
    lifecycle.push(event.phase);
  },
});

Object.assign(window, {
  __coflatRichReadonlyUpgrade: async () => {
    await mounted.ready;
    const editor = await mounted.upgradeToEditor({
      mode: "rich-readonly",
      onFeatureReady(feature) {
        readyFeatures.push(feature);
      },
      onChange(doc) {
        changes.push(doc);
      },
      onDocumentChange(change) {
        documentChanges.push(change.changes.empty ? 0 : 1);
      },
      statusEvents: {
        onDirtyChange(next) {
          dirtyStates.push(next);
        },
      },
      saveHandler: {
        async save({ source, reason }) {
          saves.push(`${reason}:${source}`);
          return { ok: true };
        },
      },
    });
    Object.assign(window, {
      __coflatEditor: editor,
    });
    return {
      contentEditable: document.querySelector(".cm-content")?.getAttribute("contenteditable"),
      doc: editor.getDoc(),
    };
  },
  __coflatLifecycle: lifecycle,
  __coflatReadyFeatures: readyFeatures,
  __coflatChanges: changes,
  __coflatDocumentChanges: documentChanges,
  __coflatDirtyStates: dirtyStates,
  __coflatSaves: saves,
});
