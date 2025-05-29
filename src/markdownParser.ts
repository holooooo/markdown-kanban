export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  priority?: 'low' | 'medium' | 'high';
  dueDate?: string;
  startDate?: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  tasks: KanbanTask[];
}

export interface KanbanBoard {
  title: string;
  columns: KanbanColumn[];
}

interface ExtractedData<T> {
  value?: T;
  remainingTitle: string;
}

export class MarkdownKanbanParser {
  private static generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  static parseMarkdown(content: string): KanbanBoard {
    const lines = content.split('\n');
    const board: KanbanBoard = {
      title: '',
      columns: []
    };

    let currentColumn: KanbanColumn | null = null;
    let currentTask: KanbanTask | null = null;
    let inTaskProperties = false;
    let inTaskDescription = false;
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const trimmedLine = line.trim();

      // 检查代码块标记（需要在其他解析之前）
      if (trimmedLine.startsWith('```')) {
        if (inTaskDescription) {
          if (trimmedLine === '```md' || trimmedLine === '```') {
            inCodeBlock = !inCodeBlock;
            continue;
          }
        }
      }

      // 如果在代码块内部，直接处理为描述内容，不进行其他解析
      if (inCodeBlock && inTaskDescription && currentTask) {
        if (trimmedLine === '```') {
          inCodeBlock = false;
          inTaskDescription = false;
          continue;
        } else {
          if (currentTask.description) {
            currentTask.description += '\n' + line.replace(/^\s{4,}/, '');
          } else {
            currentTask.description = line.replace(/^\s{4,}/, '');
          }
        }
        continue;
      }

      // 解析看板标题（只有在不在代码块内时才解析）
      if (!inCodeBlock && trimmedLine.startsWith('# ') && !board.title) {
        board.title = trimmedLine.substring(2).trim();
        this.finalizeCurrentTask(currentTask, currentColumn);
        currentTask = null;
        inTaskProperties = false;
        inTaskDescription = false;
        continue;
      }

      // 解析列标题（只有在不在代码块内时才解析）
      if (!inCodeBlock && trimmedLine.startsWith('## ')) {
        this.finalizeCurrentTask(currentTask, currentColumn);
        currentTask = null;
        if (currentColumn) {
          board.columns.push(currentColumn);
        }
        currentColumn = {
          id: this.generateId(),
          title: trimmedLine.substring(3).trim(),
          tasks: []
        };
        inTaskProperties = false;
        inTaskDescription = false;
        continue;
      }

      // 解析任务标题（只有在不在代码块内时才解析）
      if (!inCodeBlock && trimmedLine.startsWith('- ') && !trimmedLine.match(/^\s*- (due|tags|priority):/)) {
        this.finalizeCurrentTask(currentTask, currentColumn);

        if (currentColumn) {
          let taskTitle = trimmedLine.substring(2).trim();

          // 移除复选框标记如果存在
          if (taskTitle.startsWith('[ ] ') || taskTitle.startsWith('[x] ')) {
            taskTitle = taskTitle.substring(4).trim();
          }

          currentTask = {
            id: this.generateId(),
            title: taskTitle,
            description: ''
          };
          inTaskProperties = true;
          inTaskDescription = false;
        }
        continue;
      }

      // 解析任务属性（只有在不在代码块内时才解析）
      if (!inCodeBlock && currentTask && inTaskProperties && line.match(/^\s+- (due|tags|priority):/)) {
        const propertyMatch = line.match(/^\s+- (due|tags|priority):\s*(.*)$/);
        if (propertyMatch) {
          const propertyName = propertyMatch[1];
          const propertyValue = propertyMatch[2].trim();

          if (propertyName === 'due') {
            currentTask.dueDate = propertyValue;
          } else if (propertyName === 'tags') {
            // 解析 [tag1, tag2] 格式
            const tagsMatch = propertyValue.match(/\[(.*)\]/);
            if (tagsMatch) {
              currentTask.tags = tagsMatch[1].split(',').map(tag => tag.trim());
            }
          } else if (propertyName === 'priority') {
            if (['low', 'medium', 'high'].includes(propertyValue)) {
              currentTask.priority = propertyValue as 'low' | 'medium' | 'high';
            }
          }
        }
        continue;
      }

      // 检查是否开始描述部分（发现代码块开始，只有在不在代码块内时才解析）
      if (!inCodeBlock && currentTask && inTaskProperties && line.match(/^\s+```md/)) {
        inTaskProperties = false;
        inTaskDescription = true;
        inCodeBlock = true;
        continue;
      }

      // 处理空行或其他内容
      if (trimmedLine === '') {
        continue;
      }

      // 如果遇到其他内容且不在代码块内，结束当前任务
      if (!inCodeBlock && currentTask && (inTaskProperties || inTaskDescription)) {
        this.finalizeCurrentTask(currentTask, currentColumn);
        currentTask = null;
        inTaskProperties = false;
        inTaskDescription = false;
        // 重新处理当前行
        i--;
      }
    }

    // 添加最后的任务和列
    this.finalizeCurrentTask(currentTask, currentColumn);
    if (currentColumn) {
      board.columns.push(currentColumn);
    }

    return board;
  }

  private static finalizeCurrentTask(task: KanbanTask | null, column: KanbanColumn | null) {
    if (task && column) {
      if (task.description) {
        task.description = task.description.trim();
        if (task.description === '') {
          delete task.description;
        }
      }
      column.tasks.push(task);
    }
  }

  static generateMarkdown(board: KanbanBoard): string {
    let markdown = '';

    if (board.title) {
      markdown += `# ${board.title}\n\n`;
    }

    for (const column of board.columns) {
      markdown += `## ${column.title}\n\n`;

      for (const task of column.tasks) {
        markdown += `- ${task.title}\n`;

        // 添加任务属性
        if (task.dueDate) {
          markdown += `  - due: ${task.dueDate}\n`;
        }
        if (task.tags && task.tags.length > 0) {
          markdown += `  - tags: [${task.tags.join(', ')}]\n`;
        }
        if (task.priority) {
          markdown += `  - priority: ${task.priority}\n`;
        }

        // 添加描述
        if (task.description && task.description.trim() !== '') {
          markdown += `    \`\`\`md\n`;
          const descriptionLines = task.description.trim().split('\n');
          for (const descLine of descriptionLines) {
            markdown += `    ${descLine}\n`;
          }
          markdown += `    \`\`\`\n`;
        }

        markdown += '\n';
      }
    }
    return markdown;
  }

  // 保留原有的提取方法以向后兼容
  private static extractTags(title: string): ExtractedData<string[]> {
    const tags: string[] = [];
    let remainingTitle = title;
    const tagRegex = /#(\w+)/g;
    let match;
    while ((match = tagRegex.exec(remainingTitle)) !== null) {
      tags.push(match[1]);
    }
    remainingTitle = remainingTitle.replace(tagRegex, '').trim();
    return { value: tags.length > 0 ? tags : undefined, remainingTitle };
  }

  private static extractPriority(title: string): ExtractedData<'low' | 'medium' | 'high'> {
    let remainingTitle = title;
    let priority: 'low' | 'medium' | 'high' | undefined;

    if (remainingTitle.includes('🔴') || remainingTitle.includes('!high')) {
      priority = 'high';
      remainingTitle = remainingTitle.replace('🔴', '').replace('!high', '').trim();
    } else if (remainingTitle.includes('🟡') || remainingTitle.includes('!medium')) {
      priority = 'medium';
      remainingTitle = remainingTitle.replace('🟡', '').replace('!medium', '').trim();
    } else if (remainingTitle.includes('🟢') || remainingTitle.includes('!low')) {
      priority = 'low';
      remainingTitle = remainingTitle.replace('🟢', '').replace('!low', '').trim();
    }
    return { value: priority, remainingTitle };
  }

  private static extractDueDate(title: string): ExtractedData<string> {
    let remainingTitle = title;
    const dueDateMatch = remainingTitle.match(/due:(\d{4}-\d{2}-\d{2})/);
    const dueDate = dueDateMatch ? dueDateMatch[1] : undefined;
    if (dueDate) {
      remainingTitle = remainingTitle.replace(/due:(\d{4}-\d{2}-\d{2})/, '').trim();
    }
    return { value: dueDate, remainingTitle };
  }

  private static extractStartDate(title: string): ExtractedData<string> {
    let remainingTitle = title;
    const startDateMatch = remainingTitle.match(/start:(\d{4}-\d{2}-\d{2})/);
    const startDate = startDateMatch ? startDateMatch[1] : undefined;
    if (startDate) {
      remainingTitle = remainingTitle.replace(/start:(\d{4}-\d{2}-\d{2})/, '').trim();
    }
    return { value: startDate, remainingTitle };
  }
}