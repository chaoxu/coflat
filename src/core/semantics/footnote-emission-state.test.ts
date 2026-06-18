import { describe, expect, it } from "vitest";

import {
  createFootnoteEmissionState,
  footnoteEmissionSectionEntries,
  registerFootnoteDefinition,
  registerFootnoteReference,
  snapshotFootnoteEmissionState,
} from "./footnote-emission-state";

describe("footnote emission state", () => {
  it("registers references and definitions with first-seen numbering", () => {
    const state = createFootnoteEmissionState<string>();

    expect(registerFootnoteReference(state, "a")).toMatchObject({
      id: "a",
      number: 1,
      hasRef: true,
    });
    expect(registerFootnoteDefinition(state, "b", "orphan body")).toMatchObject({
      id: "b",
      number: 2,
      body: "orphan body",
      hasRef: false,
    });
    expect(registerFootnoteDefinition(state, "a", "body")).toMatchObject({
      id: "a",
      number: 1,
      body: "body",
      hasRef: true,
    });

    expect(footnoteEmissionSectionEntries(state)).toEqual([
      { id: "a", number: 1, body: "body", include: true },
      { id: "b", number: 2, body: "orphan body", include: true },
    ]);
  });

  it("filters section entries from emitted state", () => {
    const state = createFootnoteEmissionState<string>();
    registerFootnoteReference(state, "missing");
    registerFootnoteDefinition(state, "orphan", "body");

    expect(footnoteEmissionSectionEntries(
      state,
      (entry) => entry.hasRef || Boolean(entry.body),
    )).toEqual([
      { id: "missing", number: 1, include: true },
      { id: "orphan", number: 2, body: "body", include: true },
    ]);
  });

  it("snapshots emitted refs, definitions, and numbering for truncation rollback", () => {
    const state = createFootnoteEmissionState<string>();
    registerFootnoteReference(state, "kept");
    const snapshot = snapshotFootnoteEmissionState(state);

    registerFootnoteReference(state, "dropped");
    registerFootnoteDefinition(state, "dropped", "body");

    expect(footnoteEmissionSectionEntries(snapshot)).toEqual([
      { id: "kept", number: 1, include: true },
    ]);
    expect(footnoteEmissionSectionEntries(state)).toEqual([
      { id: "kept", number: 1, include: true },
      { id: "dropped", number: 2, body: "body", include: true },
    ]);
  });
});
