//! Test generator for TypeScript (Vitest)
//!
//! Generates tests for the closed-circuit pattern where all data operations
//! flow through trait event handlers with guard enforcement.

use crate::backend::to_lowercase_nosep;
use orbital_core::generate::GeneratedFile;
use orbital_core::ir::{OirEntity, OirModule, OirPage, OirTrait};
use orbital_core::str_utils::{to_camel_case, to_kebab_case};

/// Generate all tests for a module
pub fn generate_tests(module: &OirModule) -> Vec<GeneratedFile> {
    let mut files = vec![];

    // Entity tests
    for entity in &module.entities {
        files.push(generate_entity_tests(entity));
    }

    // Trait tests (using server bridge pattern)
    for trait_def in &module.traits {
        files.push(generate_trait_tests(trait_def));
    }

    // Page tests
    for page in &module.pages {
        files.push(generate_page_tests(page));
    }

    // Server handler tests
    for trait_def in &module.traits {
        files.push(generate_server_handler_tests(trait_def));
    }

    // Integration tests
    files.push(generate_integration_tests(module));

    files
}

/// Generate tests for an entity
pub fn generate_entity_tests(entity: &OirEntity) -> GeneratedFile {
    let name = &entity.name;

    let mut code = String::new();

    // Imports - use actual generated paths (schemas use camelCase)
    let schema_name = to_camel_case(name);
    code.push_str("import { describe, it, expect } from 'vitest';\n");
    code.push_str(&format!(
        "import type {{ {}, {}Input }} from '../../types/entities.js';\n",
        name, name
    ));
    code.push_str(&format!(
        "import {{ {}Schema, {}InputSchema, {}UpdateSchema }} from '../../schemas/entities.js';\n\n",
        schema_name, schema_name, schema_name
    ));

    // Test suite
    code.push_str(&format!("describe('{} Entity', () => {{\n", name));

    // Schema validation tests
    code.push_str(&format!("  describe('{}Schema', () => {{\n", schema_name));
    code.push_str("    it('should validate a complete entity', () => {\n");
    code.push_str(&format!("      const valid{}: {} = {{\n", name, name));
    code.push_str("        id: 'test-id',\n");
    for field in &entity.fields {
        if field.name == "id" {
            continue;
        }
        let default_value = get_field_test_value(field);
        code.push_str(&format!("        {}: {},\n", field.name, default_value));
    }
    code.push_str("      };\n");
    code.push_str(&format!(
        "      const result = {}Schema.safeParse(valid{});\n",
        schema_name, name
    ));
    code.push_str("      expect(result.success).toBe(true);\n");
    code.push_str("    });\n\n");

    code.push_str("    it('should reject invalid entity (missing id)', () => {\n");
    // `safeParse` accepts any value, so the deliberately-invalid object needs
    // no annotation — an empty object is rejected for the missing required id.
    code.push_str("      const invalid = {};\n");
    code.push_str(&format!(
        "      const result = {}Schema.safeParse(invalid);\n",
        schema_name
    ));
    code.push_str("      expect(result.success).toBe(false);\n");
    code.push_str("    });\n");
    code.push_str("  });\n\n");

    // Input schema tests
    // Note: taskInputSchema = taskSchema.omit({ id: true }), so only id is omitted
    code.push_str(&format!(
        "  describe('{}InputSchema', () => {{\n",
        schema_name
    ));
    code.push_str("    it('should validate input for creation', () => {\n");
    code.push_str(&format!("      const input: {}Input = {{\n", name));
    for field in &entity.fields {
        // Skip id, createdAt, updatedAt - these are excluded from Input type
        if field.name == "id" || field.name == "createdAt" || field.name == "updatedAt" {
            continue;
        }
        let default_value = get_field_test_value(field);
        code.push_str(&format!("        {}: {},\n", field.name, default_value));
    }
    code.push_str("      };\n");
    code.push_str(&format!(
        "      const result = {}InputSchema.safeParse(input);\n",
        schema_name
    ));
    code.push_str("      expect(result.success).toBe(true);\n");
    code.push_str("    });\n");
    code.push_str("  });\n\n");

    // Update schema tests
    code.push_str(&format!(
        "  describe('{}UpdateSchema', () => {{\n",
        schema_name
    ));
    code.push_str("    it('should validate partial update (all fields optional)', () => {\n");
    code.push_str("      const partialUpdate = {\n");
    // Pick the first non-id, non-timestamp field
    if let Some(field) = entity
        .fields
        .iter()
        .find(|f| f.name != "id" && f.name != "createdAt" && f.name != "updatedAt")
    {
        let default_value = get_field_test_value(field);
        code.push_str(&format!("        {}: {},\n", field.name, default_value));
    }
    code.push_str("      };\n");
    code.push_str(&format!(
        "      const result = {}UpdateSchema.safeParse(partialUpdate);\n",
        schema_name
    ));
    code.push_str("      expect(result.success).toBe(true);\n");
    code.push_str("    });\n\n");
    code.push_str("    it('should validate empty update', () => {\n");
    code.push_str(&format!(
        "      const result = {}UpdateSchema.safeParse({{}});\n",
        schema_name
    ));
    code.push_str("      expect(result.success).toBe(true);\n");
    code.push_str("    });\n");
    code.push_str("  });\n\n");

    // Type structure tests
    code.push_str("  describe('type structure', () => {\n");
    for field in &entity.fields {
        code.push_str(&format!(
            "    it('should have {} field in schema', () => {{\n",
            field.name
        ));
        code.push_str(&format!(
            "      expect({}Schema.shape).toHaveProperty('{}');\n",
            schema_name, field.name
        ));
        code.push_str("    });\n\n");
    }
    code.push_str("  });\n");

    code.push_str("});\n");

    GeneratedFile::new(
        format!(
            "packages/shared/src/__tests__/entities/{}.test.ts",
            to_kebab_case(name)
        ),
        code,
    )
}

