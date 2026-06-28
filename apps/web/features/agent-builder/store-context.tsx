"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import type { AgentConfig } from "@/types/domain";
import type { DraftIdentity } from "./validation";
import { createBuilderStore, type BuilderState, type BuilderStore } from "./store";

const BuilderStoreContext = createContext<BuilderStore | null>(null);

/**
 * Provides a builder store scoped to this subtree. One store per mount — create
 * and edit never share state, and editing agent A then agent B starts clean.
 */
export function BuilderStoreProvider({
  initialIdentity,
  initialConfig,
  children,
}: {
  initialIdentity?: Partial<DraftIdentity>;
  initialConfig?: AgentConfig;
  children: ReactNode;
}) {
  const [store] = useState(() => createBuilderStore(initialIdentity, initialConfig));
  return <BuilderStoreContext.Provider value={store}>{children}</BuilderStoreContext.Provider>;
}

/** Select from the scoped builder store. Mirrors the old `useBuilderStore` API. */
export function useBuilderStore<T>(selector: (s: BuilderState) => T): T {
  const store = useContext(BuilderStoreContext);
  if (!store) throw new Error("useBuilderStore must be used within a BuilderStoreProvider");
  return useStore(store, selector);
}

/** Access the raw store (e.g. for `getState`/`setState` outside React renders). */
export function useBuilderStoreApi(): BuilderStore {
  const store = useContext(BuilderStoreContext);
  if (!store) throw new Error("useBuilderStoreApi must be used within a BuilderStoreProvider");
  return store;
}
