import * as path from 'path';

import { KanbanTask } from './markdownParser';

export interface TerminalSettings {
  binary: string;
  args: string[];
  env: Record<string, string>;
  appendTaskPrompt: boolean;
  promptTemplate: string;
}

export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  binary: 'codex',
  args: [],
  env: {},
  appendTaskPrompt: true,
  promptTemplate: [
    'Work on this Markdown Kanban task in the current project.',
    '',
    'Board: {relativeFile}',
    'Task: {title}',
    'Description: {description}',
    'Tags: {tags}',
    'Due date: {dueDate}',
    '',
    'Inspect the repository before changing code, keep the work scoped to this task, and verify the result.'
  ].join('\n')
};

export const SKILL_INSTALL_COMMAND =
  'npx skills add https://github.com/holooooo/markdown-kanban --skill markdown-kanban';

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function normalizeTerminalSettings(value: unknown): TerminalSettings {
  const input = isRecord(value) ? value : {};
  const binary = typeof input.binary === 'string' ? input.binary.trim() : '';
  const args = Array.isArray(input.args)
    ? input.args.filter((arg): arg is string => typeof arg === 'string').slice(0, 128)
    : [];
  const envInput = isRecord(input.env) ? input.env : {};
  const env: Record<string, string> = {};

  for (const [name, envValue] of Object.entries(envInput)) {
    if (!ENV_NAME_PATTERN.test(name) || typeof envValue !== 'string') {
      continue;
    }
    env[name] = envValue;
  }

  return {
    binary: binary || DEFAULT_TERMINAL_SETTINGS.binary,
    args,
    env,
    appendTaskPrompt: input.appendTaskPrompt !== false,
    promptTemplate: typeof input.promptTemplate === 'string' && input.promptTemplate.trim()
      ? input.promptTemplate
      : DEFAULT_TERMINAL_SETTINGS.promptTemplate
  };
}

export function renderTaskPrompt(
  template: string,
  task: KanbanTask,
  boardPath: string,
  workspacePath?: string
): string {
  const relativeFile = workspacePath
    ? path.relative(workspacePath, boardPath) || path.basename(boardPath)
    : path.basename(boardPath);
  const replacements: Record<string, string> = {
    title: task.title,
    description: task.description || 'None',
    tags: task.tags?.join(', ') || 'None',
    dueDate: task.dueDate || 'None',
    file: boardPath,
    relativeFile
  };

  return template.replace(/\{(title|description|tags|dueDate|file|relativeFile)\}/g, (_, key: string) => replacements[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