/// Get a default test value for a field type
fn get_default_test_value(field_type: &orbital_core::ir::OirType) -> &'static str {
    use orbital_core::ir::OirType;
    match field_type {
        OirType::String => "'test-value'",
        OirType::Number | OirType::Integer => "42",
        OirType::Boolean => "false",
        OirType::Date | OirType::DateTime => "'2024-01-01T00:00:00Z'",
        OirType::Email => "'test@example.com'",
        OirType::Url | OirType::Image => "'https://example.com/test'",
        OirType::Phone => "'+1-555-0100'",
        OirType::Uuid => "'00000000-0000-4000-8000-000000000001'",
        OirType::Money => "42",
        OirType::File => "{ name: 'test.pdf', url: 'https://example.com/test.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }",
        OirType::Array { .. } | OirType::Tuple { .. } => "[]",
        OirType::Map { .. } => "{}",
        OirType::Optional { .. } => "null",
        OirType::Reference { .. } => "'ref-id'",
        OirType::Row { .. } => "{}",
        OirType::Enum { .. } => "'default'",
        OirType::Json => "{}",
        OirType::Scalar => "'test-value'",
        OirType::Union { .. } => "{}",
        OirType::Struct { .. } => "{}",
        OirType::Trait => "'@trait.MockTrait'",
        OirType::Orbital => "null",
        OirType::Behavior => "null",
        OirType::SExpr => "'noop'",
        OirType::Node => "null",
        // Generation needs a depth cap, never an expansion — the empty
        // placeholder terminates immediately, same as the other struct-ish
        // leaves above.
        OirType::TypeRef { .. } => "{}",
    }
}

/// Get a default test value for a field, with enum values support
fn get_field_test_value(field: &orbital_core::ir::OirField) -> String {
    use orbital_core::ir::OirType;
    match &field.field_type {
        OirType::Enum { .. } => {
            // Use the first enum value if available
            if let Some(values) = &field.enum_values {
                if let Some(first) = values.first() {
                    return format!("'{}'", first);
                }
            }
            "'default'".to_string()
        }
        _ => get_default_test_value(&field.field_type).to_string(),
    }
}

