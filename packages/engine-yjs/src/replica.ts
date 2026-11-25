import * as Y from "yjs";

export const DEFAULT_MAX_CRDT_UPDATE_BYTES = 16 * 1024 - 4;
export const MAX_CRDT_STATE_BYTES = 256 * 1024 * 1024;
const MAX_ROOT_NAME_BYTES = 256;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 10_000;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export interface YjsReplicaOptions {
  readonly maxUpdateBytes?: number;
  /** Local capability-derived permission. Remote update authorization is enforced by the session layer. */
  readonly localWriteAccess?: boolean;
}

export class CrdtOperationError extends Error {
  constructor(
    readonly code:
      | "invalid-name"
      | "invalid-value"
      | "invalid-update"
      | "update-too-large"
      | "state-too-large"
      | "read-only",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CrdtOperationError";
  }
}

export class SharedMap<T extends JsonValue> {
  constructor(
    private readonly root: Y.Map<T>,
    private readonly assertWritable: () => void,
  ) {}

  get size(): number {
    return this.root.size;
  }

  get(key: string): T | undefined {
    const value = this.root.get(key);
    return value === undefined ? undefined : cloneJsonValue(value);
  }

  has(key: string): boolean {
    return this.root.has(key);
  }

  set(key: string, value: T): void {
    assertKey(key);
    assertJsonValue(value);
    this.assertWritable();
    this.root.set(key, cloneJsonValue(value));
  }

  delete(key: string): boolean {
    this.assertWritable();
    const existed = this.root.has(key);
    this.root.delete(key);
    return existed;
  }

  entries(): [string, T][] {
    return [...this.root.entries()].map(([key, value]) => [
      key,
      cloneJsonValue(value),
    ]);
  }

  toJSON(): Record<string, T> {
    return cloneJsonValue(this.root.toJSON());
  }
}

export class SharedArray<T extends JsonValue> {
  constructor(
    private readonly root: Y.Array<T>,
    private readonly assertWritable: () => void,
  ) {}

  get length(): number {
    return this.root.length;
  }

  get(index: number): T | undefined {
    const value = this.root.get(index);
    return value === undefined ? undefined : cloneJsonValue(value);
  }

  toArray(): T[] {
    return this.root.toArray().map(cloneJsonValue);
  }

  insert(index: number, values: readonly T[]): void {
    if (!Number.isInteger(index) || index < 0 || index > this.root.length)
      throw invalidValue("Array insertion index is out of bounds.");
    for (const value of values) assertJsonValue(value);
    this.assertWritable();
    this.root.insert(index, values.map(cloneJsonValue));
  }

  push(...values: T[]): void {
    this.insert(this.root.length, values);
  }

  delete(index: number, length = 1): void {
    if (
      !Number.isInteger(index) ||
      !Number.isInteger(length) ||
      index < 0 ||
      length < 0 ||
      index + length > this.root.length
    )
      throw invalidValue("Array deletion range is out of bounds.");
    this.assertWritable();
    this.root.delete(index, length);
  }
}

export class SharedText {
  constructor(
    private readonly root: Y.Text,
    private readonly assertWritable: () => void,
  ) {}

  get length(): number {
    return this.root.length;
  }

  toString(): string {
    return this.root.toString();
  }

  insert(index: number, text: string): void {
    if (!Number.isInteger(index) || index < 0 || index > this.root.length)
      throw invalidValue("Text insertion index is out of bounds.");
    if (typeof text !== "string") throw invalidValue("Text must be a string.");
    this.assertWritable();
    this.root.insert(index, text);
  }

  delete(index: number, length: number): void {
    if (
      !Number.isInteger(index) ||
      !Number.isInteger(length) ||
      index < 0 ||
      length < 0 ||
      index + length > this.root.length
    )
      throw invalidValue("Text deletion range is out of bounds.");
    this.assertWritable();
    this.root.delete(index, length);
  }
}

