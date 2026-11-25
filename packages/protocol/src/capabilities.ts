import type { Invitation } from "./invitation";
import type { ProtocolValue } from "./protocol";

export const CAPABILITY_MANIFEST_VERSION = 1 as const;

export type CapabilityJsonSchema =
  | boolean
  | { readonly [key: string]: ProtocolValue };

export interface CapabilityOperation {
  readonly name: string;
  readonly allowedAccess: readonly Invitation["access"][];
  readonly inputSchema: CapabilityJsonSchema;
  readonly outputSchema: CapabilityJsonSchema;
}

export interface CapabilityManifest {
  readonly version: typeof CAPABILITY_MANIFEST_VERSION;
  readonly engineId: string;
  readonly access: Invitation["access"];
  /** Operations permitted to this invitation. */
  readonly operations: readonly string[];
  readonly readOnlyOperations: readonly string[];
  readonly operationMetadata: readonly CapabilityOperation[];
  readonly features: Readonly<Record<string, boolean | number | string>>;
}

export interface EngineCapabilityInput {
  readonly operations: readonly string[];
  readonly readOnlyOperations?: readonly string[];
  readonly features: Readonly<Record<string, boolean | number | string>>;
}

const bytesSchema: CapabilityJsonSchema = {
  oneOf: [
    { type: "string", "x-runtimeType": "string" },
    {
      type: "string",
      contentEncoding: "base64",
      "x-runtimeType": "Uint8Array",
    },
  ],
};
const nullableBytesSchema: CapabilityJsonSchema = {
  oneOf: [bytesSchema as ProtocolValue, { type: "null" }],
};

const operationSchemas: Readonly<
  Record<
    string,
    Readonly<
      Record<string, Omit<CapabilityOperation, "name" | "allowedAccess">>
    >
  >
