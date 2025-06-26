console.log('TEST SCRIPT WORKING')

const vscode = acquireVsCodeApi()
let currentBoard = null
let expandedTasks = new Set()
let currentEditingTask = null
let currentEditingColumn = null
let isEditMode = false
let currentTagFilter = ''
let currentSort = 'none'

// Listen for messages from the extension
window.addEventListener('message', event => {
  const message = event.data
  switch (message.type) {
    case 'updateBoard':
      currentBoard = message.board
      renderBoard()
      break
    case 'toggleTaskExpansion':
      toggleTaskExpansion(message.taskId)
      break
  }
})

// Calculate deadline remaining time
function getDeadlineInfo (dueDate) {
  if (!dueDate) return null

  const today = new Date()
  const deadline = new Date(dueDate)
  const diffTime = deadline - today
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  const priorityOrder = { high: 3, medium: 2, low: 1 }

  let status, text
  if (diffDays < 0) {
    status = 'overdue'
    text = `Overdue ${Math.abs(diffDays)} days`
  } else if (diffDays === 0) {
    status = 'urgent'
    text = 'Due today'
  } else if (diffDays === 1) {
    status = 'urgent'
    text = 'Due tomorrow'
  } else if (diffDays <= 3) {
    status = 'upcoming'
    text = `${diffDays} days left`
  } else {
    status = 'normal'
    text = `${diffDays} days left`
  }

  return { status, text, days: diffDays }
}

// Render Kanban board based on filter conditions and sorting settings
function renderBoard () {
  if (!currentBoard) return

  const boardElement = document.getElementById('kanban-board')
  boardElement.innerHTML = ''

  // Sort columns if needed
  let columns = [...currentBoard.columns]

  columns.forEach(column => {
    const columnElement = createColumnElement(column)
    boardElement.appendChild(columnElement)
  })

  // Add control buttons container
  const controlsContainer = document.createElement('div')
  controlsContainer.className = 'board-controls'

  // Add show filters button
  const showFiltersBtn = document.createElement('button')
  showFiltersBtn.className = 'show-filters-btn'
  showFiltersBtn.textContent = 'Show Filters'
  showFiltersBtn.onclick = () => toggleFilters(true)
  showFiltersBtn.id = 'show-filters-dynamic'

  // Add new column button
  const addColumnBtn = document.createElement('button')
  addColumnBtn.className = 'add-column-btn'
  addColumnBtn.textContent = '+ Add Column'
  addColumnBtn.onclick = () => addColumn()

  controlsContainer.appendChild(showFiltersBtn)
  controlsContainer.appendChild(addColumnBtn)
  boardElement.appendChild(controlsContainer)

  // Check if filters are currently visible and hide button accordingly
  const header = document.getElementById('kanban-header')
  if (header && header.classList.contains('visible')) {
    showFiltersBtn.style.display = 'none'
  }

  // Setup column drag and drop
  setupColumnDragAndDrop()
}

function createColumnElement (column) {
  const columnDiv = document.createElement('div')
  columnDiv.className = 'kanban-column'
  columnDiv.setAttribute('data-column-id', column.id)

  // Filter and sort tasks
  let filteredTasks = filterTasks(column.tasks)
  let sortedTasks = sortTasks(filteredTasks)

  columnDiv.innerHTML = `
        <div class="column-header" draggable="true">
            <div>
                <h3 class="column-title">${column.title}</h3>
            </div>
            <div class="column-controls-menu">
                <span class="task-count">${sortedTasks.length}</span>
            </div>
        </div>
        <div class="tasks-container" id="tasks-${column.id}">
            ${sortedTasks
              .map(task => createTaskElement(task, column.id))
              .join('')}
        </div>
        <button class="add-task-btn" onclick="openTaskModal('${column.id}')">
            + Add Task
        </button>
    `

  // Add task drag and drop events
  setupTaskDragAndDrop(columnDiv, column.id)

  return columnDiv
}

