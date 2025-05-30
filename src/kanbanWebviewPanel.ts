import * as vscode from 'vscode';
import { MarkdownKanbanParser, KanbanBoard, KanbanTask, KanbanColumn } from './markdownParser';

export class KanbanWebviewPanel {
    public static currentPanel: KanbanWebviewPanel | undefined;
    public static readonly viewType = 'markdownKanbanPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _board?: KanbanBoard;
    private _document?: vscode.TextDocument;

    public static createOrShow(extensionUri: vscode.Uri, document?: vscode.TextDocument) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If panel already exists, show it
        if (KanbanWebviewPanel.currentPanel) {
            KanbanWebviewPanel.currentPanel._panel.reveal(column);
            if (document) {
                KanbanWebviewPanel.currentPanel.loadMarkdownFile(document);
            }
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            KanbanWebviewPanel.viewType,
            'Markdown Kanban',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        KanbanWebviewPanel.currentPanel = new KanbanWebviewPanel(panel, extensionUri);

        if (document) {
            KanbanWebviewPanel.currentPanel.loadMarkdownFile(document);
        }
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [extensionUri],
        };
        KanbanWebviewPanel.currentPanel = new KanbanWebviewPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set webview HTML content
        this._update();

        // Listen for panel closure
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Listen for panel visibility changes
        this._panel.onDidChangeViewState(
            e => {
                if (e.webviewPanel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'moveTask':
                        this.moveTask(message.taskId, message.fromColumnId, message.toColumnId, message.newIndex);
                        break;
                    case 'addTask':
                        this.addTask(message.columnId, message.taskData);
                        break;
                    case 'deleteTask':
                        this.deleteTask(message.taskId, message.columnId);
                        break;
                    case 'editTask':
                        this.editTask(message.taskId, message.columnId, message.taskData);
                        break;
                    case 'addColumn':
                        this.addColumn(message.title);
                        break;
                    case 'moveColumn':
                        this.moveColumn(message.fromIndex, message.toIndex);
                        break;
                    case 'toggleTask':
                        this.toggleTaskExpansion(message.taskId);
                        break;
                }
            },
            null,
            this._disposables
        );

