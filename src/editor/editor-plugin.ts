import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type EditorPluginLoadTiming = "initial" | "after-mount" | "manual";

export interface EditorPluginRuntimeContext {
  readonly isDark?: boolean;
}

export interface EditorPluginLifecycleEvent {
  readonly id: string;
  readonly phase: string;
}

/**
 * An EditorPlugin encapsulates a toggleable CM6 feature with a stable identity.
 *
 * Each plugin owns a `Compartment` so it can be activated / deactivated
 * independently without rebuilding the entire editor state.
 */
export interface EditorPlugin {
  /** Stable identifier, e.g. `"focus-mode"`. */
  readonly id: string;
  /** Human-readable name shown in the preferences UI. */
  readonly name: string;
  /** Short description for the preferences UI. */
  readonly description?: string;
  /** Whether the plugin is enabled by default when first registered. */
  readonly defaultEnabled: boolean;
  /**
   * When to materialize this plugin. `initial` keeps old eager behavior;
   * `after-mount` leaves an empty compartment in the initial editor state and
   * fills it after the first editable surface exists.
   */
  readonly loadTiming?: EditorPluginLoadTiming;
  /** Lifecycle phase reported when the plugin becomes active. */
  readonly readyPhase?: string;
  /**
   * Return the CM6 extensions that implement this feature.
   * Called each time the plugin is activated (initial load and every
   * re-enable after a disable).  Implementations should be pure — return
   * the same logical extension objects across calls where possible.
   */
  extensions?(): Extension;
  /**
   * Dynamically load the CM6 extensions that implement this feature. Use this
   * for optional UI or tooling that should not block first editor pixels.
   */
  load?(context: EditorPluginRuntimeContext): Extension | Promise<Extension>;
}

/** Runtime state for a registered plugin. */
interface PluginEntry {
  plugin: EditorPlugin;
  compartment: Compartment;
  enabled: boolean;
  extension: Extension | null;
  loading: Promise<Extension | null> | null;
  token: number;
}

function isPromiseLikeExtension(value: Extension | Promise<Extension> | undefined): value is Promise<Extension> {
  return typeof (value as Promise<Extension> | undefined)?.then === "function";
}

export interface EditorPluginManagerOptions {
  readonly context?: EditorPluginRuntimeContext;
  readonly onReady?: (event: EditorPluginLifecycleEvent) => void;
}

/**
 * Manages a collection of `EditorPlugin` instances and their lifecycle.
 *
 * Usage:
 * ```ts
 * const mgr = new EditorPluginManager([focusModePlugin, spellcheckPlugin]);
 * // Include mgr.initialExtensions() when creating the editor state.
 * // Later:
 * mgr.setEnabled(view, "focus-mode", false);
 * ```
 */
export class EditorPluginManager {
  private readonly entries = new Map<string, PluginEntry>();
  private context: EditorPluginRuntimeContext = {};
  private onReady?: (event: EditorPluginLifecycleEvent) => void;

  constructor(plugins: readonly EditorPlugin[] = [], options: EditorPluginManagerOptions = {}) {
    this.context = options.context ?? {};
    this.onReady = options.onReady;
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  /**
   * Register a plugin.  Must be called before `initialExtensions()` is
   * consumed by the editor.
   */
  register(plugin: EditorPlugin): void {
    if (this.entries.has(plugin.id)) return;
    this.entries.set(plugin.id, {
      plugin,
      compartment: new Compartment(),
      enabled: plugin.defaultEnabled,
      extension: null,
      loading: null,
      token: 0,
    });
  }

  /**
   * Return the flat array of CM6 extensions to include in the editor state.
   * Each plugin's extensions are wrapped in its private `Compartment` so
   * they can be reconfigured later.
   */
  initialExtensions(context: EditorPluginRuntimeContext = this.context): Extension[] {
    this.context = context;
    const result: Extension[] = [];
    for (const entry of this.entries.values()) {
      const shouldLoadNow =
        entry.enabled && (entry.plugin.loadTiming ?? "initial") === "initial";
      const extension = shouldLoadNow ? this.loadSync(entry) : [];
      result.push(
        entry.compartment.of(entry.enabled ? extension : []),
      );
    }
    return result;
  }

  attach(view: EditorView, options: EditorPluginManagerOptions = {}): void {
    this.context = options.context ?? this.context;
    this.onReady = options.onReady ?? this.onReady;
    for (const entry of this.entries.values()) {
      if (!entry.enabled) continue;
      if ((entry.plugin.loadTiming ?? "initial") === "after-mount") {
        void this.loadIntoView(entry, view);
      }
    }
  }

  /**
   * Enable or disable a plugin at runtime.
   * Dispatches a `reconfigure` effect on `view`; no-ops if the state is
   * already correct.  If `view` is null (e.g. no file open yet), the
   * enabled state is updated so the next `initialExtensions()` call picks
   * it up correctly — no dispatch is attempted.
   */
  async setEnabled(view: EditorView | null, id: string, enabled: boolean): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.enabled === enabled) return;

    entry.enabled = enabled;
    if (view) {
      entry.token += 1;
      if (!enabled) {
        entry.extension = null;
        entry.loading = null;
        view.dispatch({ effects: entry.compartment.reconfigure([]) });
        return;
      }
      await this.loadIntoView(entry, view);
    }
  }

  /** Toggle a plugin between enabled and disabled. */
  async toggle(view: EditorView | null, id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    await this.setEnabled(view, id, !entry.enabled);
  }

  /** Return whether a plugin is currently enabled. */
  isEnabled(id: string): boolean {
    return this.entries.get(id)?.enabled ?? false;
  }

  /** Return all registered plugins in registration order. */
  getPlugins(): Array<{ plugin: EditorPlugin; enabled: boolean }> {
    return Array.from(this.entries.values()).map(({ plugin, enabled }) => ({
      plugin,
      enabled,
    }));
  }

  private loadSync(entry: PluginEntry): Extension {
    if (entry.extension) return entry.extension;
    if (entry.plugin.extensions) {
      entry.extension = entry.plugin.extensions();
      this.emitReady(entry);
      return entry.extension;
    }
    const loaded = entry.plugin.load?.(this.context);
    if (isPromiseLikeExtension(loaded)) {
      return [];
    }
    const extension = loaded ?? [];
    entry.extension = extension;
    this.emitReady(entry);
    return extension;
  }

  private async loadIntoView(entry: PluginEntry, view: EditorView): Promise<void> {
    const token = entry.token + 1;
    entry.token = token;
    const extension = await this.load(entry);
    if (!entry.enabled || entry.token !== token) return;
    try {
      view.dispatch({
        effects: entry.compartment.reconfigure(extension ?? []),
      });
      this.emitReady(entry);
    } catch (_error) {
      // The editor may have been destroyed before an optional plugin arrived.
    }
  }

  private async load(entry: PluginEntry): Promise<Extension | null> {
    if (entry.extension) return entry.extension;
    if (entry.loading) return entry.loading;
    entry.loading = Promise.resolve(
      entry.plugin.load ? entry.plugin.load(this.context) : entry.plugin.extensions?.(),
    ).then((extension) => {
      entry.extension = extension ?? [];
      entry.loading = null;
      return entry.extension;
    });
    return entry.loading;
  }

  private emitReady(entry: PluginEntry): void {
    this.onReady?.({
      id: entry.plugin.id,
      phase: entry.plugin.readyPhase ?? `plugin:${entry.plugin.id}:ready`,
    });
  }
}