/** A named, field-oriented application document. Each JSON field is an atomic map value. */
export class StructuredDocument<T extends JsonObject> {
  constructor(
    private readonly root: Y.Map<JsonValue>,
    private readonly assertWritable: () => void,
  ) {}

  get<K extends keyof T & string>(key: K): T[K] | undefined {
    const value = this.root.get(key);
    return value === undefined ? undefined : (cloneJsonValue(value) as T[K]);
  }

  set<K extends keyof T & string>(key: K, value: T[K]): void {
    assertKey(key);
    assertJsonValue(value);
    this.assertWritable();
    this.root.set(key, cloneJsonValue(value));
  }

  delete<K extends keyof T & string>(key: K): boolean {
    this.assertWritable();
    const existed = this.root.has(key);
    this.root.delete(key);
    return existed;
  }

  toJSON(): T {
    return cloneJsonValue(this.root.toJSON()) as T;
  }
}

/** A local Y.Doc replica. Apply remote updates only after the authenticated session authorizes them. */
export class YjsReplica {
  private readonly document = new Y.Doc();
  private readonly maxUpdateBytes: number;
  private readonly localWriteAccess: boolean;
  private destroyed = false;

  constructor(options: YjsReplicaOptions = {}) {
    this.maxUpdateBytes =
      options.maxUpdateBytes ?? DEFAULT_MAX_CRDT_UPDATE_BYTES;
    if (
      !Number.isSafeInteger(this.maxUpdateBytes) ||
      this.maxUpdateBytes < 1 ||
      this.maxUpdateBytes > DEFAULT_MAX_CRDT_UPDATE_BYTES
    )
      throw invalidValue(
        `maxUpdateBytes must be an integer from 1 to ${DEFAULT_MAX_CRDT_UPDATE_BYTES}.`,
      );
    this.localWriteAccess = options.localWriteAccess ?? true;
  }

  get clientId(): number {
    this.assertAlive();
    return this.document.clientID;
  }

  map<T extends JsonValue = JsonValue>(name: string): SharedMap<T> {
    this.assertAlive();
    assertRootName(name);
    return new SharedMap(this.document.getMap<T>(name), () =>
      this.assertWritable(),
    );
  }

  array<T extends JsonValue = JsonValue>(name: string): SharedArray<T> {
    this.assertAlive();
    assertRootName(name);
    return new SharedArray(this.document.getArray<T>(name), () =>
      this.assertWritable(),
    );
  }

  text(name: string): SharedText {
    this.assertAlive();
    assertRootName(name);
    return new SharedText(this.document.getText(name), () =>
      this.assertWritable(),
    );
  }

  documentFor<T extends JsonObject>(name: string): StructuredDocument<T> {
    this.assertAlive();
    assertRootName(name);
    return new StructuredDocument(this.document.getMap<JsonValue>(name), () =>
      this.assertWritable(),
    );
  }

  encodeStateVector(): Uint8Array {
    this.assertAlive();
    return Y.encodeStateVector(this.document);
  }

  encodeUpdate(stateVector?: Uint8Array): Uint8Array {
    this.assertAlive();
    if (stateVector && stateVector.byteLength > this.maxUpdateBytes)
      throw new CrdtOperationError(
        "update-too-large",
        "State vector exceeds the configured update bound.",
      );
    const update = Y.encodeStateAsUpdate(this.document, stateVector);
    this.assertUpdateSize(update);
    return update;
  }

  /** Encodes the complete document state for local persistence or portable export. */
  encodePortableState(): Uint8Array {
    this.assertAlive();
    const update = Y.encodeStateAsUpdate(this.document);
    if (update.byteLength > MAX_CRDT_STATE_BYTES)
      throw new CrdtOperationError(
        "state-too-large",
        `Replica state exceeds the ${MAX_CRDT_STATE_BYTES}-byte limit.`,
      );
    return update;
  }

