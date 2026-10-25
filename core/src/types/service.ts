/**
 * Service Types for Orbital Schema
 *
 * Defines external service integrations (REST APIs, WebSockets, MCP servers)
 * that can be used by orbital units via the `call_service` effect.
 *
 * @packageDocumentation
 */

import { z } from "zod";
import type { RuntimeValue } from './json.js';

// ============================================================================
// Service Type Enum
// ============================================================================

/**
 * Types of external services that can be integrated.
 */
export const SERVICE_TYPES = ["rest", "socket", "mcp"] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export const ServiceTypeSchema = z.enum(SERVICE_TYPES);

// ============================================================================
// REST Service Definition
// ============================================================================

/**
 * Configuration for a REST API service.
 *
 * @example
 * ```typescript
 * const weatherService: RestServiceDef = {
 *   name: 'WeatherAPI',
 *   type: 'rest',
 *   baseUrl: 'https://api.openweathermap.org/data/2.5',
 *   headers: {
 *     'Content-Type': 'application/json',
 *   },
 *   auth: {
 *     type: 'api-key',
 *     keyName: 'appid',
 *     location: 'query',
 *   },
 * };
 * ```
 */
export type RestServiceDef = {
  /** Unique service name (used in call_service effect) */
  name: string;

  /** Service type */
  type: "rest";

  /** Optional description */
  description?: string;

  /** Base URL for the API */
  baseUrl: string;

  /** Default headers to include in all requests */
  headers?: Record<string, string>;

  /** Authentication configuration */
  auth?: RestAuthConfig;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
};

/**
 * Authentication configuration for REST services.
 */
export type RestAuthConfig = {
  /** Authentication type */
  type: "api-key" | "bearer" | "basic" | "oauth2";

  /** For api-key: the query parameter or header name */
  keyName?: string;

  /** For api-key: where to place the key */
  location?: "query" | "header";

  /** Environment variable name containing the secret (for secure storage) */
  secretEnv?: string;
};

export const RestAuthConfigSchema = z.object({
  type: z.enum(["api-key", "bearer", "basic", "oauth2"]),
  keyName: z.string().optional(),
  location: z.enum(["query", "header"]).optional(),
  secretEnv: z.string().optional(),
});

export const RestServiceDefSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  type: z.literal("rest"),
  description: z.string().optional(),
  baseUrl: z.string().url("Base URL must be a valid URL"),
  headers: z.record(z.string(), z.string()).optional(),
  auth: RestAuthConfigSchema.optional(),
  timeout: z.number().positive().optional(),
});

// ============================================================================
// Socket Service Definition
// ============================================================================

/**
 * Configuration for a WebSocket service.
 *
 * @example
 * ```typescript
 * const chatService: SocketServiceDef = {
 *   name: 'ChatSocket',
 *   type: 'socket',
 *   url: 'wss://chat.example.com',
 *   events: {
 *     inbound: ['message_received', 'user_joined', 'user_left'],
 *     outbound: ['send_message', 'join_room', 'leave_room'],
 *   },
 * };
 * ```
 */
export type SocketServiceDef = {
  /** Unique service name */
  name: string;

  /** Service type */
  type: "socket";

  /** Optional description */
  description?: string;

  /** WebSocket URL */
  url: string;

  /** Event definitions */
  events: SocketEvents;

  /** Reconnection configuration */
  reconnect?: {
    /** Enable automatic reconnection */
    enabled: boolean;
    /** Maximum reconnection attempts */
    maxAttempts?: number;
    /** Delay between attempts in ms */
    delayMs?: number;
  };
};

/**
 * Socket event definitions.
 */
export type SocketEvents = {
  /** Events received from server (maps to orbital events) */
  inbound: string[];

  /** Events sent to server (triggered by effects) */
  outbound: string[];
};

export const SocketEventsSchema = z.object({
  inbound: z.array(z.string()),
  outbound: z.array(z.string()),
});

export const SocketServiceDefSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  type: z.literal("socket"),
  description: z.string().optional(),
  url: z.string().url("WebSocket URL must be valid"),
  events: SocketEventsSchema,
  reconnect: z
    .object({
      enabled: z.boolean(),
      maxAttempts: z.number().positive().optional(),
      delayMs: z.number().positive().optional(),
    })
    .optional(),
});

// ============================================================================
// MCP Service Definition
// ============================================================================

/**
 * Configuration for an MCP (Model Context Protocol) server.
 *
 * @example
 * ```typescript
 * const mcpService: McpServiceDef = {
 *   name: 'DatabaseMCP',
 *   type: 'mcp',
 *   serverPath: './mcp-servers/database',
 *   capabilities: ['query', 'insert', 'update'],
 * };
 * ```
 */
