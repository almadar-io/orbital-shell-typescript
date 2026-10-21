'use client';
/**
 * useCompile Hook
 *
 * Handles schema compilation to generate application files.
 */

import { useState, useCallback } from 'react';
import type { OrbitalSchema } from '@almadar/core';
import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:ui:compile');

// =============================================================================
// Types
// =============================================================================

export type CompileStage = 'idle' | 'compiling' | 'done' | 'error';

export interface CompileResult {
  success: boolean;
  files?: Array<{ path: string; content: string }>;
  errors?: string[];
}

export interface UseCompileResult {
  isCompiling: boolean;
  stage: CompileStage;
  lastResult: CompileResult | null;
  error: string | null;
  compileSchema: (schema: OrbitalSchema) => Promise<CompileResult | null>;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useCompile(): UseCompileResult {
  const [isCompiling, setIsCompiling] = useState(false);
  const [stage, setStage] = useState<CompileStage>('idle');
  const [lastResult, setLastResult] = useState<CompileResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const compileSchema = useCallback(async (schema: OrbitalSchema): Promise<CompileResult | null> => {
    setIsCompiling(true);
    setStage('compiling');
    setError(null);

    try {
      // TODO: Implement actual compilation via API
      log.debug('Compiling schema', { name: schema.name });

      // Mock result for now
      const result: CompileResult = {
        success: true,
        files: [],
      };

      setLastResult(result);
      setStage('done');
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Compilation failed';
      setError(errorMessage);
      setStage('error');
      setLastResult({ success: false, errors: [errorMessage] });
      return null;
    } finally {
      setIsCompiling(false);
    }
  }, []);

  return {
    isCompiling,
    stage,
    lastResult,
    error,
    compileSchema,
  };
}