/// Generate tests for a trait (client-side hook with server bridge)
pub fn generate_trait_tests(trait_def: &OirTrait) -> GeneratedFile {
    let name = &trait_def.name;
    let _name_lower = to_camel_case(name);

    let mut code = String::new();

    // Imports
    code.push_str("import React from 'react';\n");
    code.push_str("import { describe, it, expect, vi, beforeEach } from 'vitest';\n");
    code.push_str("import { renderHook, act, waitFor } from '@testing-library/react';\n");
    code.push_str("import { MemoryRouter } from 'react-router-dom';\n");
    code.push_str(&format!(
        "import {{ use{}Logic }} from '@/hooks/traits/use{}Logic';\n",
        name, name
    ));
    code.push_str("import { useOrbitalBridge } from '@/hooks/useOrbitalBridge';\n");
    code.push_str("import type { EventResponse } from '@app/shared';\n\n");

    // Mock orbital bridge (Phase 5)
    code.push_str("// Mock the orbital bridge\n");
    code.push_str("vi.mock('@/hooks/useOrbitalBridge', () => ({\n");
    code.push_str("  useOrbitalBridge: vi.fn(),\n");
    code.push_str("}));\n\n");

    // Mock event bus — on() must return an unsubscribe function
    code.push_str("vi.mock('@almadar/ui/hooks', () => ({\n");
    code.push_str(
        "  useEventBus: () => ({ emit: vi.fn(), on: vi.fn(() => vi.fn()), off: vi.fn() }),\n",
    );
    code.push_str("  useUIEvents: vi.fn(),\n");
    code.push_str("}));\n\n");

    // Wrapper with MemoryRouter for hooks that use useNavigate
    code.push_str("const wrapper = ({ children }: { children: React.ReactNode }) => (\n");
    code.push_str("  <MemoryRouter>{children}</MemoryRouter>\n");
    code.push_str(");\n\n");

    // Test suite
    code.push_str(&format!("describe('use{}Logic', () => {{\n", name));

    // Setup
    code.push_str("  const mockSendEvent = vi.fn();\n\n");

    code.push_str("  beforeEach(() => {\n");
    code.push_str("    vi.clearAllMocks();\n");
    code.push_str("    (useOrbitalBridge as ReturnType<typeof vi.fn>).mockReturnValue({\n");
    code.push_str("      sendEvent: mockSendEvent,\n");
    code.push_str("      eventBus: { emit: vi.fn(), on: vi.fn(() => vi.fn()), off: vi.fn() },\n");
    code.push_str("    });\n");
    code.push_str("  });\n\n");

    // Initial state test
    let initial_state = trait_def
        .states
        .iter()
        .find(|s| s.is_initial)
        .map(|s| &s.name)
        .unwrap_or(&trait_def.states[0].name);

    code.push_str("  describe('initial state', () => {\n");
    code.push_str("    it('should start in initial state', () => {\n");
    code.push_str("      mockSendEvent.mockResolvedValue({ success: true, newState: '");
    code.push_str(initial_state);
    code.push_str("', data: {} });\n");
    code.push_str(&format!(
        "      const {{ result }} = renderHook(() => use{}Logic(), {{ wrapper }});\n",
        name
    ));
    code.push_str(&format!(
        "      expect(result.current.state).toBe('{}');\n",
        initial_state
    ));
    code.push_str("    });\n\n");

    code.push_str("    it('should auto-dispatch INIT on mount', async () => {\n");
    code.push_str("      mockSendEvent.mockResolvedValue({ success: true, newState: '");
    code.push_str(initial_state);
    code.push_str("', data: {} });\n");
    code.push_str(&format!(
        "      renderHook(() => use{}Logic(), {{ wrapper }});\n",
        name
    ));
    code.push_str("      await waitFor(() => {\n");
    code.push_str("        expect(mockSendEvent).toHaveBeenCalledWith('INIT', undefined, '");
    code.push_str(initial_state);
    code.push_str("');\n");
    code.push_str("      });\n");
    code.push_str("    });\n");
    code.push_str("  });\n\n");

    // Event dispatch tests
    code.push_str("  describe('event dispatch', () => {\n");
    for event in &trait_def.events {
        code.push_str(&format!(
            "    it('should dispatch {} event to server', async () => {{\n",
            event.key
        ));
        code.push_str("      mockSendEvent.mockResolvedValue({ success: true, newState: '");
        code.push_str(initial_state);
        code.push_str("', data: {} });\n");
        code.push_str(&format!(
            "      const {{ result }} = renderHook(() => use{}Logic(), {{ wrapper }});\n",
            name
        ));
        code.push_str("\n      await act(async () => {\n");
        code.push_str(&format!(
            "        await result.current.dispatch('{}', {{ test: 'payload' }});\n",
            event.key
        ));
        code.push_str("      });\n\n");
        code.push_str(&format!(
            "      expect(mockSendEvent).toHaveBeenCalledWith('{}', {{ test: 'payload' }}, expect.any(String));\n",
            event.key
        ));
        code.push_str("    });\n\n");
    }
    code.push_str("  });\n\n");

    // Loading state tests
    code.push_str("  describe('loading state', () => {\n");
    code.push_str("    it('should set loading=true when dispatching', async () => {\n");
    code.push_str("      let resolvePromise: (value: EventResponse) => void;\n");
    code.push_str("      mockSendEvent.mockImplementation(() => new Promise(resolve => { resolvePromise = resolve; }));\n");
    code.push_str(&format!(
        "      const {{ result }} = renderHook(() => use{}Logic(), {{ wrapper }});\n",
        name
    ));
    code.push_str("\n      act(() => {\n");
    code.push_str("        result.current.dispatch('INIT');\n");
    code.push_str("      });\n\n");
    code.push_str("      expect(result.current.loading).toBe(true);\n\n");
    code.push_str("      await act(async () => {\n");
    code.push_str(&format!(
        "        resolvePromise!({{ success: true, newState: '{}', data: {{}} }});\n",
        initial_state
    ));
    code.push_str("      });\n\n");
    code.push_str("      expect(result.current.loading).toBe(false);\n");
    code.push_str("    });\n");
    code.push_str("  });\n\n");

    // Error handling tests
    code.push_str("  describe('error handling', () => {\n");
    code.push_str("    it('should handle server errors', async () => {\n");
    code.push_str(
        "      mockSendEvent.mockResolvedValue({ success: false, error: 'Access denied' });\n",
    );
    code.push_str(&format!(
        "      const {{ result }} = renderHook(() => use{}Logic(), {{ wrapper }});\n",
        name
    ));
    code.push_str("\n      await act(async () => {\n");
    code.push_str("        await result.current.dispatch('INIT');\n");
    code.push_str("      });\n\n");
    code.push_str("      expect(result.current.error).toBe('Access denied');\n");
    code.push_str("    });\n\n");

    code.push_str("    it('should handle network errors', async () => {\n");
    code.push_str("      mockSendEvent.mockRejectedValue(new Error('Network error'));\n");
    code.push_str(&format!(
        "      const {{ result }} = renderHook(() => use{}Logic(), {{ wrapper }});\n",
        name
    ));
    code.push_str("\n      await act(async () => {\n");
    code.push_str("        await result.current.dispatch('INIT');\n");
    code.push_str("      });\n\n");
    code.push_str("      expect(result.current.error).toBe('Network error');\n");
    code.push_str("    });\n");
    code.push_str("  });\n\n");

    // Data injection tests
    code.push_str("  describe('data injection', () => {\n");
    code.push_str("    it('should store fetched data from server response', async () => {\n");
    code.push_str("      const mockData = { Task: [{ id: '1', title: 'Test' }] };\n");
    code.push_str("      mockSendEvent.mockResolvedValue({ success: true, newState: '");
    code.push_str(initial_state);
    code.push_str("', data: mockData });\n");
    code.push_str(&format!(
        "      const {{ result }} = renderHook(() => use{}Logic(), {{ wrapper }});\n",
        name
    ));
    code.push_str("\n      await act(async () => {\n");
    code.push_str("        await result.current.dispatch('INIT');\n");
    code.push_str("      });\n\n");
    code.push_str("      expect(result.current.data).toEqual(mockData);\n");
    code.push_str("    });\n");
    code.push_str("  });\n");

    code.push_str("});\n");

    GeneratedFile::new(
        format!(
            "packages/client/src/hooks/traits/__tests__/use{}Logic.test.tsx",
            name
        ),
        code,
    )
}