export type McpServiceDef = {
  /** Unique service name */
  name: string;

  /** Service type */
  type: "mcp";

  /** Optional description */
  description?: string;

  /** Path to MCP server executable or module */
  serverPath: string;

  /** List of capabilities/tools exposed by the MCP server */
  capabilities: string[];

  /** Environment variables to pass to the MCP server */
  env?: Record<string, string>;
};

export const McpServiceDefSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  type: z.literal("mcp"),
  description: z.string().optional(),
  serverPath: z.string().min(1, "Server path is required"),
  capabilities: z
    .array(z.string())
    .min(1, "At least one capability is required"),
  env: z.record(z.string(), z.string()).optional(),
});

// ============================================================================
// Union Type: ServiceDefinition
// ============================================================================

/**
 * Union type for all service definitions.
 */
export type ServiceDefinition =
  | RestServiceDef
  | SocketServiceDef
  | McpServiceDef;

export const ServiceDefinitionSchema = z.discriminatedUnion("type", [
  RestServiceDefSchema,
  SocketServiceDefSchema,
  McpServiceDefSchema,
]);

// ============================================================================
// Service Reference (Inline OR Reference)
// ============================================================================

/**
 * ServiceRef - Service can be inline definition, reference object with overrides,
 * or bare string reference to an imported service.
 *
 * Reference format: "Alias.services.ServiceName"
 */
export type ServiceRef = ServiceDefinition | ServiceRefObject | string;

/**
 * Phase F: Service reference object with override fields.
 *
 * Mirrors the Rust `ServiceRefObject` at
 * `orbital-rust/crates/orbital-core/src/schema/types.rs:353-375`. A caller
 * imports a service via `uses[]`, references it by `ref`, and supplies
 * any subset of these fields to override the imported service's defaults
 * during inlining.
 *
 * @example
 * ```typescript
 * const ref: ServiceRefObject = {
 *   ref: "Weather.services.openweather",
 *   baseUrl: "https://staging.weather.example.com",
 *   headers: { "X-Tenant": "acme" },
 * };
 * ```
 */
export type ServiceRefObject = {
  /** Reference to imported service: "Alias.services.ServiceName" */
  ref: string;
  /** Override the service description */
  description?: string;
  /** Override the REST baseUrl */
  baseUrl?: string;
  /** Override or merge default headers (caller wins on key collision) */
  headers?: Record<string, string>;
  /** Override the WebSocket url */
  url?: string;
  /** Override the MCP server path */
  serverPath?: string;
};

/**
 * Checks if a service reference is a bare string reference.
 *
 * Type guard to determine if a service reference is a string reference
 * (format: "Alias.services.ServiceName") rather than an inline service
 * definition or a reference object.
 *
 * @param {ServiceRef} service - Service reference to check
 * @returns {boolean} True if service is a string reference, false otherwise
 *
 * @example
 * isServiceReference("Weather.services.openweather"); // returns true
 * isServiceReference({ name: "weather", type: "rest" }); // returns false
 * isServiceReference({ ref: "Weather.services.openweather" }); // returns false
 */
export function isServiceReference(service: ServiceRef): service is string {
  return typeof service === "string";
}

/**
 * Phase F: Type guard for `ServiceRefObject` (the override-carrying form).
 *
 * @param {ServiceRef} service - Service reference to check
 * @returns {boolean} True if service is a ServiceRefObject
 */
export function isServiceReferenceObject(
  service: ServiceRef,
): service is ServiceRefObject {
  return (
    typeof service === "object" &&
    service !== null &&
    "ref" in service &&
    !("type" in service)
  );
}

/**
 * Validate service reference format: "Alias.services.ServiceName"
 */
export const ServiceRefStringSchema = z
  .string()
  .regex(
    /^[A-Z][a-zA-Z0-9]*\.services\.[a-zA-Z][a-zA-Z0-9]*$/,
    'Service reference must be in format "Alias.services.ServiceName" (e.g., "Weather.services.openweather")',
  );

export const ServiceRefObjectSchema = z.object({
  ref: ServiceRefStringSchema,
  description: z.string().optional(),
  baseUrl: z.string().url("baseUrl override must be a valid URL").optional(),
  headers: z.record(z.string(), z.string()).optional(),
  url: z.string().url("url override must be a valid URL").optional(),
  serverPath: z.string().optional(),
});

export const ServiceRefSchema = z.union([
  ServiceDefinitionSchema,
  ServiceRefObjectSchema,
  ServiceRefStringSchema,
]);

/**
 * Parses a service reference into its components.
 * 
 * Extracts the alias and service name from a service reference string
 * in format "Alias.services.ServiceName". Returns null if not a valid reference.
 * 
 * @param {string} ref - Service reference string
 * @returns {{ alias: string; serviceName: string } | null} Parsed components or null
 * 
 * @example
 * parseServiceRef("Weather.services.openweather"); // returns { alias: "Weather", serviceName: "openweather" }
 * parseServiceRef("invalid"); // returns null
 */