> = {
  kv: {
    PING: {
      inputSchema: arraySchema([], 0, 1),
      outputSchema: { type: "string" },
    },
    GET: {
      inputSchema: arraySchema([{ type: "string" }], 1, 1),
      outputSchema: nullableBytesSchema,
    },
    SET: {
      inputSchema: arraySchema([{ type: "string" }, bytesSchema], 2, 2),
      outputSchema: { const: "OK" },
    },
    DEL: {
      inputSchema: arraySchema([{ type: "string" }], 1),
      outputSchema: { type: "integer", minimum: 0 },
    },
    EXISTS: {
      inputSchema: arraySchema([{ type: "string" }], 1),
      outputSchema: { type: "integer", minimum: 0 },
    },
    MGET: {
      inputSchema: arraySchema([{ type: "string" }], 1),
      outputSchema: { type: "array", items: nullableBytesSchema },
    },
    MSET: {
      inputSchema: arraySchema([{ type: "string" }, bytesSchema], 2),
      outputSchema: { const: "OK" },
    },
    INCR: {
      inputSchema: arraySchema([{ type: "string" }], 1, 1),
      outputSchema: {
        type: "string",
        format: "int64",
        "x-runtimeType": "bigint",
      },
    },
    DECR: {
      inputSchema: arraySchema([{ type: "string" }], 1, 1),
      outputSchema: {
        type: "string",
        format: "int64",
        "x-runtimeType": "bigint",
      },
    },
    EXPIRE: {
      inputSchema: arraySchema([{ type: "string" }, { type: "integer" }], 2, 2),
      outputSchema: { type: "integer", enum: [0, 1] },
    },
    TTL: {
      inputSchema: arraySchema([{ type: "string" }], 1, 1),
      outputSchema: { type: "integer", minimum: -2 },
    },
    PERSIST: {
      inputSchema: arraySchema([{ type: "string" }], 1, 1),
      outputSchema: { type: "integer", enum: [0, 1] },
    },
    SCAN: {
      inputSchema: arraySchema([{ type: "string" }, { type: "string" }], 1),
      outputSchema: {
        type: "array",
        prefixItems: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
        minItems: 2,
        maxItems: 2,
      },
    },
    DBSIZE: {
      inputSchema: arraySchema([], 0, 0),
      outputSchema: { type: "integer", minimum: 0 },
    },
  },
  postgresql: {
    query: {
      inputSchema: objectSchema(
        {
          sql: { type: "string", minLength: 1 },
          params: {
            type: "array",
            items: {
              type: ["null", "boolean", "number", "string", "array", "object"],
              "x-runtimeTypes": [
                "undefined",
                "bigint",
                "ArrayBuffer",
                "Uint8Array",
              ],
            },
          },
          rowMode: { enum: ["object", "array"] },
        },
        ["sql"],
      ),
      outputSchema: {
        type: "object",
        required: ["rows", "fields"],
        properties: {
          rows: {
            type: "array",
            description: "Rows with engine-defined values.",
          },
          fields: {
            type: "array",
            description: "PostgreSQL result-field metadata.",
          },
        },
      },
    },
    schema: {
      inputSchema: objectSchema({
        schema: { type: "string", default: "public" },
        table: { type: ["string", "null"] },
      }),
      outputSchema: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            description: "Rows of SqlSchemaColumn values.",
          },
        },
      },
    },
    "describe-query": {
      inputSchema: objectSchema({ sql: { type: "string", minLength: 1 } }, [
        "sql",
      ]),
      outputSchema: {
        type: "object",
        required: ["parameters", "fields"],
        properties: {
          parameters: {
            type: "array",
            description: "Parameter PostgreSQL type OIDs.",
          },
          fields: {
            type: "array",
            description: "Result names and PostgreSQL type OIDs.",
          },
        },
      },
    },
  },
  sqlite: {
    query: {
      inputSchema: objectSchema(
        {
          sql: { type: "string", minLength: 1 },
          params: {
            type: "array",
            items: {
              type: ["null", "boolean", "number", "string"],
              "x-runtimeTypes": ["bigint", "ArrayBuffer", "Uint8Array"],
            },
          },
          rowMode: { enum: ["object", "array"] },
        },
        ["sql"],
      ),
      outputSchema: {
        type: "object",
        required: ["rows"],
        properties: {
          rows: { type: "array", description: "SQLite result rows." },
        },
      },
    },
  },
  duckdb: {
    query: {
      inputSchema: objectSchema(
        {
          sql: { type: "string", minLength: 1 },
          params: {
            type: "array",
            items: {
              type: ["null", "boolean", "number", "string"],
              "x-runtimeTypes": ["bigint", "Uint8Array"],
            },
          },
        },
        ["sql"],
      ),
      outputSchema: {
        type: "object",
        required: ["rows", "columns", "format", "truncated", "rowCount"],
        properties: {
          rows: { type: "array", description: "JSON-compatible DuckDB rows." },
          columns: { type: "array", items: { type: "string" } },
          format: { const: "arrow-to-json" },
          truncated: { type: "boolean" },
          rowCount: { type: "integer", minimum: 0 },
        },
      },
    },
  },
};

export function createCapabilityManifest(
  engineId: string,
  access: Invitation["access"],
  capabilities: EngineCapabilityInput,
): CapabilityManifest {
  const readOnly = new Set(capabilities.readOnlyOperations ?? []);
  const operations = capabilities.operations.filter(
    (name) => access === "read-write" || readOnly.has(name),
  );
  const operationMetadata = operations.map((name) => {
    const schema = operationSchemas[engineId]?.[name] ?? {
      inputSchema: true,
      outputSchema: true,
    };
    return {
      name,
      allowedAccess: readOnly.has(name)
        ? (["read-only", "read-write"] as const)
        : (["read-write"] as const),
      inputSchema: materializeJsonSchema(schema.inputSchema),
      outputSchema: materializeJsonSchema(schema.outputSchema),
    };
  });
  return Object.freeze({
    version: CAPABILITY_MANIFEST_VERSION,
    engineId,
    access,
    operations: Object.freeze(operations),
    readOnlyOperations: Object.freeze(
      operations.filter((name) => readOnly.has(name)),
    ),
    operationMetadata: Object.freeze(operationMetadata),
    features: Object.freeze({ ...capabilities.features }),
  });
}