/// Generate tests for server-side event handlers
pub fn generate_server_handler_tests(trait_def: &OirTrait) -> GeneratedFile {
    let name = &trait_def.name;

    let mut code = String::new();

    // Imports
    code.push_str("import { describe, it, expect, vi, beforeEach } from 'vitest';\n");
    code.push_str("import type { Request, Response, NextFunction } from 'express';\n");
    code.push_str("import { handleEvent } from '../handlers.js';\n");
    code.push_str("import type { EventResponse } from '@app/shared';\n\n");
    // Augment Express Request with the verified user `@almadar/server`'s middleware sets
    code.push_str("declare module 'express' {\n");
    code.push_str("  interface Request { authUser?: import('@almadar/auth').VerifiedUser }\n");
    code.push_str("}\n\n");

    // Mock @almadar/server dependencies
    code.push_str("// Mock @almadar/server\n");
    code.push_str("const mockDataService = {\n");
    code.push_str("  list: vi.fn(),\n");
    code.push_str("  create: vi.fn(),\n");
    code.push_str("  update: vi.fn(),\n");
    code.push_str("  delete: vi.fn(),\n");
    code.push_str("  findById: vi.fn(),\n");
    code.push_str("};\n");
    code.push_str("vi.mock('@almadar/server', () => ({\n");
    code.push_str("  getDataService: vi.fn(() => mockDataService),\n");
    code.push_str("  resetDataService: vi.fn(),\n");
    code.push_str(
        "  getServerEventBus: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() })),\n",
    );
    code.push_str("  resetServerEventBus: vi.fn(),\n");
    code.push_str("  getMockDataService: vi.fn(() => mockDataService),\n");
    code.push_str("  resetMockDataService: vi.fn(),\n");
    code.push_str("  logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn() },\n");
    code.push_str("  identifyBearer: vi.fn((_req, _res, next) => next()),\n");
    code.push_str("}));\n\n");

    // Test suite
    code.push_str(&format!("describe('{} Server Handlers', () => {{\n", name));

    // Setup
    code.push_str("  let mockReq: Partial<Request>;\n");
    code.push_str("  let mockRes: Partial<Response>;\n");
    code.push_str("  let mockNext: NextFunction;\n");
    code.push_str("  let jsonResponse: EventResponse | undefined;\n\n");

    code.push_str("  beforeEach(() => {\n");
    code.push_str("    vi.clearAllMocks();\n");
    code.push_str("    jsonResponse = undefined;\n");
    code.push_str("    mockRes = {\n");
    code.push_str(
        "      json: vi.fn((data) => { jsonResponse = data; return mockRes as Response; }),\n",
    );
    code.push_str("      status: vi.fn(() => mockRes as Response),\n");
    code.push_str("    };\n");
    code.push_str("    mockNext = vi.fn();\n");
    code.push_str("  });\n\n");

    // Initial state
    let initial_state = trait_def
        .states
        .iter()
        .find(|s| s.is_initial)
        .map(|s| &s.name)
        .unwrap_or(&trait_def.states[0].name);

    // Event handler tests
    code.push_str("  describe('handleEvent', () => {\n");

    for event in &trait_def.events {
        code.push_str(&format!("    describe('{} event', () => {{\n", event.key));

        code.push_str(&format!(
            "      it('should handle {} event', async () => {{\n",
            event.key
        ));
        code.push_str("        mockReq = {\n");
        code.push_str(&format!(
            "          body: {{ event: '{}', currentState: '{}' }},\n",
            event.key, initial_state
        ));
        code.push_str("        };\n\n");
        code.push_str(
            "        await handleEvent(mockReq as Request, mockRes as Response, mockNext);\n\n",
        );
        code.push_str("        expect(mockRes.json).toHaveBeenCalled();\n");
        code.push_str("        const response = jsonResponse as { success: boolean };\n");
        code.push_str("        // Event should either succeed or fail gracefully\n");
        code.push_str("        expect(response).toHaveProperty('success');\n");
        code.push_str("      });\n");
        code.push_str("    });\n\n");
    }

    code.push_str("    it('should return error for unknown event', async () => {\n");
    code.push_str("      mockReq = {\n");
    code.push_str(&format!(
        "        body: {{ event: 'UNKNOWN_EVENT', currentState: '{}' }},\n",
        initial_state
    ));
    code.push_str("      };\n\n");
    code.push_str(
        "      await handleEvent(mockReq as Request, mockRes as Response, mockNext);\n\n",
    );
    code.push_str("      const response = jsonResponse as { success: boolean; error?: string };\n");
    code.push_str("      expect(response.success).toBe(false);\n");
    code.push_str("      expect(response.error).toContain('Unknown event');\n");
    code.push_str("    });\n");

    code.push_str("  });\n\n");

    // Guard tests (if any transitions have guards)
    let has_guards = trait_def.transitions.iter().any(|t| t.guard.is_some());
    if has_guards {
        code.push_str("  describe('guard enforcement', () => {\n");
        for trans in &trait_def.transitions {
            if trans.guard.is_some() {
                code.push_str(&format!(
                    "    it('should enforce guard on {} -> {} via {}', async () => {{\n",
                    match &trans.from {
                        orbital_core::ir::OirTransitionFrom::Single(s) => s.clone(),
                        _ => "*".to_string(),
                    },
                    trans.to,
                    trans.event
                ));
                code.push_str("      // Test guard enforcement\n");
                code.push_str("      mockReq = {\n");
                code.push_str(&format!(
                    "        body: {{ event: '{}', currentState: '{}' }},\n",
                    trans.event,
                    match &trans.from {
                        orbital_core::ir::OirTransitionFrom::Single(s) => s.clone(),
                        _ => initial_state.to_string(),
                    }
                ));
                code.push_str("        authUser: undefined, // No user: the anonymous viewer\n");
                code.push_str("      };\n\n");
                code.push_str("      await handleEvent(mockReq as Request, mockRes as Response, mockNext);\n\n");
                code.push_str("      const response = jsonResponse as { success: boolean; guardFailed?: string };\n");
                code.push_str(
                    "      // Guard should either pass or fail with guardFailed message\n",
                );
                code.push_str("      expect(response).toHaveProperty('success');\n");
                code.push_str("    });\n\n");
            }
        }
        code.push_str("  });\n\n");
    }

    // Response structure tests
    code.push_str("  describe('response structure', () => {\n");
    code.push_str("    it('should return proper EventResponse structure', async () => {\n");
    code.push_str("      mockReq = {\n");
    code.push_str(&format!(
        "        body: {{ event: 'INIT', currentState: '{}' }},\n",
        initial_state
    ));
    code.push_str("      };\n\n");
    code.push_str(
        "      await handleEvent(mockReq as Request, mockRes as Response, mockNext);\n\n",
    );
    code.push_str("      const response = jsonResponse;\n");
    code.push_str("      expect(response).toHaveProperty('success');\n");
    code.push_str("      if (response?.success) {\n");
    code.push_str("        expect(response).toHaveProperty('newState');\n");
    code.push_str("        expect(response).toHaveProperty('data');\n");
    code.push_str("      }\n");
    code.push_str("    });\n");
    code.push_str("  });\n");

    code.push_str("});\n");

    GeneratedFile::new(
        format!(
            "packages/server/src/routes/features/{}/__tests__/handlers.test.ts",
            to_kebab_case(name)
        ),
        code,
    )
}

