import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { KanbanBoard, KanbanColumn, KanbanTask, MarkdownKanbanParser } from './markdownParser';
import {
    DEFAULT_TERMINAL_SETTINGS,
    normalizeTerminalSettings,
    renderTaskPrompt,
    SKILL_INSTALL_COMMAND,
    TerminalSettings
} from './terminalSettings';

interface StoredTerminalSettings {
    binary: string;
    args: string[];
    appendTaskPrompt: boolean;
    promptTemplate: string;
}

export class KanbanWebviewPanel {
    public static currentPanel: KanbanWebviewPanel | undefined;
    public static readonly viewType = 'markdownKanbanPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private readonly _disposables: vscode.Disposable[] = [];
    private _board?: KanbanBoard;
    private _document?: vscode.TextDocument;
    private _webviewReady = false;
    private _isSaving = false;

    public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext, document?: vscode.TextDocument) {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (KanbanWebviewPanel.currentPanel) {
            KanbanWebviewPanel.currentPanel._panel.reveal(column);
            if (document) {
                KanbanWebviewPanel.currentPanel.loadMarkdownFile(document);
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            KanbanWebviewPanel.viewType,
            'Markdown Kanban',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'html')],
                retainContextWhenHidden: true
            }
        );

        KanbanWebviewPanel.currentPanel = new KanbanWebviewPanel(panel, extensionUri, context);
        if (document) {
            KanbanWebviewPanel.currentPanel.loadMarkdownFile(document);
        }
    }

    public static revive(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        context: vscode.ExtensionContext,
        document?: vscode.TextDocument
    ) {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'html')]
        };
        KanbanWebviewPanel.currentPanel = new KanbanWebviewPanel(panel, extensionUri, context);
        if (document) {
            KanbanWebviewPanel.currentPanel.loadMarkdownFile(document);
        }
    }

    public get isSaving(): boolean {
        return this._isSaving;
    }

    public isDocument(uri: vscode.Uri): boolean {
        return this._document?.uri.toString() === uri.toString();
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;
        this._updateHtml();
        this._setupEventListeners();
    }

    private _setupEventListeners() {
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.onDidChangeViewState(
            event => {
                if (event.webviewPanel.visible) {
                    this._postBoard();
                }
            },
            null,
            this._disposables
        );
        this._panel.webview.onDidReceiveMessage(
            async message => {
                if (message.type === 'ready') {
                    this._webviewReady = true;
                    this._postBoard();
                    return;
                }
                try {
                    await this._handleMessage(message);
                } catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Markdown Kanban action failed: ${detail}`);
                    this._postActionResult(`Action failed: ${detail}`, true);
                }
            },
            null,
            this._disposables
        );
    }

    private async _handleMessage(message: Record<string, any>) {
        switch (message.type) {
            case 'moveTask':
                await this.moveTask(message.taskId, message.fromColumnId, message.toColumnId, message.newIndex);
                break;
            case 'addTask':
                await this.addTask(message.columnId, message.taskData);
                break;
            case 'deleteTask':
                await this.deleteTask(message.taskId, message.columnId);
                break;
            case 'editTask':
                await this.editTask(message.taskId, message.columnId, message.taskData);
                break;
            case 'addColumn':
                await this.addColumn(message.title);
                break;
            case 'moveColumn':
                await this.moveColumn(message.fromIndex, message.toIndex);
                break;
            case 'updateTaskStep':
                await this.updateTaskStep(message.taskId, message.columnId, message.stepIndex, message.completed);
                break;
            case 'reorderTaskSteps':
                await this.reorderTaskSteps(message.taskId, message.columnId, message.newOrder);
                break;
            case 'toggleColumnArchive':
                await this.toggleColumnArchive(message.columnId, message.archived);
                break;
            case 'selectBoard':
                await this.selectBoard();
                break;
            case 'getTerminalSettings':
                await this.postTerminalSettings();
                break;
            case 'saveTerminalSettings':
                await this.saveTerminalSettings(message.settings);
                break;
            case 'startTask':
                await this.startTask(message.taskId, message.columnId);
                break;
            case 'copySkillInstallCommand':
                await vscode.env.clipboard.writeText(SKILL_INSTALL_COMMAND);
                this._postActionResult('Skill install command copied.');
                break;
        }
    }

    public loadMarkdownFile(document: vscode.TextDocument) {
        if (document.uri.scheme !== 'file') {
            vscode.window.showErrorMessage('Markdown Kanban can only launch tasks from local files.');
            return;
        }

        this._document = document;
        try {
            this._board = MarkdownKanbanParser.parseMarkdown(document.getText());
        } catch (error) {
            vscode.window.showErrorMessage(`Kanban parsing error: ${error instanceof Error ? error.message : String(error)}`);
            this._board = { title: 'Error Loading Board', columns: [] };
        }
        this._panel.title = `Markdown Kanban: ${path.basename(document.fileName)}`;
        this._postBoard();
    }

    public handleDocumentChange(document: vscode.TextDocument) {
        if (!this._isSaving && this.isDocument(document.uri)) {
            this.loadMarkdownFile(document);
        }
    }

    private _updateHtml() {
        this._webviewReady = false;
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _postBoard() {
        if (!this._webviewReady) return;

        const board = this._board || { title: 'Open a Markdown Kanban file', columns: [] };
        const workspaceFolder = this._document
            ? vscode.workspace.getWorkspaceFolder(this._document.uri)
            : undefined;
        const relativePath = this._document
            ? workspaceFolder
                ? path.relative(workspaceFolder.uri.fsPath, this._document.fileName)
                : path.basename(this._document.fileName)
            : '';

        void this._panel.webview.postMessage({
            type: 'updateBoard',
            board,
            documentName: this._document ? path.basename(this._document.fileName) : 'No board selected',
            documentPath: relativePath,
            documentUri: this._document?.uri.toString()
        });
    }

    private _postActionResult(message: string, isError = false) {
        void this._panel.webview.postMessage({ type: 'actionResult', message, isError });
    }

    private async saveToMarkdown() {
        if (!this._document || !this._board) return;

        const config = vscode.workspace.getConfiguration('markdown-kanban');
        const taskHeaderFormat = config.get<'title' | 'list'>('taskHeader', 'title');
        const markdown = MarkdownKanbanParser.generateMarkdown(this._board, taskHeaderFormat);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(this._document.uri, new vscode.Range(0, 0, this._document.lineCount, 0), markdown);

        this._isSaving = true;
        try {
            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                throw new Error('VS Code rejected the document edit.');
            }
            await this._document.save();
        } finally {
            this._isSaving = false;
        }
    }

    private findColumn(columnId: string): KanbanColumn | undefined {
        return this._board?.columns.find(column => column.id === columnId);
    }

    private findTask(columnId: string, taskId: string) {
        const column = this.findColumn(columnId);
        if (!column) return undefined;
        const index = column.tasks.findIndex(task => task.id === taskId);
        return index === -1 ? undefined : { column, task: column.tasks[index], index };
    }

    private async performAction(action: () => void) {
        if (!this._board) return;
        const previousBoard = JSON.parse(JSON.stringify(this._board)) as KanbanBoard;
        action();
        try {
            await this.saveToMarkdown();
        } catch (error) {
            this._board = previousBoard;
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to save Kanban: ${message}`);
            this._postActionResult(`Save failed: ${message}`, true);
        }
        this._postBoard();
    }

    private async moveTask(taskId: string, fromColumnId: string, toColumnId: string, newIndex: number) {
        await this.performAction(() => {
            const fromColumn = this.findColumn(fromColumnId);
            const toColumn = this.findColumn(toColumnId);
            if (!fromColumn || !toColumn) return;
            const taskIndex = fromColumn.tasks.findIndex(task => task.id === taskId);
            if (taskIndex === -1) return;
            const task = fromColumn.tasks.splice(taskIndex, 1)[0];
            const targetIndex = Math.max(0, Math.min(Number.isFinite(newIndex) ? newIndex : toColumn.tasks.length, toColumn.tasks.length));
            toColumn.tasks.splice(targetIndex, 0, task);
        });
    }

    private async addTask(columnId: string, taskData: Partial<KanbanTask>) {
        await this.performAction(() => {
            const column = this.findColumn(columnId);
            if (!column || !taskData.title?.trim()) return;
            column.tasks.push({
                id: crypto.randomUUID(),
                title: taskData.title.trim(),
                description: taskData.description,
                tags: taskData.tags || [],
                priority: taskData.priority,
                workload: taskData.workload,
                dueDate: taskData.dueDate,
                defaultExpanded: taskData.defaultExpanded,
                steps: taskData.steps || []
            });
        });
    }

    private async deleteTask(taskId: string, columnId: string) {
        await this.performAction(() => {
            const result = this.findTask(columnId, taskId);
            if (result) result.column.tasks.splice(result.index, 1);
        });
    }

    private async editTask(taskId: string, columnId: string, taskData: Partial<KanbanTask>) {
        await this.performAction(() => {
            const result = this.findTask(columnId, taskId);
            if (!result || !taskData.title?.trim()) return;
            Object.assign(result.task, {
                title: taskData.title.trim(),
                description: taskData.description,
                tags: taskData.tags || [],
                priority: taskData.priority,
                workload: taskData.workload,
                dueDate: taskData.dueDate,
                defaultExpanded: taskData.defaultExpanded,
                steps: taskData.steps || []
            });
        });
    }

    private async updateTaskStep(taskId: string, columnId: string, stepIndex: number, completed: boolean) {
        await this.performAction(() => {
            const result = this.findTask(columnId, taskId);
            if (result?.task.steps && stepIndex >= 0 && stepIndex < result.task.steps.length) {
                result.task.steps[stepIndex].completed = completed;
            }
        });
    }

    private async reorderTaskSteps(taskId: string, columnId: string, newOrder: number[]) {
        await this.performAction(() => {
            const result = this.findTask(columnId, taskId);
            if (!result?.task.steps || !Array.isArray(newOrder)) return;
            const originalSteps = [...result.task.steps];
            result.task.steps = newOrder
                .filter(index => Number.isInteger(index) && index >= 0 && index < originalSteps.length)
                .map(index => originalSteps[index]);
        });
    }

    private async addColumn(title: string) {
        await this.performAction(() => {
            if (this._board && typeof title === 'string' && title.trim()) {
                this._board.columns.push({ id: crypto.randomUUID(), title: title.trim(), tasks: [] });
            }
        });
    }

    private async moveColumn(fromIndex: number, toIndex: number) {
        await this.performAction(() => {
            if (!this._board || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
            const column = this._board.columns.splice(fromIndex, 1)[0];
            if (column) this._board.columns.splice(Math.min(toIndex, this._board.columns.length), 0, column);
        });
    }

    private async toggleColumnArchive(columnId: string, archived: boolean) {
        await this.performAction(() => {
            const column = this.findColumn(columnId);
            if (column) column.archived = Boolean(archived);
        });
    }

    private async selectBoard() {
        const patterns = ['**/*.todo.md', '**/*.kanban.md', '**/TODO.md', '**/todo.md'];
        const matches = (await Promise.all(patterns.map(pattern => vscode.workspace.findFiles(pattern, '**/{node_modules,.git,dist,out}/**', 200))))
            .flat();
        const unique = new Map(matches.map(uri => [uri.toString(), uri]));
        if (this._document) unique.set(this._document.uri.toString(), this._document.uri);

        const items = [...unique.values()]
            .sort((a, b) => a.fsPath.localeCompare(b.fsPath))
            .map(uri => {
                const folder = vscode.workspace.getWorkspaceFolder(uri);
                return {
                    label: path.basename(uri.fsPath),
                    description: folder ? path.relative(folder.uri.fsPath, uri.fsPath) : uri.fsPath,
                    uri
                };
            });
        const browseItem = { label: 'Browse for another Markdown file...', description: '', uri: undefined };
        const selected = await vscode.window.showQuickPick([...items, browseItem], {
            placeHolder: 'Select a todo board in this project'
        });
        if (!selected) return;

        let target = selected.uri;
        if (!target) {
            const picked = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'Markdown files': ['md', 'markdown'] }
            });
            target = picked?.[0];
        }
        if (target) {
            const document = await vscode.workspace.openTextDocument(target);
            this.loadMarkdownFile(document);
        }
    }

    private async postTerminalSettings() {
        const settings = await this.getTerminalSettings();
        await this._panel.webview.postMessage({ type: 'terminalSettings', settings });
    }

    private async getTerminalSettings(): Promise<TerminalSettings> {
        const scope = this.getSettingsScope();
        const stored = this._context.workspaceState.get<StoredTerminalSettings>(`terminalSettings.${scope}`);
        const envJson = await this._context.secrets.get(`markdownKanban.terminalEnv.${scope}`);
        let env: Record<string, string> = {};
        if (envJson) {
            try {
                env = JSON.parse(envJson);
            } catch {
                env = {};
            }
        }
        return normalizeTerminalSettings({ ...(stored || DEFAULT_TERMINAL_SETTINGS), env });
    }

    private async saveTerminalSettings(value: unknown) {
        const settings = normalizeTerminalSettings(value);
        const scope = this.getSettingsScope();
        const stored: StoredTerminalSettings = {
            binary: settings.binary,
            args: settings.args,
            appendTaskPrompt: settings.appendTaskPrompt,
            promptTemplate: settings.promptTemplate
        };
        await this._context.workspaceState.update(`terminalSettings.${scope}`, stored);
        await this._context.secrets.store(`markdownKanban.terminalEnv.${scope}`, JSON.stringify(settings.env));
        this._postActionResult('Terminal settings saved for this workspace.');
        await this.postTerminalSettings();
    }

    private getSettingsScope(): string {
        const folder = this._document ? vscode.workspace.getWorkspaceFolder(this._document.uri) : undefined;
        const source = folder?.uri.toString() || this._document?.uri.toString() || 'global';
        return crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
    }

    private async startTask(taskId: string, columnId: string) {
        if (!vscode.workspace.isTrusted) {
            const choice = await vscode.window.showWarningMessage(
                'Trust this workspace before launching a task terminal.',
                'Manage Workspace Trust'
            );
            if (choice) await vscode.commands.executeCommand('workbench.trust.manage');
            return;
        }
        const result = this.findTask(columnId, taskId);
        if (!result || !this._document) {
            this._postActionResult('The task is no longer available.', true);
            return;
        }

        const settings = await this.getTerminalSettings();
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(this._document.uri);
        const cwd = workspaceFolder?.uri.fsPath || path.dirname(this._document.fileName);
        const args = [...settings.args];
        if (settings.appendTaskPrompt) {
            args.push(renderTaskPrompt(settings.promptTemplate, result.task, this._document.fileName, workspaceFolder?.uri.fsPath));
        }

        const terminal = vscode.window.createTerminal({
            name: `${path.basename(settings.binary)}: ${result.task.title.slice(0, 48)}`,
            shellPath: settings.binary,
            shellArgs: args,
            cwd,
            env: settings.env,
            location: { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
            isTransient: true
        });
        terminal.show(false);
    }

    private _getHtmlForWebview() {
        const filePath = vscode.Uri.joinPath(this._extensionUri, 'src', 'html', 'webview.html');
        let html = fs.readFileSync(filePath.fsPath, 'utf8');
        const baseWebviewUri = this._panel.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'src', 'html'));
        const nonce = crypto.randomBytes(16).toString('base64');
        html = html.replace('<head>', `<head><base href="${baseWebviewUri.toString()}/">`);
        html = html.replaceAll('{{cspSource}}', this._panel.webview.cspSource).replaceAll('{{nonce}}', nonce);
        return html;
    }

    public dispose() {
        KanbanWebviewPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) this._disposables.pop()?.dispose();
    }
}
