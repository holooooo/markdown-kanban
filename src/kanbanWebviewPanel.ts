import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { MarkdownKanbanParser, KanbanBoard, KanbanTask, KanbanColumn } from './markdownParser';

export class KanbanWebviewPanel {
    public static currentPanel: KanbanWebviewPanel | undefined;
    public static readonly viewType = 'markdownKanbanPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];
    private _board?: KanbanBoard;
    private _document?: vscode.TextDocument;

    public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext, document?: vscode.TextDocument) {
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

        KanbanWebviewPanel.currentPanel = new KanbanWebviewPanel(panel, extensionUri, context);

        if (document) {
            KanbanWebviewPanel.currentPanel.loadMarkdownFile(document);
        }
        KanbanWebviewPanel.currentPanel._context = context;
    }

    public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [extensionUri],
        };
        KanbanWebviewPanel.currentPanel = new KanbanWebviewPanel(panel, extensionUri, context);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;

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

            // 保存文档到磁盘，消除未保存状态提示
            await this._document.save();
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
        // const filePath: vscode.Uri = vscode.Uri.file(path.join(this._context.extensionPath, 'src', 'html', 'file.html'));
        const filePath: vscode.Uri = vscode.Uri.file(path.join(this._context.extensionPath, 'src', 'html', 'webview.html'));
        
        let html = fs.readFileSync(filePath.fsPath, 'utf8');;

        const baseWebviewUri = this._panel.webview.asWebviewUri(vscode.Uri.file(path.join(this._context.extensionPath, 'src', 'html')));

        html = html.replace(/<head>/, `<head><base href="${baseWebviewUri.toString()}/">`);

        return html;
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