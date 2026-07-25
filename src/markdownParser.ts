export interface KanbanTask {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  priority?: 'low' | 'medium' | 'high';
  workload?: 'Easy' | 'Normal' | 'Hard' | 'Extreme';
  dueDate?: string;
  startDate?: string;
  defaultExpanded?: boolean;
  steps?: Array<{ text: string; completed: boolean }>;
}

export interface KanbanColumn {
  id: string;
  title: string;
  tasks: KanbanTask[];
  archived?: boolean;
}

export interface KanbanBoard {
  title: string;
  columns: KanbanColumn[];
}

export class MarkdownKanbanParser {
  private static generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  static parseMarkdown(content: string): KanbanBoard {
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const board: KanbanBoard = {
      title: '',
      columns: []
    };

    let currentColumn: KanbanColumn | null = null;
    let currentTask: KanbanTask | null = null;
    let inCodeBlock = false;
    let taskIndent = 0;
    let stepsIndent = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      const indentation = this.getIndentation(line);

      // 检查代码块标记
      if (inCodeBlock) {
        if (trimmedLine === '```') {
          inCodeBlock = false;
          continue;
        }
        if (currentTask) {
          const cleanLine = line.replace(/^\s{4}/, '');
          currentTask.description = currentTask.description
            ? currentTask.description + '\n' + cleanLine
            : cleanLine;
        }
        continue;
      }

      // 解析看板标题
      if (!inCodeBlock && trimmedLine.startsWith('# ') && !board.title) {
        board.title = trimmedLine.substring(2).trim();
        this.finalizeCurrentTask(currentTask, currentColumn);
        currentTask = null;
        stepsIndent = -1;
        continue;
      }

      // 解析列标题
      if (!inCodeBlock && trimmedLine.startsWith('## ')) {
        this.finalizeCurrentTask(currentTask, currentColumn);
        currentTask = null;
        if (currentColumn) {
          board.columns.push(currentColumn);
        }
        
        let columnTitle = trimmedLine.substring(3).trim();
        let isArchived = false;
        
        // 检查是否包含 [Archived] 标记
        if (columnTitle.endsWith('[Archived]')) {
          isArchived = true;
          columnTitle = columnTitle.replace(/\s*\[Archived\]$/, '').trim();
        }
        
        currentColumn = {
          id: this.generateId(),
          title: columnTitle,
          tasks: [],
          archived: isArchived
        };
        stepsIndent = -1;
        continue;
      }

      // 解析任务标题
      if (this.isTaskTitle(line, trimmedLine)) {
        this.finalizeCurrentTask(currentTask, currentColumn);

        if (currentColumn) {
          const taskTitle = this.getTaskTitle(trimmedLine);

          currentTask = {
            id: this.generateId(),
            title: taskTitle,
            description: ''
          };
          taskIndent = indentation;
          stepsIndent = -1;
        }
        continue;
      }

      // 解析任务属性
      if (currentTask) {
        const property = this.parseTaskProperty(line, currentTask);
        if (property) {
          if (property === 'steps') {
            stepsIndent = indentation;
          }
          continue;
        }

        // 解析 steps 中的具体步骤项
        if (currentTask.steps && stepsIndent >= 0 && indentation > stepsIndent && this.parseTaskStep(line, currentTask)) {
          continue;
        }

        // 检查是否开始描述部分
        if (indentation > taskIndent && /^```(?:md|markdown)?\s*$/.test(trimmedLine)) {
          inCodeBlock = true;
          continue;
        }
      }

      // 处理空行
      if (trimmedLine === '') {
        continue;
      }

      // 结束当前任务
      if (currentTask) {
        this.finalizeCurrentTask(currentTask, currentColumn);
        currentTask = null;
        stepsIndent = -1;
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

  private static isTaskTitle(line: string, trimmedLine: string): boolean {
    return /^###\s+/.test(trimmedLine) ||
      (/^-\s+/.test(line) && !/^\s*-\s+(?:due|tags|priority|workload|steps|defaultExpanded):/.test(line));
  }

  private static getIndentation(line: string): number {
    const match = line.match(/^[ \t]*/);
    return match ? match[0].replace(/\t/g, '    ').length : 0;
  }

  private static getTaskTitle(trimmedLine: string): string {
    let title = trimmedLine.startsWith('###')
      ? trimmedLine.replace(/^###\s+/, '')
      : trimmedLine.replace(/^-\s+/, '');
    if (/^\[[ xX]\]\s+/.test(title)) {
      title = title.substring(4).trim();
    }
    return title.trim();
  }

  private static parseTaskProperty(line: string, task: KanbanTask): string | false {
    const propertyMatch = line.match(/^(\s*)-\s+(due|tags|priority|workload|steps|defaultExpanded):\s*(.*)$/);
    if (!propertyMatch) return false;

    const [, , propertyName, propertyValue] = propertyMatch;
    const value = propertyValue.trim();

    switch (propertyName) {
      case 'due':
        task.dueDate = value;
        break;
      case 'tags':
        const tagsMatch = value.match(/\[(.*)\]/);
        if (tagsMatch) {
          task.tags = tagsMatch[1].split(',').map(tag => tag.trim());
        }
        break;
      case 'priority':
        if (['low', 'medium', 'high'].includes(value)) {
          task.priority = value as 'low' | 'medium' | 'high';
        }
        break;
      case 'workload':
        if (['Easy', 'Normal', 'Hard', 'Extreme'].includes(value)) {
          task.workload = value as 'Easy' | 'Normal' | 'Hard' | 'Extreme';
        }
        break;
      case 'defaultExpanded':
        task.defaultExpanded = value.toLowerCase() === 'true';
        break;
      case 'steps':
        task.steps = [];
        break;
    }
    return propertyName;
  }

  private static parseTaskStep(line: string, task: KanbanTask): boolean {
    if (!task.steps) return false;
    
    const stepMatch = line.match(/^\s*-\s+\[([ xX])\]\s*(.*)$/);
    if (!stepMatch) return false;

    const [, checkmark, text] = stepMatch;
    task.steps.push({ 
      text: text.trim(), 
      completed: checkmark.toLowerCase() === 'x'
    });
    return true;
  }

  private static finalizeCurrentTask(task: KanbanTask | null, column: KanbanColumn | null): void {
    if (!task || !column) return;

    if (task.description) {
      task.description = task.description.trim();
      if (task.description === '') {
        delete task.description;
      }
    }
    column.tasks.push(task);
  }

  static generateMarkdown(board: KanbanBoard, taskHeaderFormat: 'title' | 'list' = 'title'): string {
    let markdown = '';

    if (board.title) {
      markdown += `# ${board.title}\n\n`;
    }

    for (const column of board.columns) {
      const columnTitle = column.archived ? `${column.title} [Archived]` : column.title;
      markdown += `## ${columnTitle}\n\n`;

      for (const task of column.tasks) {
        if (taskHeaderFormat === 'title') {
          markdown += `### ${task.title}\n\n`;
        } else {
          markdown += `- ${task.title}\n`;
        }

        // 添加任务属性
        markdown += this.generateTaskProperties(task);

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

  private static generateTaskProperties(task: KanbanTask): string {
    let properties = '';

    if (task.dueDate) {
      properties += `  - due: ${task.dueDate}\n`;
    }
    if (task.tags && task.tags.length > 0) {
      properties += `  - tags: [${task.tags.join(', ')}]\n`;
    }
    if (task.priority) {
      properties += `  - priority: ${task.priority}\n`;
    }
    if (task.workload) {
      properties += `  - workload: ${task.workload}\n`;
    }
    if (task.defaultExpanded !== undefined) {
      properties += `  - defaultExpanded: ${task.defaultExpanded}\n`;
    }
    if (task.steps && task.steps.length > 0) {
      properties += `  - steps:\n`;
      for (const step of task.steps) {
        const checkbox = step.completed ? '[x]' : '[ ]';
        properties += `      - ${checkbox} ${step.text}\n`;
      }
    }

    return properties;
  }
}
