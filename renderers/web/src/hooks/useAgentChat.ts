'use client';
/**
 * useAgentChat Hook
 *
 * Stub implementation for agent chat functionality.
 */

import { useState, useCallback } from 'react';
import type { DeepAgentInterrupt } from './useDeepAgentGeneration';
import type { FieldValue, OrbitalSchema } from '@almadar/core';
import { createLogger } from '@almadar/logger';

const log = createLogger('almadar:ui:agent-chat');

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export type AvatarRole = 'user' | 'assistant' | 'system';
export type FileOperation = 'ls' | 'read_file' | 'write_file' | 'edit_file';

// Activity type matches ActivityItem from AgentActivityFeed
export type Activity =
  | { type: 'message'; role: AvatarRole; content: string; timestamp: number; isStreaming?: boolean }
  | { type: 'tool_call'; tool: string; args: Record<string, FieldValue>; timestamp: number; isExecuting?: boolean }
  | { type: 'tool_result'; tool: string; result: FieldValue | null; success: boolean; timestamp: number }
  | { type: 'file_operation'; operation: FileOperation; path: string; success?: boolean; timestamp: number }
  | { type: 'schema_diff'; filePath: string; hunks: DiffHunk[]; timestamp: number }
  | { type: 'error'; message: string; code?: string; timestamp: number };

export interface TodoActivity {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'code_change';
  content: string;
  timestamp: number;
  tool?: string;
  success?: boolean;
  filePath?: string;
  diff?: string;
}

export interface Todo {
  id: string;
  task: string;
  status: 'pending' | 'in_progress' | 'completed';
  latestActivity?: TodoActivity;
  activityHistory?: TodoActivity[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Array<{
    type: 'add' | 'remove' | 'context';
    content: string;
  }>;
}

export interface SchemaDiff {
  id: string;
  filePath: string;
  hunks: DiffHunk[];
  timestamp: number;
  addedLines: number;
  removedLines: number;
}

export type AgentStatus = 'idle' | 'running' | 'complete' | 'error' | 'interrupted';

export interface UseAgentChatOptions {
  appId?: string;
  onComplete?: (schema?: OrbitalSchema) => void;
  onSchemaChange?: (diff?: OrbitalSchema) => void;
  onError?: (error: Error | string) => void;
}

export interface UseAgentChatResult {
  messages: ChatMessage[];
  status: AgentStatus;
  activities: Activity[];
  todos: Todo[];
  schemaDiffs: SchemaDiff[];
  isLoading: boolean;
  error: string | null;
  threadId: string | null;
  interrupt: DeepAgentInterrupt | null;
  sendMessage: (content: string) => Promise<void>;
  startGeneration: (skill: string | string[], prompt: string, options?: Record<string, FieldValue>) => Promise<void>;
  continueConversation: (message: string | string[]) => Promise<void>;
  resumeWithDecision: (decisions: FieldValue[]) => Promise<void>;
  cancel: () => void;
  clearMessages: () => void;
  clearHistory: () => void;
}

export function useAgentChat(options?: UseAgentChatOptions): UseAgentChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [schemaDiffs, setSchemaDiffs] = useState<SchemaDiff[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId] = useState<string | null>(null);
  const [interrupt, setInterrupt] = useState<DeepAgentInterrupt | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    setIsLoading(true);
    setStatus('running');
    setError(null);

    try {
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);

      // TODO: Implement actual agent chat API call
      log.debug('Sending message', { content });

      // Stub response
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Agent chat is not yet implemented.',
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setStatus('idle');
      options?.onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  const startGeneration = useCallback(async (skill: string | string[], prompt: string, genOptions?: Record<string, FieldValue>) => {
    setStatus('running');
    setIsLoading(true);
    setError(null);

    const skillName = Array.isArray(skill) ? skill[0] : skill;
    try {
      log.debug('Starting generation', () => ({ skillName, prompt, genOptions: JSON.stringify(genOptions) }));
      // TODO: Implement actual generation
      await new Promise((resolve) => setTimeout(resolve, 100));
      setStatus('complete');
      options?.onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  }, [options]);

  const continueConversation = useCallback(async (message: string | string[]) => {
    log.debug('Continue conversation', { message: Array.isArray(message) ? message : [message] });
    // TODO: Implement actual continue conversation
  }, []);

  const resumeWithDecision = useCallback(async (decisions: FieldValue[]) => {
    log.debug('Resume with decision', () => ({ decisions: JSON.stringify(decisions), count: decisions.length }));
    setInterrupt(null);
    // TODO: Implement actual resume with decision
  }, []);

  const cancel = useCallback(() => {
    setStatus('idle');
    setIsLoading(false);
    setInterrupt(null);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setActivities([]);
    setTodos([]);
    setSchemaDiffs([]);
    setError(null);
  }, []);

  return {
    messages,
    status,
    activities,
    todos,
    schemaDiffs,
    isLoading,
    error,
    threadId,
    interrupt,
    sendMessage,
    startGeneration,
    continueConversation,
    resumeWithDecision,
    cancel,
    clearMessages,
    clearHistory,
  };
}