        if (this._document) {
            this.loadMarkdownFile(this._document);
        } else {
            this._panel.webview.html = this._getHtmlForWebview();
        }
    }

    public loadMarkdownFile(document: vscode.TextDocument) {
        this._document = document;
        try {
            this._board = MarkdownKanbanParser.parseMarkdown(document.getText());
        } catch (error) {
            console.error('Error parsing Markdown:', error);
            vscode.window.showErrorMessage(`Kanban parsing error: ${error instanceof Error ? error.message : String(error)}`);
            this._board = { title: 'Error Loading Board', columns: [] };
        }
        this._update();
    }

    private _update() {
        if (this._panel.webview) {
            this._panel.webview.html = this._getHtmlForWebview();
            if (this._board) {
                this._panel.webview.postMessage({
                    type: 'updateBoard',
                    board: this._board
                });
            } else {
                this._panel.webview.postMessage({
                    type: 'updateBoard',
                    board: { title: 'Please open a Markdown Kanban file', columns: [] }
                });
            }
        }
    }

    private async saveToMarkdown() {
        if (this._document && this._board) {
            const markdown = MarkdownKanbanParser.generateMarkdown(this._board);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                this._document.uri,
                new vscode.Range(0, 0, this._document.lineCount, 0),
                markdown
            );
            await vscode.workspace.applyEdit(edit);
        }
    }

    private moveTask(taskId: string, fromColumnId: string, toColumnId: string, newIndex: number) {
        if (!this._board) {
            return;
        }

        const fromColumn = this._board.columns.find(col => col.id === fromColumnId);
        const toColumn = this._board.columns.find(col => col.id === toColumnId);

        if (!fromColumn || !toColumn) {
            return;
        }

        const taskIndex = fromColumn.tasks.findIndex(task => task.id === taskId);
        if (taskIndex === -1) {
            return;
        }

        const task = fromColumn.tasks.splice(taskIndex, 1)[0];
        toColumn.tasks.splice(newIndex, 0, task);

        this.saveToMarkdown();
        this._update();
    }

    private addTask(columnId: string, taskData: any) {
        if (!this._board) {
            return;
        }

        const column = this._board.columns.find(col => col.id === columnId);
        if (!column) {
            return;
        }

        const newTask: KanbanTask = {
            id: Math.random().toString(36).substr(2, 9),
            title: taskData.title,
            description: taskData.description,
            tags: taskData.tags || [],
            priority: taskData.priority,
            dueDate: taskData.dueDate
        };

        column.tasks.push(newTask);
        this.saveToMarkdown();
        this._update();
    }

    private deleteTask(taskId: string, columnId: string) {
        if (!this._board) {
            return;
        }

        const column = this._board.columns.find(col => col.id === columnId);
        if (!column) {
            return;
        }

        const taskIndex = column.tasks.findIndex(task => task.id === taskId);
        if (taskIndex === -1) {
            return;
        }

        column.tasks.splice(taskIndex, 1);
        this.saveToMarkdown();
        this._update();
    }

    private editTask(taskId: string, columnId: string, taskData: any) {
        if (!this._board) {
            return;
        }

        const column = this._board.columns.find(col => col.id === columnId);
        if (!column) {
            return;
        }

        const task = column.tasks.find(task => task.id === taskId);
        if (!task) {
            return;
        }

        task.title = taskData.title;
        task.description = taskData.description;
        task.tags = taskData.tags || [];
        task.priority = taskData.priority;
        task.dueDate = taskData.dueDate;

        this.saveToMarkdown();
        this._update();
    }

    private addColumn(title: string) {
        if (!this._board) {
            return;
        }

        const newColumn: KanbanColumn = {
            id: Math.random().toString(36).substr(2, 9),
            title: title,
            tasks: []
        };

        this._board.columns.push(newColumn);
        this.saveToMarkdown();
        this._update();
    }

    private moveColumn(fromIndex: number, toIndex: number) {
        if (!this._board || fromIndex === toIndex) {
            return;
        }

        const columns = this._board.columns;
        const column = columns.splice(fromIndex, 1)[0];
        columns.splice(toIndex, 0, column);

        this.saveToMarkdown();
        this._update();
    }

    private toggleTaskExpansion(taskId: string) {
        // This method toggles task expand/collapse state
        // Handled on frontend, no need to save to markdown
        this._panel.webview.postMessage({
            type: 'toggleTaskExpansion',
            taskId: taskId
        });
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Kanban</title>
    <style>
        * {
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            overflow-x: auto;
        }

        .kanban-header {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            padding: 16px;
            background-color: var(--vscode-sideBar-background);
            border-radius: 8px;
            border: 1px solid var(--vscode-panel-border);
            flex-wrap: wrap;
            align-items: center;
        }

        .filter-section {
            display: flex;
            gap: 12px;
            align-items: center;
            flex-wrap: wrap;
        }

        .filter-label {
            font-weight: 500;
            font-size: 14px;
        }

        .filter-input, .sort-select {
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 12px;
            min-width: 120px;
        }

        .filter-input:focus, .sort-select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .clear-filters-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
        }

        .column-controls {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .toggle-columns-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
        }

        .kanban-board {
            display: flex;
            gap: 20px;
            min-height: calc(100vh - 150px);
            padding-bottom: 20px;
        }

        .kanban-column {
            background-color: var(--vscode-sideBar-background);
            border-radius: 8px;
            padding: 16px;
            min-width: 300px;
            max-width: 350px;
            flex-shrink: 0;
            border: 1px solid var(--vscode-panel-border);
            position: relative;
        }

        .kanban-column.hidden {
            display: none;
        }

        .kanban-column.dragging {
            opacity: 0.5;
        }

        .column-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 2px solid var(--vscode-panel-border);
            cursor: move;
        }

        .column-title {
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .column-controls-menu {
            display: flex;
            gap: 4px;
            align-items: center;
        }

        .task-count {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 12px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 500;
        }

        .column-menu-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px;
            border-radius: 3px;
            font-size: 14px;
        }

        .column-menu-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .tasks-container {
            min-height: 100px;
            max-height: calc(100vh - 280px);
            overflow-y: auto;
        }

        .task-item {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
        }

        .task-item:hover {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .task-item.expanded {
            border-color: var(--vscode-focusBorder);
        }

        .task-item.filtered-out {
            display: none;
        }

        .task-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
            margin-bottom: 8px;
        }

        .task-title {
            font-size: 14px;
            font-weight: 500;
            color: var(--vscode-foreground);
            flex: 1;
            line-height: 1.4;
            word-break: break-word;
        }

        .task-meta {
            display: flex;
            flex-direction: column;
            gap: 4px;
            align-items: flex-end;
            flex-shrink: 0;
        }

        .task-priority {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
        }

        .priority-high { background-color: #ff4444; }
        .priority-medium { background-color: #ffaa00; }
        .priority-low { background-color: #44ff44; }

        .task-deadline {
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: 500;
        }

        .deadline-overdue {
            background-color: #ff4444;
            color: white;
        }

        .deadline-urgent {
            background-color: #ffaa00;
            color: white;
        }

        .deadline-upcoming {
            background-color: #44ff44;
            color: white;
        }

        .deadline-normal {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .task-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 4px;
        }

        .task-tags-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 8px;
            gap: 8px;
        }

        .task-tags-row .task-tags {
            margin-top: 0;
            flex: 1;
        }

        .task-tag {
            background-color: #e3f2fd;
            color: #1976d2;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
        }

        .task-details {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--vscode-panel-border);
            display: none;
        }

        .task-item.expanded .task-details {
            display: block;
        }

        .task-description {
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
            line-height: 1.4;
            margin-bottom: 8px;
            white-space: pre-wrap;
        }

        .task-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            font-size: 12px;
        }

        .task-info-item {
            display: flex;
            align-items: center;
            gap: 4px;
            color: var(--vscode-descriptionForeground);
        }

        .task-info-label {
            font-weight: 500;
        }

        .task-actions {
            position: absolute;
            top: 8px;
            right: 8px;
            display: none;
            gap: 4px;
        }

        .task-item:hover .task-actions {
            display: flex;
        }

        .action-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            padding: 4px 6px;
            font-size: 11px;
            cursor: pointer;
            transition: background-color 0.2s;
        }

        .action-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .action-btn.delete {
            background: var(--vscode-errorForeground);
            color: white;
        }

        .add-task-btn {
            width: 100%;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px dashed var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s ease;
            margin-top: 8px;
        }

        .add-task-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
            border-color: var(--vscode-focusBorder);
        }

        .add-column-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            padding: 16px;
            min-width: 200px;
            font-size: 14px;
            cursor: pointer;
            transition: background-color 0.2s;
            align-self: flex-start;
        }

        .add-column-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        /* Modal styles */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }

        .modal-content {
            background-color: var(--vscode-editor-background);
            margin: 5% auto;
            padding: 20px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            width: 90%;
            max-width: 500px;
            max-height: 80vh;
            overflow-y: auto;
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .modal-body {
            margin-bottom: 20px;
            color: var(--vscode-foreground);
        }

        .modal-title {
            font-size: 18px;
            font-weight: 600;
        }

        .close-btn {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: var(--vscode-foreground);
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .form-group {
            margin-bottom: 16px;
        }

        .form-label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }

        .form-input, .form-textarea, .form-select {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: 14px;
        }

        .form-textarea {
            resize: vertical;
            min-height: 80px;
        }

        .form-input:focus, .form-textarea:focus, .form-select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .tags-input-container {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            padding: 4px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            min-height: 36px;
            align-items: center;
        }

        .tag-item {
            background-color: #e3f2fd;
            color: #1976d2;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .tag-remove {
            background: none;
            border: none;
            color: inherit;
            cursor: pointer;
            padding: 0;
            font-size: 14px;
            line-height: 1;
        }

        .tags-input {
            border: none;
            background: none;
            outline: none;
            color: var(--vscode-input-foreground);
            flex: 1;
            min-width: 100px;
            padding: 4px;
        }

        .modal-actions {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
            transition: background-color 0.2s;
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        /* Drag styles */
        .task-item.dragging {
            opacity: 0.5;
        }

        .kanban-column.drag-over {
            background-color: var(--vscode-list-hoverBackground);
        }

        /* Column drag styles */
        .kanban-column.column-dragging {
            opacity: 0.6;
            transform: scale(0.95);
        }

        /* Responsive design */
        @media (max-width: 768px) {
            .kanban-header {
                flex-direction: column;
                align-items: stretch;
            }

            .filter-section {
                justify-content: space-between;
            }

            .kanban-board {
                flex-direction: column;
                gap: 16px;
            }

            .kanban-column {
                min-width: auto;
                max-width: none;
            }
        }
    </style>
</head>
<body>
    <!-- Top control panel -->
    <div class="kanban-header">
        <div class="filter-section">
            <span class="filter-label">Filter:</span>
            <input type="text" id="tag-filter" class="filter-input" placeholder="Filter by tags (e.g., design,ui)">

            <span class="filter-label">Sort:</span>
            <select id="sort-select" class="sort-select">
                <option value="none">Default Sort</option>
                <option value="title">Sort by Name</option>
                <option value="deadline">Sort by Due Date</option>
                <option value="priority">Sort by Priority</option>
                <option value="tags">Sort by Tags</option>
            </select>

            <button id="clear-filters" class="clear-filters-btn">Clear Filters</button>
        </div>
    </div>

    <div id="kanban-container">
        <div class="kanban-board" id="kanban-board">
            <!-- Kanban content will be dynamically generated by JavaScript -->
        </div>
    </div>

    <!-- Task edit modal -->
    <div id="task-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title" id="modal-title">Add Task</h3>
                <button class="close-btn" onclick="closeTaskModal()">&times;</button>
            </div>
            <form id="task-form">
                <div class="form-group">
                    <label class="form-label" for="task-title">Task Title *</label>
                    <input type="text" id="task-title" class="form-input" required>
                </div>

                <div class="form-group">
                    <label class="form-label" for="task-description">Task Description</label>
                    <textarea id="task-description" class="form-textarea" placeholder="Describe the task details..."></textarea>
                </div>

                <div class="form-group">
                    <label class="form-label" for="task-priority">Priority</label>
                    <select id="task-priority" class="form-select">
                        <option value="">None</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                    </select>
                </div>

                <div class="form-group">
                    <label class="form-label" for="task-due-date">Due Date</label>
                    <input type="date" id="task-due-date" class="form-input">
                </div>

                <div class="form-group">
                    <label class="form-label">Tags</label>
                    <div class="tags-input-container" id="tags-container">
                        <input type="text" class="tags-input" id="tags-input" placeholder="Enter tag and press Enter to add">
                    </div>
                </div>

                <div class="modal-actions">
                    <button type="button" class="btn btn-secondary" onclick="closeTaskModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Confirmation modal -->
    <div id="confirm-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title">Confirm Action</h3>
            </div>
            <div class="modal-body">
                <p id="confirm-message">Are you sure you want to delete this task?</p>
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="closeConfirmModal()">Cancel</button>
                <button type="button" class="btn btn-primary" id="confirm-ok-btn">OK</button>
            </div>
        </div>
    </div>

    <!-- Input modal -->
    <div id="input-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title" id="input-modal-title">Enter Value</h3>
                <button class="close-btn" onclick="closeInputModal()">&times;</button>
            </div>
            <div class="modal-body">
                <p id="input-modal-message">Please enter a value:</p>
                <input type="text" id="input-modal-field" class="form-input" placeholder="Enter value..." />
            </div>
            <div class="modal-actions">
                <button type="button" class="btn btn-secondary" onclick="closeInputModal()">Cancel</button>
                <button type="button" class="btn btn-primary" id="input-ok-btn">OK</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentBoard = null;
        let expandedTasks = new Set();
        let currentEditingTask = null;
        let currentEditingColumn = null;
        let isEditMode = false;
        let currentTagFilter = '';
        let currentSort = 'none';

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'updateBoard':
                    currentBoard = message.board;
                    renderBoard();
                    break;
                case 'toggleTaskExpansion':
                    toggleTaskExpansion(message.taskId);
                    break;
            }
        });

        // Calculate deadline remaining time
        function getDeadlineInfo(dueDate) {
            if (!dueDate) return null;

            const today = new Date();
            const deadline = new Date(dueDate);
            const diffTime = deadline - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };

            let status, text;
            if (diffDays < 0) {
                status = 'overdue';
                text = \`Overdue \${Math.abs(diffDays)} days\`;
            } else if (diffDays === 0) {
                status = 'urgent';
                text = 'Due today';
            } else if (diffDays === 1) {
                status = 'urgent';
                text = 'Due tomorrow';
            } else if (diffDays <= 3) {
                status = 'upcoming';
                text = \`\${diffDays} days left\`;
            } else {
                status = 'normal';
                text = \`\${diffDays} days left\`;
            }

            return { status, text, days: diffDays };
        }

        // Render Kanban board based on filter conditions and sorting settings
        function renderBoard() {
            if (!currentBoard) return;

            const boardElement = document.getElementById('kanban-board');
            boardElement.innerHTML = '';

            // Sort columns if needed
            let columns = [...currentBoard.columns];

            columns.forEach(column => {
                const columnElement = createColumnElement(column);
                boardElement.appendChild(columnElement);
            });

            // Add new column button
            const addColumnBtn = document.createElement('button');
            addColumnBtn.className = 'add-column-btn';
            addColumnBtn.textContent = '+ Add Column';
            addColumnBtn.onclick = () => addColumn();
            boardElement.appendChild(addColumnBtn);

            // Setup column drag and drop
            setupColumnDragAndDrop();
        }

        function createColumnElement(column) {
            const columnDiv = document.createElement('div');
            columnDiv.className = 'kanban-column';
            columnDiv.setAttribute('data-column-id', column.id);

            // Filter and sort tasks
            let filteredTasks = filterTasks(column.tasks);
            let sortedTasks = sortTasks(filteredTasks);

            columnDiv.innerHTML = \`
                <div class="column-header" draggable="true">
                    <div>
                        <h3 class="column-title">\${column.title}</h3>
                    </div>
                    <div class="column-controls-menu">
                        <span class="task-count">\${sortedTasks.length}</span>
                    </div>
                </div>
                <div class="tasks-container" id="tasks-\${column.id}">
                    \${sortedTasks.map(task => createTaskElement(task, column.id)).join('')}
                </div>
                <button class="add-task-btn" onclick="openTaskModal('\${column.id}')">
                    + Add Task
                </button>
            \`;

            // Add task drag and drop events
            setupTaskDragAndDrop(columnDiv, column.id);

            return columnDiv;
        }

        function createTaskElement(task, columnId) {
            const isExpanded = expandedTasks.has(task.id);
            const priorityClass = task.priority ? \`priority-\${task.priority}\` : '';
            const deadlineInfo = getDeadlineInfo(task.dueDate);

            return \`
                <div class="task-item \${isExpanded ? 'expanded' : ''}"
                     data-task-id="\${task.id}"
                     data-column-id="\${columnId}"
                     draggable="true"
                     onclick="toggleTaskExpansion('\${task.id}')">
                    <div class="task-header">
                        <div class="task-title">\${task.title}</div>
                        <div class="task-meta">
                            \${task.priority ? \`<div class="task-priority \${priorityClass}" title="Priority: \${getPriorityText(task.priority)}"></div>\` : ''}
                        </div>
                    </div>

                    \${task.tags && task.tags.length > 0 || deadlineInfo ? \`
                        <div class="task-tags-row">
                            \${task.tags && task.tags.length > 0 ? \`
                                <div class="task-tags">
                                    \${task.tags.map(tag => \`<span class="task-tag">\${tag}</span>\`).join('')}
                                </div>
                            \` : ''}
                            \${deadlineInfo ? \`<div class="task-deadline deadline-\${deadlineInfo.status}" title="Due date: \${task.dueDate}">\${deadlineInfo.text}</div>\` : ''}
                        </div>
                    \` : ''}

                    <div class="task-details">
                        \${task.description ? \`<div class="task-description">\${task.description}</div>\` : ''}
                        <div class="task-info">
                            \${task.dueDate ? \`
                                <div class="task-info-item">
                                    <span class="task-info-label">Due:</span>
                                    <span>\${task.dueDate}</span>
                                </div>
                            \` : ''}
                        </div>
                    </div>

                    <div class="task-actions">
                        <button class="action-btn" onclick="event.stopPropagation(); editTask('\${task.id}', '\${columnId}')">Edit</button>
                        <button class="action-btn delete" onclick="event.stopPropagation(); deleteTask('\${task.id}', '\${columnId}')">Delete</button>
                    </div>
                </div>
            \`;
        }

        // Filter tasks
        function filterTasks(tasks) {
            if (!currentTagFilter) return tasks;

            const filterTags = currentTagFilter.toLowerCase().split(',').map(tag => tag.trim()).filter(tag => tag);
            if (filterTags.length === 0) return tasks;

            return tasks.filter(task => {
                if (!task.tags || task.tags.length === 0) return false;
                return filterTags.some(filterTag =>
                    task.tags.some(taskTag => taskTag.toLowerCase().includes(filterTag))
                );
            });
        }

        // Sort tasks
        function sortTasks(tasks) {
            const sorted = [...tasks];

            switch (currentSort) {
                case 'title':
                    return sorted.sort((a, b) => a.title.localeCompare(b.title));
                case 'deadline':
                    return sorted.sort((a, b) => {
                        if (!a.dueDate && !b.dueDate) return 0;
                        if (!a.dueDate) return 1;
                        if (!b.dueDate) return -1;
                        return new Date(a.dueDate) - new Date(b.dueDate);
                    });
                case 'priority':
                    return sorted.sort((a, b) => {
                        const aPriority = priorityOrder[a.priority] || 0;
                        const bPriority = priorityOrder[b.priority] || 0;
                        return bPriority - aPriority;
                    });
                case 'tags':
                    return sorted.sort((a, b) => {
                        const aTag = (a.tags && a.tags[0]) ? a.tags[0] : '';
                        const bTag = (b.tags && b.tags[0]) ? b.tags[0] : '';
                        return aTag.localeCompare(bTag);
                    });
                default:
                    return sorted;
            }
        }

        function getPriorityText(priority) {
            const priorityMap = {
                'high': 'High',
                'medium': 'Medium',
                'low': 'Low'
            };
            return priorityMap[priority] || '';
        }

        function toggleTaskExpansion(taskId) {
            if (expandedTasks.has(taskId)) {
                expandedTasks.delete(taskId);
            } else {
                expandedTasks.add(taskId);
            }

            const taskElement = document.querySelector(\`[data-task-id="\${taskId}"]\`);
            if (taskElement) {
                taskElement.classList.toggle('expanded');
            }
        }

        // Setup task drag and drop
        function setupTaskDragAndDrop(columnElement, columnId) {
            const tasksContainer = columnElement.querySelector('.tasks-container');

            tasksContainer.addEventListener('dragover', (e) => {
                e.preventDefault();
                columnElement.classList.add('drag-over');
            });

            tasksContainer.addEventListener('dragleave', (e) => {
                if (!columnElement.contains(e.relatedTarget)) {
                    columnElement.classList.remove('drag-over');
                }
            });

            tasksContainer.addEventListener('drop', (e) => {
                e.preventDefault();
                columnElement.classList.remove('drag-over');

                const taskId = e.dataTransfer.getData('text/plain');
                const fromColumnId = e.dataTransfer.getData('application/column-id');

                if (taskId && fromColumnId) {
                    // Calculate the correct drop index based on mouse position
                    const tasks = Array.from(tasksContainer.children);
                    let dropIndex = tasks.length;

                    // Find the task element that should be after the dropped task
                    for (let i = 0; i < tasks.length; i++) {
                        const taskElement = tasks[i];
                        const rect = taskElement.getBoundingClientRect();
                        const taskCenter = rect.top + rect.height / 2;

                        if (e.clientY < taskCenter) {
                            dropIndex = i;
                            break;
                        }
                    }

                    // If dragging within the same column, adjust the index
                    if (fromColumnId === columnId) {
                        const draggedTaskElement = tasksContainer.querySelector('[data-task-id="' + taskId + '"]');
                        if (draggedTaskElement) {
                            const currentIndex = Array.from(tasks).indexOf(draggedTaskElement);
                            // If dropping after the current position, decrease the index by 1
                            if (dropIndex > currentIndex) {
                                dropIndex--;
                            }
                        }
                    }

                    vscode.postMessage({
                        type: 'moveTask',
                        taskId: taskId,
                        fromColumnId: fromColumnId,
                        toColumnId: columnId,
                        newIndex: dropIndex
                    });
                }
            });

            // Add drag events for tasks
            tasksContainer.addEventListener('dragstart', (e) => {
                if (e.target.classList.contains('task-item')) {
                    e.stopPropagation(); // 防止触发列拖拽
                    e.dataTransfer.setData('text/plain', e.target.dataset.taskId);
                    e.dataTransfer.setData('application/column-id', e.target.dataset.columnId);
                    e.target.classList.add('dragging');
                }
            });

            tasksContainer.addEventListener('dragend', (e) => {
                if (e.target.classList.contains('task-item')) {
                    e.target.classList.remove('dragging');
                }
            });
        }

        // Setup column drag and drop
        function setupColumnDragAndDrop() {
            const boardElement = document.getElementById('kanban-board');
            const columns = boardElement.querySelectorAll('.kanban-column');
            let draggedColumnIndex = -1;

            columns.forEach((column, index) => {
                const columnHeader = column.querySelector('.column-header');

                // Column drag start - listen on header
                columnHeader.addEventListener('dragstart', (e) => {
                    draggedColumnIndex = index;
                    e.dataTransfer.setData('text/plain', index.toString());
                    e.dataTransfer.effectAllowed = 'move';
                    column.classList.add('column-dragging');
                });

                // Column drag end - listen on header
                columnHeader.addEventListener('dragend', (e) => {
                    column.classList.remove('column-dragging');
                    draggedColumnIndex = -1;
                    // Remove drag-over class from all columns
                    columns.forEach(col => col.classList.remove('drag-over'));
                });

                // Column drag over - listen on column for drop zone
                column.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (draggedColumnIndex !== -1 && draggedColumnIndex !== index) {
                        column.classList.add('drag-over');
                    }
                });

                // Column drag leave
                column.addEventListener('dragleave', (e) => {
                    if (!column.contains(e.relatedTarget)) {
                        column.classList.remove('drag-over');
                    }
                });

                // Column drop - listen on column
                column.addEventListener('drop', (e) => {
                    e.preventDefault();
                    column.classList.remove('drag-over');

                    const fromIndex = draggedColumnIndex;
                    const toIndex = index;

                    if (fromIndex !== -1 && fromIndex !== toIndex) {
                        vscode.postMessage({
                            type: 'moveColumn',
                            fromIndex: fromIndex,
                            toIndex: toIndex
                        });
                    }
                });
            });
        }

        function openTaskModal(columnId, taskId = null) {
            currentEditingColumn = columnId;
            currentEditingTask = taskId;
            isEditMode = !!taskId;

            const modal = document.getElementById('task-modal');
            const modalTitle = document.getElementById('modal-title');
            const form = document.getElementById('task-form');

            modalTitle.textContent = isEditMode ? 'Edit Task' : 'Add Task';

            if (isEditMode && currentBoard) {
                const column = currentBoard.columns.find(col => col.id === columnId);
                const task = column?.tasks.find(t => t.id === taskId);

                if (task) {
                    document.getElementById('task-title').value = task.title || '';
                    document.getElementById('task-description').value = task.description || '';
                    document.getElementById('task-priority').value = task.priority || '';
                    document.getElementById('task-due-date').value = task.dueDate || '';

                    // Set tags
                    const tagsContainer = document.getElementById('tags-container');
                    const tagsInput = document.getElementById('tags-input');

                    // Clear existing tags
                    tagsContainer.querySelectorAll('.tag-item').forEach(tag => tag.remove());

                    // Add existing tags
                    if (task.tags) {
                        task.tags.forEach(tag => addTagToContainer(tag));
                    }
                }
            } else {
                form.reset();
                // Clear tags
                const tagsContainer = document.getElementById('tags-container');
                tagsContainer.querySelectorAll('.tag-item').forEach(tag => tag.remove());
            }

            modal.style.display = 'block';
            document.getElementById('task-title').focus();
        }

        function closeTaskModal() {
            document.getElementById('task-modal').style.display = 'none';
            currentEditingTask = null;
            currentEditingColumn = null;
            isEditMode = false;
        }

        function editTask(taskId, columnId) {
            openTaskModal(columnId, taskId);
        }

        function deleteTask(taskId, columnId) {
            showConfirmModal('Are you sure you want to delete this task?', () => {
                vscode.postMessage({
                    type: 'deleteTask',
                    taskId: taskId,
                    columnId: columnId
                });
            });
        }

        function showConfirmModal(message, onConfirm) {
            document.getElementById('confirm-message').textContent = message;
            document.getElementById('confirm-modal').style.display = 'block';

            const confirmBtn = document.getElementById('confirm-ok-btn');
            confirmBtn.onclick = () => {
                closeConfirmModal();
                onConfirm();
            };
        }

        function closeConfirmModal() {
            document.getElementById('confirm-modal').style.display = 'none';
        }

        function showInputModal(title, message, placeholder, onConfirm) {
            document.getElementById('input-modal-title').textContent = title;
            document.getElementById('input-modal-message').textContent = message;
            const inputField = document.getElementById('input-modal-field');
            inputField.placeholder = placeholder;
            inputField.value = '';
            document.getElementById('input-modal').style.display = 'block';

            // Focus on input field
            setTimeout(() => inputField.focus(), 100);

            const confirmBtn = document.getElementById('input-ok-btn');
            confirmBtn.onclick = () => {
                const value = inputField.value.trim();
                if (value) {
                    closeInputModal();
                    onConfirm(value);
                }
            };

            // Handle Enter key
            inputField.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    const value = inputField.value.trim();
                    if (value) {
                        closeInputModal();
                        onConfirm(value);
                    }
                }
            };
        }

        function closeInputModal() {
            document.getElementById('input-modal').style.display = 'none';
        }

        function addColumn() {
            showInputModal(
                'Add Column',
                'Please enter column title:',
                'Enter column title...',
                (title) => {
                    vscode.postMessage({
                        type: 'addColumn',
                        title: title
                    });
                }
            );
        }

        // Tag input handling
        function setupTagsInput() {
            const tagsInput = document.getElementById('tags-input');

            tagsInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    const tag = tagsInput.value.trim();
                    if (tag) {
                        addTagToContainer(tag);
                        tagsInput.value = '';
                    }
                }
            });
        }

        function addTagToContainer(tagText) {
            const tagsContainer = document.getElementById('tags-container');
            const tagsInput = document.getElementById('tags-input');

            // Check if tag already exists
            const existingTags = Array.from(tagsContainer.querySelectorAll('.tag-item'))
                .map(tag => tag.textContent.replace('×', '').trim());

            if (existingTags.includes(tagText)) {
                return;
            }

            const tagElement = document.createElement('div');
            tagElement.className = 'tag-item';
            tagElement.innerHTML = \`
                \${tagText}
                <button type="button" class="tag-remove" onclick="removeTag(this)">×</button>
            \`;

            tagsContainer.insertBefore(tagElement, tagsInput);
        }

        function removeTag(button) {
            button.parentElement.remove();
        }

        function getFormTags() {
            const tagsContainer = document.getElementById('tags-container');
            return Array.from(tagsContainer.querySelectorAll('.tag-item'))
                .map(tag => tag.textContent.replace('×', '').trim());
        }

        // Filter and sort event listeners
        document.addEventListener('DOMContentLoaded', () => {
            setupTagsInput();

            // Tag filtering
            document.getElementById('tag-filter').addEventListener('input', (e) => {
                currentTagFilter = e.target.value;
                renderBoard();
            });

            // Sorting
            document.getElementById('sort-select').addEventListener('change', (e) => {
                currentSort = e.target.value;
                renderBoard();
            });

            // Clear filters
            document.getElementById('clear-filters').addEventListener('click', () => {
                document.getElementById('tag-filter').value = '';
                document.getElementById('sort-select').value = 'none';
                currentTagFilter = '';
                currentSort = 'none';
                renderBoard();
            });
        });

        // Form submission handling
        document.getElementById('task-form').addEventListener('submit', (e) => {
            e.preventDefault();

            const taskData = {
                title: document.getElementById('task-title').value.trim(),
                description: document.getElementById('task-description').value.trim(),
                priority: document.getElementById('task-priority').value || undefined,
                dueDate: document.getElementById('task-due-date').value || undefined,
                tags: getFormTags()
            };

            if (!taskData.title) {
                alert('Please enter a task title');
                return;
            }

            if (isEditMode) {
                vscode.postMessage({
                    type: 'editTask',
                    taskId: currentEditingTask,
                    columnId: currentEditingColumn,
                    taskData: taskData
                });
            } else {
                vscode.postMessage({
                    type: 'addTask',
                    columnId: currentEditingColumn,
                    taskData: taskData
                });
            }

            closeTaskModal();
        });

        // Close modal when clicking outside
        document.getElementById('task-modal').addEventListener('click', (e) => {
            if (e.target.id === 'task-modal') {
                closeTaskModal();
            }
        });

        // Close confirm modal when clicking outside
        document.getElementById('confirm-modal').addEventListener('click', (e) => {
            if (e.target.id === 'confirm-modal') {
                closeConfirmModal();
            }
        });

        // Close input modal when clicking outside
        document.getElementById('input-modal').addEventListener('click', (e) => {
            if (e.target.id === 'input-modal') {
                closeInputModal();
            }
        });
    </script>
</body>
</html>`;
    }

    public dispose() {
        KanbanWebviewPanel.currentPanel = undefined;

        // 清理资源
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}