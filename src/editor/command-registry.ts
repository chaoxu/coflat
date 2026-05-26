import { Facet, Prec, type Extension } from "@codemirror/state";
import { keymap, type KeyBinding } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";

export type CommandSurface = "palette" | "slash" | "keymap" | "api";

export interface CommandEnv {
  readonly view: EditorView;
  readonly surface: CommandSurface;
}

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly key?: string | readonly string[];
  readonly palette?: boolean;
  readonly slash?: boolean;
  readonly run: (env: CommandEnv) => boolean | undefined;
  readonly isEnabled?: (env: CommandEnv) => boolean;
}

export const commandRegistryFacet = Facet.define<
  readonly Command[],
  readonly Command[]
>({
  combine(values) {
    return values.flat();
  },
});

function dedupeCommands(commands: readonly Command[]): Command[] {
  const byId = new Map<string, Command>();
  for (const command of commands) {
    byId.set(command.id, command);
  }
  return [...byId.values()];
}

export function commandRegistryExtension(commands: readonly Command[]): Extension {
  return commandRegistryFacet.of(commands);
}

export function getRegisteredCommands(
  view: EditorView,
  surface: CommandSurface = "api",
): Command[] {
  const env = { view, surface };
  return dedupeCommands(view.state.facet(commandRegistryFacet))
    .filter((command) => command.isEnabled?.(env) ?? true);
}

export function getPaletteCommands(view: EditorView): Command[] {
  return getRegisteredCommands(view, "palette")
    .filter((command) => command.palette !== false);
}

export function getSlashCommands(view: EditorView): Command[] {
  return getRegisteredCommands(view, "slash")
    .filter((command) => command.slash === true);
}

export function runRegisteredCommand(
  view: EditorView,
  id: string,
  surface: CommandSurface = "api",
): boolean {
  const command = getRegisteredCommands(view, surface)
    .find((candidate) => candidate.id === id);
  if (!command) return false;
  return command.run({ view, surface }) !== false;
}

function keyBindingsForCommands(commands: readonly Command[]): KeyBinding[] {
  const deduped = dedupeCommands(commands);
  const bindings: KeyBinding[] = [];
  for (const command of deduped) {
    const keys = typeof command.key === "string"
      ? [command.key]
      : command.key ?? [];
    for (const key of keys) {
      bindings.push({
        key,
        run: (view) => runRegisteredCommand(view, command.id, "keymap"),
      });
    }
  }
  return bindings;
}

export const commandKeymapExtension: Extension = Prec.high(
  keymap.compute([commandRegistryFacet], (state) =>
    keyBindingsForCommands(state.facet(commandRegistryFacet)),
  ),
);
