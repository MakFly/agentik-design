/**
 * n8n-faithful item model. Data flows between nodes as an **array of items**,
 * never a single value. Each item mirrors n8n's `INodeExecutionData`:
 *
 *   { json, binary?, pairedItem?, error? }
 *
 * `json` is always a plain object (the item payload). `binary` carries files.
 * `pairedItem` records which input item this output item derives from, so the
 * editor can trace data lineage (n8n's item linking).
 *
 * Reference: n8n packages/workflow/src/interfaces.ts (INodeExecutionData).
 */

export type JsonObject = Record<string, unknown>;

/** A single binary attachment on an item (base64-encoded, like n8n). */
export interface IBinaryData {
  data: string; // base64
  mimeType: string;
  fileName?: string;
  fileExtension?: string;
}

/** Links an output item back to the input item it was derived from. */
export interface IPairedItemData {
  item: number;
  /** Input port the source item came from (defaults to 0). */
  input?: number;
}

/** The unit of data flowing on a connection — one item. */
export interface INodeExecutionData {
  json: JsonObject;
  binary?: Record<string, IBinaryData>;
  pairedItem?: IPairedItemData | IPairedItemData[] | number;
  error?: { message: string; name?: string };
  [key: string]: unknown;
}

/** Output of a node, keyed by output port (handle). Single-output → { main }. */
export type NodeOutput = Record<string, INodeExecutionData[]>;

/** The default output port name for linear (single-output) nodes. */
export const MAIN = "main";

const isPlainObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Is this value already a well-formed item (`{ json: {...} }`)? */
export function isItem(v: unknown): v is INodeExecutionData {
  return isPlainObject(v) && isPlainObject((v as JsonObject).json);
}

/** Normalize an arbitrary value into a single item. */
export function toItem(v: unknown): INodeExecutionData {
  if (isItem(v)) return v;
  if (isPlainObject(v)) return { json: v };
  // Scalars / arrays-as-value get wrapped under `value`, mirroring n8n.
  return { json: { value: v } };
}

/**
 * Normalize an arbitrary return value into an item array.
 * - `null`/`undefined` → a single empty item `[{ json: {} }]` (n8n's "always
 *   produce data" default for entry data).
 * - an array → one item per element (each normalized).
 * - a plain object / scalar → a single item.
 *
 * Note: an explicit empty array `[]` is preserved (a node may legitimately emit
 * zero items, e.g. a filter that drops everything).
 */
export function toItems(value: unknown): INodeExecutionData[] {
  if (value === null || value === undefined) return [{ json: {} }];
  if (Array.isArray(value)) return value.map(toItem);
  return [toItem(value)];
}

/** The `json` of the first item, or `{}` when there are none. Used for legacy aliases. */
export function firstJson(items: INodeExecutionData[]): JsonObject {
  return items[0]?.json ?? {};
}

/** Concatenate item arrays (fan-in on the same input port). */
export function concatItems(arrays: INodeExecutionData[][]): INodeExecutionData[] {
  return arrays.flat();
}
