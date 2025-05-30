// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { KanbanWebviewPanel } from './kanbanWebviewPanel';


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Markdown Kanban extension is now active!');

	// 注册webview panel序列化器（用于恢复面板状态）
	if (vscode.window.registerWebviewPanelSerializer) {
		vscode.window.registerWebviewPanelSerializer(KanbanWebviewPanel.viewType, {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: any) {
				KanbanWebviewPanel.revive(webviewPanel, context.extensionUri);
			}
		});
	}

	// 注册打开看板命令（在中间区域打开）
	const openKanbanCommand = vscode.commands.registerCommand('markdown-kanban.openKanban', async (uri?: vscode.Uri) => {
		let targetUri = uri;

		// 如果没有提供URI，尝试从当前活动编辑器获取
		if (!targetUri && vscode.window.activeTextEditor) {
			targetUri = vscode.window.activeTextEditor.document.uri;
		}

		// 如果还是没有URI，让用户选择文件
		if (!targetUri) {
			const fileUris = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				filters: {
					'Markdown files': ['md']
				}
			});

			if (fileUris && fileUris.length > 0) {
				targetUri = fileUris[0];
			} else {
				return;
			}
		}

		// 检查文件是否为markdown文件
		if (!targetUri.fsPath.endsWith('.md')) {
			vscode.window.showErrorMessage('请选择一个markdown文件。');
			return;
		}

		try {
			// 打开文档
			const document = await vscode.workspace.openTextDocument(targetUri);

			// 在中间区域创建或显示看板面板
			KanbanWebviewPanel.createOrShow(context.extensionUri, document);

			vscode.window.showInformationMessage(`load kanban from: ${document.fileName}`);
		} catch (error) {
			vscode.window.showErrorMessage(`failed open kanban: ${error}`);
		}
	});

	// 监听文档变化，自动更新看板（实时同步）
	const documentChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
		if (event.document.languageId === 'markdown') {
			// 延迟更新，避免频繁刷新
			setTimeout(() => {
				// 更新面板中的看板
				if (KanbanWebviewPanel.currentPanel) {
					KanbanWebviewPanel.currentPanel.loadMarkdownFile(event.document);
				}
			}, 500);
		}
	});

	// 监听活动编辑器变化
	const activeEditorChangeListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor && editor.document.languageId === 'markdown') {
			vscode.commands.executeCommand('setContext', 'markdownKanbanActive', true);
			// 如果有面板打开，自动加载当前文档
			if (KanbanWebviewPanel.currentPanel) {
				KanbanWebviewPanel.currentPanel.loadMarkdownFile(editor.document);
			}
		} else {
			vscode.commands.executeCommand('setContext', 'markdownKanbanActive', false);
		}
	});

	// 添加到订阅列表
	context.subscriptions.push(
		openKanbanCommand,
		documentChangeListener,
		activeEditorChangeListener
	);

	// 如果当前有活动的markdown编辑器，自动激活看板
	if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'markdown') {
		vscode.commands.executeCommand('setContext', 'markdownKanbanActive', true);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	// 清理上下文
	vscode.commands.executeCommand('setContext', 'markdownKanbanActive', false);
}