function createTaskElement (task, columnId) {
  const isExpanded = expandedTasks.has(task.id)
  const priorityClass = task.priority ? `priority-${task.priority}` : ''
  const deadlineInfo = getDeadlineInfo(task.dueDate)

  return `
        <div class="task-item ${isExpanded ? 'expanded' : ''}"
             data-task-id="${task.id}"
             data-column-id="${columnId}"
             draggable="true"
             onclick="toggleTaskExpansion('${task.id}')">
            <div class="task-header">
                <div class="task-title">${task.title}</div>
                <div class="task-meta">
                    ${
                      task.priority
                        ? `<div class="task-priority ${priorityClass}" title="Priority: ${getPriorityText(
                            task.priority
                          )}"></div>`
                        : ''
                    }
                </div>
            </div>

            ${
              (task.tags && task.tags.length > 0) || deadlineInfo
                ? `
                <div class="task-tags-row">
                    ${
                      task.tags && task.tags.length > 0
                        ? `
                        <div class="task-tags">
                            ${task.tags
                              .map(
                                tag => `<span class="task-tag">${tag}</span>`
                              )
                              .join('')}
                        </div>
                    `
                        : ''
                    }
                    ${
                      deadlineInfo
                        ? `<div class="task-deadline deadline-${deadlineInfo.status}" title="Due date: ${task.dueDate}">${deadlineInfo.text}</div>`
                        : ''
                    }
                </div>
            `
                : ''
            }

            <div class="task-details">
                ${
                  task.description
                    ? `<div class="task-description">${task.description}</div>`
                    : ''
                }
                <div class="task-info">
                    ${
                      task.dueDate
                        ? `
                        <div class="task-info-item">
                            <span class="task-info-label">Due:</span>
                            <span>${task.dueDate}</span>
                        </div>
                    `
                        : ''
                    }
                </div>
            </div>

            <div class="task-actions">
                <button class="action-btn" onclick="event.stopPropagation(); editTask('${
                  task.id
                }', '${columnId}')">Edit</button>
                <button class="action-btn delete" onclick="event.stopPropagation(); deleteTask('${
                  task.id
                }', '${columnId}')">Delete</button>
            </div>
        </div>
    `
}

// Filter tasks
function filterTasks (tasks) {
  if (!currentTagFilter) return tasks

  const filterTags = currentTagFilter
    .toLowerCase()
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag)
  if (filterTags.length === 0) return tasks

  return tasks.filter(task => {
    if (!task.tags || task.tags.length === 0) return false
    return filterTags.some(filterTag =>
      task.tags.some(taskTag => taskTag.toLowerCase().includes(filterTag))
    )
  })
}

// Sort tasks
function sortTasks (tasks) {
  const sorted = [...tasks]

  switch (currentSort) {
    case 'title':
      return sorted.sort((a, b) => a.title.localeCompare(b.title))
    case 'deadline':
      return sorted.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return new Date(a.dueDate) - new Date(b.dueDate)
      })
    case 'priority':
      return sorted.sort((a, b) => {
        const aPriority = priorityOrder[a.priority] || 0
        const bPriority = priorityOrder[b.priority] || 0
        return bPriority - aPriority
      })
    case 'tags':
      return sorted.sort((a, b) => {
        const aTag = a.tags && a.tags[0] ? a.tags[0] : ''
        const bTag = b.tags && b.tags[0] ? b.tags[0] : ''
        return aTag.localeCompare(bTag)
      })
    default:
      return sorted
  }
}

function getPriorityText (priority) {
  const priorityMap = {
    high: 'High',
    medium: 'Medium',
    low: 'Low'
  }
  return priorityMap[priority] || ''
}

function toggleTaskExpansion (taskId) {
  if (expandedTasks.has(taskId)) {
    expandedTasks.delete(taskId)
  } else {
    expandedTasks.add(taskId)
  }

  const taskElement = document.querySelector(`[data-task-id="${taskId}"]`)
  if (taskElement) {
    taskElement.classList.toggle('expanded')
  }
}

// Setup task drag and drop
function setupTaskDragAndDrop (columnElement, columnId) {
  const tasksContainer = columnElement.querySelector('.tasks-container')

  tasksContainer.addEventListener('dragover', e => {
    e.preventDefault()
    columnElement.classList.add('drag-over')
  })

  tasksContainer.addEventListener('dragleave', e => {
    if (!columnElement.contains(e.relatedTarget)) {
      columnElement.classList.remove('drag-over')
    }
  })

  tasksContainer.addEventListener('drop', e => {
    e.preventDefault()
    columnElement.classList.remove('drag-over')

    const taskId = e.dataTransfer.getData('text/plain')
    const fromColumnId = e.dataTransfer.getData('application/column-id')

    if (taskId && fromColumnId) {
      // Calculate the correct drop index based on mouse position
      const tasks = Array.from(tasksContainer.children)
      let dropIndex = tasks.length

      // Find the task element that should be after the dropped task
      for (let i = 0; i < tasks.length; i++) {
        const taskElement = tasks[i]
        const rect = taskElement.getBoundingClientRect()
        const taskCenter = rect.top + rect.height / 2

        if (e.clientY < taskCenter) {
          dropIndex = i
          break
        }
      }

      // If dragging within the same column, adjust the index
      if (fromColumnId === columnId) {
        const draggedTaskElement = tasksContainer.querySelector(
          '[data-task-id="' + taskId + '"]'
        )
        if (draggedTaskElement) {
          const currentIndex = Array.from(tasks).indexOf(draggedTaskElement)
          // If dropping after the current position, decrease the index by 1
          if (dropIndex > currentIndex) {
            dropIndex--
          }
        }
      }

      vscode.postMessage({
        type: 'moveTask',
        taskId: taskId,
        fromColumnId: fromColumnId,
        toColumnId: columnId,
        newIndex: dropIndex
      })
    }
  })

  // Add drag events for tasks
  tasksContainer.addEventListener('dragstart', e => {
    if (e.target.classList.contains('task-item')) {
      e.stopPropagation() // 防止触发列拖拽
      e.dataTransfer.setData('text/plain', e.target.dataset.taskId)
      e.dataTransfer.setData('application/column-id', e.target.dataset.columnId)
      e.target.classList.add('dragging')
    }
  })

  tasksContainer.addEventListener('dragend', e => {
    if (e.target.classList.contains('task-item')) {
      e.target.classList.remove('dragging')
    }
  })
}

// Setup column drag and drop
function setupColumnDragAndDrop () {
  const boardElement = document.getElementById('kanban-board')
  const columns = boardElement.querySelectorAll('.kanban-column')
  let draggedColumnIndex = -1

  columns.forEach((column, index) => {
    const columnHeader = column.querySelector('.column-header')

    // Column drag start - listen on header
    columnHeader.addEventListener('dragstart', e => {
      draggedColumnIndex = index
      e.dataTransfer.setData('text/plain', index.toString())
      e.dataTransfer.effectAllowed = 'move'
      column.classList.add('column-dragging')
    })

    // Column drag end - listen on header
    columnHeader.addEventListener('dragend', e => {
      column.classList.remove('column-dragging')
      draggedColumnIndex = -1
      // Remove drag-over class from all columns
      columns.forEach(col => col.classList.remove('drag-over'))
    })

    // Column drag over - listen on column for drop zone
    column.addEventListener('dragover', e => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (draggedColumnIndex !== -1 && draggedColumnIndex !== index) {
        column.classList.add('drag-over')
      }
    })

    // Column drag leave
    column.addEventListener('dragleave', e => {
      if (!column.contains(e.relatedTarget)) {
        column.classList.remove('drag-over')
      }
    })

    // Column drop - listen on column
    column.addEventListener('drop', e => {
      e.preventDefault()
      column.classList.remove('drag-over')

      const fromIndex = draggedColumnIndex
      const toIndex = index

      if (fromIndex !== -1 && fromIndex !== toIndex) {
        vscode.postMessage({
          type: 'moveColumn',
          fromIndex: fromIndex,
          toIndex: toIndex
        })
      }
    })
  })
}

function openTaskModal (columnId, taskId = null) {
  currentEditingColumn = columnId
  currentEditingTask = taskId
  isEditMode = !!taskId

  const modal = document.getElementById('task-modal')
  const modalTitle = document.getElementById('modal-title')
  const form = document.getElementById('task-form')

  modalTitle.textContent = isEditMode ? 'Edit Task' : 'Add Task'

  if (isEditMode && currentBoard) {
    const column = currentBoard.columns.find(col => col.id === columnId)
    const task = column?.tasks.find(t => t.id === taskId)

    if (task) {
      document.getElementById('task-title').value = task.title || ''
      document.getElementById('task-description').value = task.description || ''
      document.getElementById('task-priority').value = task.priority || ''
      document.getElementById('task-due-date').value = task.dueDate || ''

      // Set tags
      const tagsContainer = document.getElementById('tags-container')
      const tagsInput = document.getElementById('tags-input')

      // Clear existing tags
      tagsContainer.querySelectorAll('.tag-item').forEach(tag => tag.remove())

      // Add existing tags
      if (task.tags) {
        task.tags.forEach(tag => addTagToContainer(tag))
      }
    }
  } else {
    form.reset()
    // Clear tags
    const tagsContainer = document.getElementById('tags-container')
    tagsContainer.querySelectorAll('.tag-item').forEach(tag => tag.remove())
  }

  modal.style.display = 'block'
  document.getElementById('task-title').focus()
}

function closeTaskModal () {
  document.getElementById('task-modal').style.display = 'none'
  currentEditingTask = null
  currentEditingColumn = null
  isEditMode = false
}

function editTask (taskId, columnId) {
  openTaskModal(columnId, taskId)
}

function deleteTask (taskId, columnId) {
  showConfirmModal('Are you sure you want to delete this task?', () => {
    vscode.postMessage({
      type: 'deleteTask',
      taskId: taskId,
      columnId: columnId
    })
  })
}

function showConfirmModal (message, onConfirm) {
  document.getElementById('confirm-message').textContent = message
  document.getElementById('confirm-modal').style.display = 'block'

  const confirmBtn = document.getElementById('confirm-ok-btn')
  confirmBtn.onclick = () => {
    closeConfirmModal()
    onConfirm()
  }
}

function closeConfirmModal () {
  document.getElementById('confirm-modal').style.display = 'none'
}

function showInputModal (title, message, placeholder, onConfirm) {
  document.getElementById('input-modal-title').textContent = title
  document.getElementById('input-modal-message').textContent = message
  const inputField = document.getElementById('input-modal-field')
  inputField.placeholder = placeholder
  inputField.value = ''
  document.getElementById('input-modal').style.display = 'block'

  // Focus on input field
  setTimeout(() => inputField.focus(), 100)

  const confirmBtn = document.getElementById('input-ok-btn')
  confirmBtn.onclick = () => {
    const value = inputField.value.trim()
    if (value) {
      closeInputModal()
      onConfirm(value)
    }
  }

  // Handle Enter key
  inputField.onkeydown = e => {
    if (e.key === 'Enter') {
      const value = inputField.value.trim()
      if (value) {
        closeInputModal()
        onConfirm(value)
      }
    }
  }
}

function closeInputModal () {
  document.getElementById('input-modal').style.display = 'none'
}

function toggleFilters (show) {
  const header = document.getElementById('kanban-header')
  const staticShowBtn = document.getElementById('show-filters')
  const dynamicShowBtn = document.getElementById('show-filters-dynamic')
  const body = document.body

  if (show) {
    header.classList.add('visible')
    body.classList.add('filters-visible')
    if (staticShowBtn) staticShowBtn.style.display = 'none'
    if (dynamicShowBtn) dynamicShowBtn.style.display = 'none'
  } else {
    header.classList.remove('visible')
    body.classList.remove('filters-visible')
    if (staticShowBtn) staticShowBtn.style.display = 'block'
    if (dynamicShowBtn) dynamicShowBtn.style.display = 'block'
  }
}

function addColumn () {
  showInputModal(
    'Add Column',
    'Please enter column title:',
    'Enter column title...',
    title => {
      vscode.postMessage({
        type: 'addColumn',
        title: title
      })
    }
  )
}

// Tag input handling
function setupTagsInput () {
  const tagsInput = document.getElementById('tags-input')

  tagsInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const tag = tagsInput.value.trim()
      if (tag) {
        addTagToContainer(tag)
        tagsInput.value = ''
      }
    }
  })
}

function addTagToContainer (tagText) {
  const tagsContainer = document.getElementById('tags-container')
  const tagsInput = document.getElementById('tags-input')

  // Check if tag already exists
  const existingTags = Array.from(
    tagsContainer.querySelectorAll('.tag-item')
  ).map(tag => tag.textContent.replace('×', '').trim())

  if (existingTags.includes(tagText)) {
    return
  }

  const tagElement = document.createElement('div')
  tagElement.className = 'tag-item'
  tagElement.innerHTML = `
        ${tagText}
        <button type="button" class="tag-remove" onclick="removeTag(this)">×</button>
    `

  tagsContainer.insertBefore(tagElement, tagsInput)
}

function removeTag (button) {
  button.parentElement.remove()
}

function getFormTags () {
  const tagsContainer = document.getElementById('tags-container')
  return Array.from(tagsContainer.querySelectorAll('.tag-item')).map(tag =>
    tag.textContent.replace('×', '').trim()
  )
}

// Filter and sort event listeners
document.addEventListener('DOMContentLoaded', () => {
  setupTagsInput()

  // Tag filtering
  document.getElementById('tag-filter').addEventListener('input', e => {
    currentTagFilter = e.target.value
    renderBoard()
  })

  // Sorting
  document.getElementById('sort-select').addEventListener('change', e => {
    currentSort = e.target.value
    renderBoard()
  })

  // Clear filters
  document.getElementById('clear-filters').addEventListener('click', () => {
    document.getElementById('tag-filter').value = ''
    document.getElementById('sort-select').value = 'none'
    currentTagFilter = ''
    currentSort = 'none'
    renderBoard()
  })

  // Show filters (using event delegation for dynamically created button)
  document.addEventListener('click', e => {
    if (e.target && e.target.id === 'show-filters-dynamic') {
      toggleFilters(true)
    }
  })

  // Hide filters
  document.getElementById('hide-filters').addEventListener('click', () => {
    toggleFilters(false)
  })
})

// Form submission handling
document.getElementById('task-form').addEventListener('submit', e => {
  e.preventDefault()

  const taskData = {
    title: document.getElementById('task-title').value.trim(),
    description: document.getElementById('task-description').value.trim(),
    priority: document.getElementById('task-priority').value || undefined,
    dueDate: document.getElementById('task-due-date').value || undefined,
    tags: getFormTags()
  }

  if (!taskData.title) {
    alert('Please enter a task title')
    return
  }

  if (isEditMode) {
    vscode.postMessage({
      type: 'editTask',
      taskId: currentEditingTask,
      columnId: currentEditingColumn,
      taskData: taskData
    })
  } else {
    vscode.postMessage({
      type: 'addTask',
      columnId: currentEditingColumn,
      taskData: taskData
    })
  }

  closeTaskModal()
})

// Close modal when clicking outside
document.getElementById('task-modal').addEventListener('click', e => {
  if (e.target.id === 'task-modal') {
    closeTaskModal()
  }
})

// Close confirm modal when clicking outside
document.getElementById('confirm-modal').addEventListener('click', e => {
  if (e.target.id === 'confirm-modal') {
    closeConfirmModal()
  }
})

// Close input modal when clicking outside
document.getElementById('input-modal').addEventListener('click', e => {
  if (e.target.id === 'input-modal') {
    closeInputModal()
  }
})
