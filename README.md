# Markdown Kanban
> Made by cursor

A powerful VS Code extension that transforms Markdown files into interactive Kanban boards, supporting task management, drag-and-drop operations, and rich task attributes.

## ✨ Features

### 📋 Basic Features
- **Markdown Parsing**: Automatically parses task lists from Markdown files.
- **Kanban View**: Displays tasks in a Kanban board format with multi-column layout.
- **Drag & Drop**: Supports dragging and dropping tasks between different columns.
- **Real-time Sync**: Ensures real-time, two-way synchronization between the Kanban board and the Markdown file.

### 🎯 Task Management
- **Task Collapse/Expand**: Tasks are collapsed by default, showing only the task name, priority, and tags. Click to expand for details.
- **Priority Support**: Supports three priority levels: High (🔴), Medium (🟡), and Low (🟢).
- **Tagging System**: Supports multiple tags for categorization, using `#tagname` or `[tag1, tag2]` format.
- **Time Management**:
  - Due Date: `due:YYYY-MM-DD`
  - **Due Date Display**: Shows remaining days on task cards, with color indicators for overdue, urgent, and upcoming tasks.
- **Task Description**: Supports multi-line detailed descriptions, including the new code block format.

### 🆕 Task Format
Supports a structured task format for better readability and organization:
- **Structured Attributes**: Task attributes use an indented list format.
- **Code Block Descriptions**: Use ```` ```md ```` code blocks for detailed descriptions.
- **Array Tags**: Tags support `[tag1, tag2, tag3]` array format.
- **Backward Compatibility**: Fully compatible with the old inline format.

### 🔍 Filtering & Sorting
- **Tag Filtering**: Filter tasks by tags; multiple tags (comma-separated) are supported.
- **Multiple Sorting Options**:
  - Sort by Task Name
  - Sort by Due Date
  - Sort by Priority
  - Sort by Tags
- **Clear Filters**: One-click to clear all filtering and sorting conditions.

### 🖥️ UI Features
- **Dual View Mode**:
  - Sidebar View: Compact Kanban display.
  - Main Panel: Full Kanban editing interface.
- **Modern UI**: Adheres to VS Code design guidelines and supports theme switching.
- **Responsive Design**: Adapts to different screen sizes.

## 🚀 Quick Start

### Installation
1. Search for "Markdown Kanban" in the VS Code Extension Marketplace.
2. Click Install.

### How to Use

#### 1. Create a Markdown Kanban File

```markdown
# My Project Board

## To Do

- Design User Interface
  - due: 2024-01-15
  - tags: [design, ui, frontend]
  - priority: high
    ```md
    Design user login and registration pages, including:
    - Responsive layout design
    - Brand color application
    - User experience optimization
    ```

- Write API Documentation
  - due: 2024-01-20
  - tags: [documentation, backend]
  - priority: medium
    ```md
    Write complete REST API documentation using OpenAPI 3.0 specification.
    Include request and response examples for all endpoints.
    ```

## In Progress

- Implement User Authentication
  - due: 2024-01-18
  - tags: [backend, security]
  - priority: high
    ```md
    Implement a complete user authentication system, including login, registration, and permission management.
    ```

## Done

- Project Initialization
  - due: 2024-01-05
  - tags: [setup]
  - priority: low
```

#### 2. Open Kanban View
- **Method 1**: Right-click on the Markdown file → Select "Open as Kanban Board"
- **Method 2**: Use the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) → Type "Open Kanban Board"
- **Method 3**: Check the Kanban view in the sidebar.

#### 3. Use Filtering and Sorting
- **Tag Filtering**: Enter tag names in the top filter box (e.g., design,ui).
- **Sorting**: Use the sort dropdown menu to select a sorting method.
- **Clear**: Click the "Clear Filters" button to reset all conditions.

#### 4. Task Operations
- **View Task**: Click on a task card to expand/collapse detailed information.
- **Move Task**: Drag and drop tasks to different columns.
- **Edit Task**: Click the "Edit" button on a task.
- **Delete Task**: Click the "Delete" button on a task.
- **Add Task**: Click the "+ Add Task" button at the bottom of a column.

#### 5. Column Management
- **Hide Column**: Click the eye icon on the right side of the column title.
- **Show Hidden Columns**: Click the "Manage Columns" button and enter the column number when prompted.
- **Reorder Columns**: Drag and drop column titles to reorder them.

## 📝 Markdown Format Guide

### 🆕 New Format (v1.2.0+)

**Basic Structure**:
```markdown
# Board Title

## Column Title

- Task Name
  - due: 2024-01-15
  - tags: [tag1, tag2, tag3]
  - priority: high
    ```md
    Detailed task description
    Supports multi-line content
    ```
```

**Attribute Descriptions**:
- `due: YYYY-MM-DD` - Due date
- `tags: [tag1, tag2, tag3]` - Tag array
- `priority: low|medium|high` - Priority (low/medium/high)
- Descriptions use ```` ```md ```` code block format.

**Advantages**:
- Better structure and readability.
- Tags support array format, avoiding conflicts.
- Descriptions support full Markdown syntax.
- Easier to parse and maintain.

### 💡 Format Selection Guide

- **New Projects**: Recommended to use the new format for a better experience.
- **Existing Projects**: Can continue using the legacy format or gradually migrate to the new format.
- **Mixed Usage**: Supports using both formats in the same file.

### Due Date Display Explanation
- **Overdue**: Red background, displays "Overdue X days"
- **Due Today**: Orange background, displays "Due Today"
- **Due Tomorrow**: Orange background, displays "Due Tomorrow"
- **Within 3 Days**: Green background, displays "X days left"
- **Others**: Gray background, displays "X days left"

## ⌨️ Keyboard Shortcuts

| Shortcut                             | Function         |
| ------------------------------------ | ---------------- |
| `Ctrl+Shift+P` → "Open Kanban Board" | Open Kanban View |

## 🔧 Configuration Options

The extension currently uses default configurations. Future versions will support more customization options.