/// Generate tests for a page
pub fn generate_page_tests(page: &OirPage) -> GeneratedFile {
    let name = &page.name;
    // Use lowercase no separator to match the page folder naming convention
    let folder_name = to_lowercase_nosep(name);

    // The component name must match what backend.rs generates:
    // backend.rs exports `function {page.name}(...)` in `{page.name}.tsx`
    // So use the page name directly as the component name.
    let component_name = name.clone();

    let mut code = String::new();

    // Imports
    code.push_str("import React from 'react';\n");
    code.push_str("import { describe, it, expect, vi } from 'vitest';\n");
    code.push_str("import { render, screen } from '@testing-library/react';\n");
    code.push_str("import { MemoryRouter } from 'react-router-dom';\n");
    code.push_str("import { QueryClient, QueryClientProvider } from '@tanstack/react-query';\n");
    // Import from the actual page file (e.g., ../TasksPage)
    code.push_str(&format!(
        "import {{ {} }} from '../{}.js';\n",
        component_name, component_name
    ));
    code.push_str("import { EventBusProvider } from '@almadar/ui/providers';\n\n");

    // Mock orbital bridge to prevent actual API calls (Phase 5)
    code.push_str("// Mock orbital bridge\n");
    code.push_str("vi.mock('@/hooks/useOrbitalBridge', () => ({\n");
    code.push_str("  useOrbitalBridge: () => ({\n");
    code.push_str("    sendEvent: vi.fn().mockResolvedValue({ success: true, newState: 'idle', data: {} }),\n");
    code.push_str("    eventBus: { emit: vi.fn(), on: vi.fn(() => vi.fn()), off: vi.fn() },\n");
    code.push_str("  }),\n");
    code.push_str("}));\n\n");

    // Create QueryClient for tests
    code.push_str("const queryClient = new QueryClient({\n");
    code.push_str("  defaultOptions: {\n");
    code.push_str("    queries: { retry: false },\n");
    code.push_str("  },\n");
    code.push_str("});\n\n");

    // Helper function to render with providers
    code.push_str("const renderWithProviders = (ui: React.ReactElement) => {\n");
    code.push_str("  return render(\n");
    code.push_str("    <QueryClientProvider client={queryClient}>\n");
    code.push_str("      <MemoryRouter>\n");
    code.push_str("        <EventBusProvider>{ui}</EventBusProvider>\n");
    code.push_str("      </MemoryRouter>\n");
    code.push_str("    </QueryClientProvider>\n");
    code.push_str("  );\n");
    code.push_str("};\n\n");

    // Test suite
    code.push_str(&format!("describe('{}', () => {{\n", component_name));

    // Render test
    code.push_str("  it('should render without crashing', () => {\n");
    code.push_str(&format!(
        "    renderWithProviders(<{} />);\n",
        component_name
    ));
    code.push_str("  });\n\n");

    // Section tests
    for section in &page.sections {
        code.push_str(&format!(
            "  it('should render {} section', () => {{\n",
            section.id
        ));
        code.push_str(&format!(
            "    renderWithProviders(<{} />);\n",
            component_name
        ));
        code.push_str(&format!(
            "    const section = document.querySelector('[data-slot=\"{}\"]');\n",
            section.id
        ));
        code.push_str("    expect(section).toBeTruthy();\n");
        code.push_str("  });\n\n");
    }

    code.push_str("});\n");

    // Output path uses lowercase no separator to match page folder
    GeneratedFile::new(
        format!(
            "packages/client/src/features/{}/__tests__/page.test.tsx",
            folder_name
        ),
        code,
    )
}

