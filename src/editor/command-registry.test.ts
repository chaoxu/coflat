import { describe, expect, it, vi } from "vitest";
import {
  commandRegistryExtension,
  getPaletteCommands,
  getSlashCommands,
  runRegisteredCommand,
} from "./command-registry";
import { createEditor } from "./editor";

describe("command registry", () => {
  it("dedupes host commands over built-ins and feeds palette/slash/api surfaces", () => {
    const parent = document.createElement("div");
    const run = vi.fn();
    const view = createEditor({
      parent,
      doc: "",
      extensions: [
        commandRegistryExtension([
          {
            id: "insert-table",
            label: "Host Table",
            slash: true,
            run,
          },
          {
            id: "host-only",
            label: "Host Only",
            palette: true,
            slash: true,
            key: "Mod-Alt-y",
            run,
          },
        ]),
      ],
    });

    expect(getPaletteCommands(view).find((command) => command.id === "insert-table")?.label)
      .toBe("Host Table");
    expect(getSlashCommands(view).map((command) => command.id))
      .toContain("host-only");
    expect(runRegisteredCommand(view, "host-only")).toBe(true);
    expect(run).toHaveBeenCalledWith({ view, surface: "api" });

    view.destroy();
  });
});
