import { describe, expect, it } from "vitest";

import { buildFootnotePlan } from "./footnote-plan";

interface TestRef {
  readonly id: string;
  readonly from: number;
}

interface TestDef {
  readonly id: string;
  readonly from: number;
  readonly body: string;
}

describe("footnote plan", () => {
  it("indexes refs and defs and orders referenced definitions before orphans", () => {
    const refs: TestRef[] = [
      { id: "a", from: 5 },
      { id: "b", from: 12 },
      { id: "a", from: 20 },
    ];
    const definitions: TestDef[] = [
      { id: "b", from: 50, body: "second" },
      { id: "orphan", from: 70, body: "orphan" },
      { id: "a", from: 90, body: "first" },
    ];

    const plan = buildFootnotePlan(refs, definitions);

    expect(plan.refByFrom.get(12)).toBe(refs[1]);
    expect(plan.defByFrom.get(90)).toBe(definitions[2]);
    expect(plan.defs.get("a")).toBe(definitions[2]);
    expect(Array.from(plan.numberById.entries())).toEqual([
      ["a", 1],
      ["b", 2],
      ["orphan", 3],
    ]);
    expect(plan.orderedIds).toEqual(["a", "b", "orphan"]);
    expect(plan.orderedEntries.map((entry) => ({
      id: entry.id,
      number: entry.number,
      def: entry.def,
    }))).toEqual([
      { id: "a", number: 1, def: definitions[2] },
      { id: "b", number: 2, def: definitions[0] },
      { id: "orphan", number: 3, def: definitions[1] },
    ]);
  });

  it("reuses equivalent number maps and ordered entries", () => {
    const refs: TestRef[] = [{ id: "a", from: 1 }];
    const definitions: TestDef[] = [{ id: "a", from: 10, body: "body" }];
    const previous = buildFootnotePlan(refs, definitions);

    const next = buildFootnotePlan(refs, definitions, {
      previous,
      previousDefinitions: previous.definitions,
      refsUnchanged: true,
      sameDefinition: (left, right) =>
        left.id === right.id && left.from === right.from && left.body === right.body,
    });

    expect(next.numberById).toBe(previous.numberById);
    expect(next.orderedEntries).toBe(previous.orderedEntries);
  });
});