  /** Applies a persisted or imported full-state update after validating its bounds. */
  applyPortableState(update: Uint8Array): void {
    this.assertAlive();
    if (!(update instanceof Uint8Array) || update.byteLength === 0)
      throw new CrdtOperationError(
        "invalid-update",
        "Portable replica state must be a non-empty Uint8Array.",
      );
    if (update.byteLength > MAX_CRDT_STATE_BYTES)
      throw new CrdtOperationError(
        "state-too-large",
        `Replica state exceeds the ${MAX_CRDT_STATE_BYTES}-byte limit.`,
      );
    try {
      Y.applyUpdate(this.document, update);
      if (
        Y.encodeStateAsUpdate(this.document).byteLength > MAX_CRDT_STATE_BYTES
      )
        throw new CrdtOperationError(
          "state-too-large",
          `Replica state exceeds the ${MAX_CRDT_STATE_BYTES}-byte limit.`,
        );
    } catch (cause) {
      if (cause instanceof CrdtOperationError) throw cause;
      throw new CrdtOperationError(
        "invalid-update",
        "Portable replica state is malformed.",
        { cause },
      );
    }
  }

  applyUpdate(update: Uint8Array, origin?: unknown): void {
    this.assertAlive();
    this.assertUpdateSize(update);
    if (update.byteLength === 0)
      throw new CrdtOperationError(
        "invalid-update",
        "CRDT update must not be empty.",
      );
    try {
      Y.applyUpdate(this.document, update, origin);
    } catch (cause) {
      throw new CrdtOperationError(
        "invalid-update",
        "CRDT update is malformed.",
        { cause },
      );
    }
  }

  onUpdate(
    listener: (update: Uint8Array, origin: unknown) => void,
  ): () => void {
    this.assertAlive();
    const handler = (update: Uint8Array, origin: unknown): void =>
      listener(update.slice(), origin);
    this.document.on("update", handler);
    return () => this.document.off("update", handler);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.document.destroy();
  }

  private assertUpdateSize(update: Uint8Array): void {
    if (!(update instanceof Uint8Array))
      throw new CrdtOperationError(
        "invalid-update",
        "CRDT update must be a Uint8Array.",
      );
    if (update.byteLength > this.maxUpdateBytes)
      throw new CrdtOperationError(
        "update-too-large",
        `CRDT update exceeds the ${this.maxUpdateBytes}-byte limit.`,
      );
  }

  private assertAlive(): void {
    if (this.destroyed)
      throw new CrdtOperationError("invalid-update", "CRDT replica is closed.");
  }

  private assertWritable(): void {
    this.assertAlive();
    if (!this.localWriteAccess)
      throw new CrdtOperationError(
        "read-only",
        "This CRDT replica is read-only.",
      );
  }
}

function assertRootName(name: string): void {
  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    new TextEncoder().encode(name).byteLength > MAX_ROOT_NAME_BYTES ||
    [...name].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  )
    throw new CrdtOperationError(
      "invalid-name",
      `CRDT root names must contain 1 to ${MAX_ROOT_NAME_BYTES} UTF-8 bytes and no control characters.`,
    );
}

function assertKey(key: string): void {
  if (typeof key !== "string" || key.length === 0)
    throw invalidValue("Map keys must be non-empty strings.");
}

function assertJsonValue(value: unknown): asserts value is JsonValue {
  let nodes = 0;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH)
      throw invalidValue("JSON values exceed the nesting or node limit.");
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    )
      return;
    if (typeof item !== "object")
      throw invalidValue("CRDT structured values must be finite JSON values.");
    if (seen.has(item))
      throw invalidValue("CRDT structured values cannot contain cycles.");
    seen.add(item);
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null)
        throw invalidValue(
          "CRDT structured objects must be plain JSON objects.",
        );
      for (const child of Object.values(item)) visit(child, depth + 1);
    }
    seen.delete(item);
  };
  visit(value, 0);
}

function invalidValue(message: string): CrdtOperationError {
  return new CrdtOperationError("invalid-value", message);
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}