export function decodeCapabilityManifest(
  value: unknown,
  expected?: {
    readonly engineId?: string;
    readonly access?: Invitation["access"];
  },
): CapabilityManifest {
  if (!isRecord(value)) throw capabilityError("invalid-capabilities");
  if (value.version !== CAPABILITY_MANIFEST_VERSION) {
    throw capabilityError("unsupported-capability-version");
  }
  if (
    typeof value.engineId !== "string" ||
    (value.access !== "read-only" && value.access !== "read-write") ||
    (expected?.engineId !== undefined &&
      value.engineId !== expected.engineId) ||
    (expected?.access !== undefined && value.access !== expected.access) ||
    !Array.isArray(value.operations) ||
    value.operations.some((operation) => typeof operation !== "string") ||
    !Array.isArray(value.readOnlyOperations) ||
    value.readOnlyOperations.some(
      (operation) => typeof operation !== "string",
    ) ||
    !Array.isArray(value.operationMetadata) ||
    !isRecord(value.features)
  ) {
    throw capabilityError("invalid-capabilities");
  }
  const operations = value.operations as string[];
  const readOnlyOperations = value.readOnlyOperations as string[];
  if (
    new Set(operations).size !== operations.length ||
    new Set(readOnlyOperations).size !== readOnlyOperations.length ||
    readOnlyOperations.some((operation) => !operations.includes(operation))
  ) {
    throw capabilityError("invalid-capabilities");
  }
  const operationMetadata = value.operationMetadata.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.name !== "string" ||
      !operations.includes(item.name) ||
      !Array.isArray(item.allowedAccess) ||
      item.allowedAccess.some(
        (scope) => scope !== "read-only" && scope !== "read-write",
      ) ||
      new Set(item.allowedAccess).size !== item.allowedAccess.length ||
      !item.allowedAccess.includes(value.access as string) ||
      readOnlyOperations.includes(item.name) !==
        item.allowedAccess.includes("read-only") ||
      !isJsonSchema(item.inputSchema) ||
      !isJsonSchema(item.outputSchema)
    ) {
      throw capabilityError("invalid-capabilities");
    }
    return Object.freeze({
      name: item.name,
      allowedAccess: Object.freeze([
        ...item.allowedAccess,
      ]) as readonly Invitation["access"][],
      inputSchema: item.inputSchema as CapabilityJsonSchema,
      outputSchema: item.outputSchema as CapabilityJsonSchema,
    });
  });
  if (
    new Set(operationMetadata.map(({ name }) => name)).size !==
      operationMetadata.length ||
    operationMetadata.length !== operations.length ||
    Object.values(value.features).some(
      (feature) =>
        typeof feature !== "boolean" &&
        typeof feature !== "number" &&
        typeof feature !== "string",
    )
  ) {
    throw capabilityError("invalid-capabilities");
  }
  return Object.freeze({
    version: CAPABILITY_MANIFEST_VERSION,
    engineId: value.engineId,
    access: value.access as Invitation["access"],
    operations: Object.freeze([...operations]),
    readOnlyOperations: Object.freeze([...readOnlyOperations]),
    operationMetadata: Object.freeze(operationMetadata),
    features: Object.freeze({
      ...value.features,
    }) as CapabilityManifest["features"],
  });
}

function arraySchema(
  items: readonly ProtocolValue[],
  minItems: number,
  maxItems?: number,
): CapabilityJsonSchema {
  return {
    type: "array",
    prefixItems: items,
    minItems,
    ...(maxItems === undefined ? {} : { maxItems }),
    items: true,
  };
}

function objectSchema(
  properties: Record<string, ProtocolValue>,
  required: readonly string[] = [],
): CapabilityJsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

function materializeJsonSchema(
  schema: CapabilityJsonSchema,
): CapabilityJsonSchema {
  if (typeof schema === "boolean") return schema;
  return Object.freeze({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...schema,
  });
}

function isJsonSchema(value: unknown): boolean {
  return typeof value === "boolean" || isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capabilityError(
  code: "invalid-capabilities" | "unsupported-capability-version",
): Error & { code: string } {
  return Object.assign(
    new Error(
      code === "unsupported-capability-version"
        ? "The host capability manifest version is not supported."
        : "The host returned an invalid capability manifest.",
    ),
    { code },
  );
}