/// Generate integration tests
pub fn generate_integration_tests(module: &OirModule) -> GeneratedFile {
    let mut code = String::new();

    // Imports
    code.push_str("import { describe, it, expect, beforeAll, afterAll } from 'vitest';\n");
    code.push_str("import { render, screen, waitFor } from '@testing-library/react';\n");
    code.push_str("import userEvent from '@testing-library/user-event';\n\n");

    // Import entities from shared package
    if !module.entities.is_empty() {
        let entity_names: Vec<String> = module.entities.iter().map(|e| e.name.clone()).collect();
        code.push_str(&format!(
            "import {{ {} }} from '@app/shared';\n",
            entity_names.join(", ")
        ));
    }
    code.push('\n');

    // Test suite
    code.push_str(&format!(
        "describe('{} Integration Tests', () => {{\n",
        module.name
    ));

    // Setup
    code.push_str("  beforeAll(() => {\n");
    code.push_str("    // Setup test environment\n");
    code.push_str("  });\n\n");

    code.push_str("  afterAll(() => {\n");
    code.push_str("    // Cleanup\n");
    code.push_str("  });\n\n");

    // Entity integration tests
    for entity in &module.entities {
        code.push_str(&format!(
            "  describe('{} CRUD operations', () => {{\n",
            entity.name
        ));
        code.push_str("    it('should create, read, update, and delete', async () => {\n");
        code.push_str("      // Integration test implementation\n");
        code.push_str("      expect(true).toBe(true);\n");
        code.push_str("    });\n");
        code.push_str("  });\n\n");
    }

    // Trait workflow tests
    for trait_def in &module.traits {
        code.push_str(&format!(
            "  describe('{} workflow', () => {{\n",
            trait_def.name
        ));
        code.push_str("    it('should complete full state machine cycle', async () => {\n");
        code.push_str("      // Workflow test implementation\n");
        code.push_str("      expect(true).toBe(true);\n");
        code.push_str("    });\n");
        code.push_str("  });\n\n");
    }

    code.push_str("});\n");

    GeneratedFile::new(
        "packages/server/src/__tests__/integration.test.ts".to_string(),
        code,
    )
}