export function parseServiceRef(
  ref: string,
): { alias: string; serviceName: string } | null {
  const match = ref.match(
    /^([A-Z][a-zA-Z0-9]*)\.services\.([a-zA-Z][a-zA-Z0-9]*)$/,
  );
  if (!match) return null;
  return { alias: match[1], serviceName: match[2] };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Checks if a service definition is a REST service.
 * 
 * Type guard to determine if a service definition represents a REST API service.
 * Used for service type discrimination and validation.
 * 
 * @param {ServiceDefinition} service - Service definition to check
 * @returns {boolean} True if service is a REST service, false otherwise
 * 
 * @example
 * isRestService({ name: "weather", type: "rest", baseUrl: "..." }); // returns true
 * isRestService({ name: "chat", type: "socket" }); // returns false
 */
export function isRestService(
  service: ServiceDefinition,
): service is RestServiceDef {
  return service.type === "rest";
}

/**
 * Checks if a service definition is a Socket service.
 * 
 * Type guard to determine if a service definition represents a WebSocket service.
 * Used for service type discrimination and validation.
 * 
 * @param {ServiceDefinition} service - Service definition to check
 * @returns {boolean} True if service is a Socket service, false otherwise
 * 
 * @example
 * isSocketService({ name: "chat", type: "socket", url: "wss://..." }); // returns true
 * isSocketService({ name: "weather", type: "rest" }); // returns false
 */
export function isSocketService(
  service: ServiceDefinition,
): service is SocketServiceDef {
  return service.type === "socket";
}

/**
 * Checks if a service definition is an MCP service.
 * 
 * Type guard to determine if a service definition represents an MCP
 * (Multiplayer Control Protocol) service. Used for service type discrimination.
 * 
 * @param {ServiceDefinition} service - Service definition to check
 * @returns {boolean} True if service is an MCP service, false otherwise
 * 
 * @example
 * isMcpService({ name: "game", type: "mcp", serverUrl: "..." }); // returns true
 * isMcpService({ name: "chat", type: "socket" }); // returns false
 */
export function isMcpService(
  service: ServiceDefinition,
): service is McpServiceDef {
  return service.type === "mcp";
}

/**
 * Get all service names from a list of services.
 */
export function getServiceNames(services: ServiceDefinition[]): string[] {
  return services.map((s) => s.name);
}

/**
 * Find a service by name.
 */
export function findService(
  services: ServiceDefinition[],
  name: string,
): ServiceDefinition | undefined {
  return services.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

/**
 * Check if a service name exists (case-insensitive).
 */
export function hasService(
  services: ServiceDefinition[],
  name: string,
): boolean {
  return services.some((s) => s.name.toLowerCase() === name.toLowerCase());
}

/**
 * Allowed leaf value for `ServiceParams`. Mirrors `EventPayloadValue`'s
 * recursive-array shape so integration call signatures can express the
 * nested structures real services need (port mappings, volume mounts,
 * pagination cursors), and so a value satisfying `EventPayloadValue`
 * also satisfies `ServiceParamsValue` without a cast — the same data
 * flows through `call-service` and `emit` without boundary widening.
 */
export type ServiceParamsValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | ServiceParams
  | readonly ServiceParamsValue[];

/** Parameters passed to call-service effects. Recursive for nested request shapes. */
export type ServiceParams = {
  [key: string]: ServiceParamsValue;
};

export interface CredentialIdentity {
  name: string;
  principal?: string;
}

export function credentialStorageKey(identity: CredentialIdentity): string {
  if (typeof identity.name !== 'string' || (identity.principal !== undefined && typeof identity.principal !== 'string')) {
    throw new Error('credential identity requires string name and principal');
  }
  return JSON.stringify([identity.principal ?? null, identity.name]);
}

export function resolveCredentialStatusIdentity(selection: RuntimeValue, principal: string | undefined): CredentialIdentity {
  if (selection !== null && typeof selection === 'object' && !Array.isArray(selection)) {
    const keys = Reflect.ownKeys(selection);
    if (keys.length !== 2 || !keys.includes('credential') || !keys.includes('scope') || !('credential' in selection) || !('scope' in selection)) {
      throw new Error('credential-status: expected { credential, scope: app | user }');
    }
    const { credential, scope } = selection;
    if (typeof credential !== 'string' || (scope !== 'app' && scope !== 'user')) {
      throw new Error('credential-status: expected { credential, scope: app | user }');
    }
    if (scope === 'app') return { name: credential };
    if (principal === undefined) throw new Error('credential-status: nobody is signed in');
    return { name: credential, principal };
  }
  if (principal === undefined) throw new Error('credential-status: nobody is signed in');
  if (typeof selection !== 'string') throw new Error("credential-status: the credential must be a secret knob's name");
  return { name: selection, principal };
}

export function credentialStatusConnected(value: string | undefined, principal: string | undefined): boolean {
  return value !== undefined && (principal !== undefined || value !== '');
}
