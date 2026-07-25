import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { MarkdownKanbanParser } from '../markdownParser';
import { normalizeTerminalSettings, renderTaskPrompt } from '../terminalSettings';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('parses task properties and steps with prettier-style indentation', () => {
		const board = MarkdownKanbanParser.parseMarkdown([
			'# Board',
			'',
			'## Todo',
			'',
			'### Ship it',
			'',
			'  - priority: high',
			'  - due: 2026-08-01',
			'  - steps:',
			'    - [ ] Build',
			'    - [x] Test',
			''
		].join('\n'));

		const task = board.columns[0].tasks[0];
		assert.strictEqual(task.priority, 'high');
		assert.strictEqual(task.dueDate, '2026-08-01');
		assert.deepStrictEqual(task.steps, [
			{ text: 'Build', completed: false },
			{ text: 'Test', completed: true }
		]);
	});

	test('round-trips properties and steps without losing them', () => {
		const source = [
			'## Todo',
			'',
			'### Task',
			'',
			' - priority: medium',
			' - due: 2026-08-02',
			' - steps:',
			'   - [ ] First',
			'   - [x] Second',
			''
		].join('\n');
		const board = MarkdownKanbanParser.parseMarkdown(source);
		const output = MarkdownKanbanParser.generateMarkdown(board);
		const reparsed = MarkdownKanbanParser.parseMarkdown(output);
		const task = reparsed.columns[0].tasks[0];

		assert.strictEqual(task.priority, 'medium');
		assert.strictEqual(task.dueDate, '2026-08-02');
		assert.deepStrictEqual(task.steps?.map(step => step.text), ['First', 'Second']);
		assert.deepStrictEqual(task.steps?.map(step => step.completed), [false, true]);
	});

	test('normalizes terminal settings without accepting invalid environment names', () => {
		const settings = normalizeTerminalSettings({
			binary: ' claude ',
			args: ['--model', 'sonnet'],
			env: { API_KEY: 'secret', 'BAD-NAME': 'ignored', EMPTY: '' },
			appendTaskPrompt: false,
			promptTemplate: 'Task: {title}'
		});

		assert.strictEqual(settings.binary, 'claude');
		assert.deepStrictEqual(settings.args, ['--model', 'sonnet']);
		assert.deepStrictEqual(settings.env, { API_KEY: 'secret', EMPTY: '' });
		assert.strictEqual(settings.appendTaskPrompt, false);
	});

	test('renders task prompts with board-relative context', () => {
		const prompt = renderTaskPrompt(
			'{title}|{description}|{tags}|{dueDate}|{relativeFile}',
			{
				id: 'task-1',
				title: 'Ship export',
				description: 'Add JSON output',
				tags: ['cli', 'export'],
				dueDate: '2026-08-15'
			},
			'/workspace/.todo/cli.todo.md',
			'/workspace'
		);

		assert.strictEqual(prompt, 'Ship export|Add JSON output|cli, export|2026-08-15|.todo/cli.todo.md');
	});
});
