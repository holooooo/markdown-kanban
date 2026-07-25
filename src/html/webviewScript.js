const vscode = acquireVsCodeApi()
const restoredState = vscode.getState() || {}

let currentBoard = null
let currentDocumentUri = restoredState.documentUri || ''
let expandedTasks = new Set(restoredState.expandedTasks || [])
let currentEditingTask = null
let currentEditingColumn = null
let isEditMode = false
let currentTagFilter = restoredState.tagFilter || ''
let currentSort = restoredState.sort || 'none'
let filtersVisible = restoredState.filtersVisible || false
let confirmAction = null
let inputAction = null
let lastFocusedElement = null
let statusTimer = null

window.addEventListener('message', event => {
  const message = event.data
  switch (message.type) {
    case 'updateBoard':
      if (currentDocumentUri && message.documentUri && currentDocumentUri !== message.documentUri) {
        expandedTasks = new Set()
        currentTagFilter = ''
        currentSort = 'none'
        document.getElementById('tag-filter').value = ''
        document.getElementById('sort-select').value = 'none'
      }
      currentDocumentUri = message.documentUri || ''
      currentBoard = message.board
      document.getElementById('board-name').textContent = message.documentName || currentBoard.title
      document.getElementById('board-path').textContent = message.documentPath || ''
      persistState()
      renderBoard()
      break
    case 'terminalSettings':
      populateTerminalSettings(message.settings)
      openModal('terminal-modal', 'terminal-binary')
      break
    case 'actionResult':
      showStatus(message.message, message.isError)
      break
  }
})

function persistState () {
  vscode.setState({
    documentUri: currentDocumentUri,
    expandedTasks: [...expandedTasks],
    tagFilter: currentTagFilter,
    sort: currentSort,
    filtersVisible
  })
}

function escapeHtml (value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function getDeadlineInfo (dueDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '')) return null
  const [year, month, day] = dueDate.split('-').map(Number)
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const deadline = new Date(year, month - 1, day)
  const diffDays = Math.round((deadline.getTime() - todayStart.getTime()) / 86400000)

  if (diffDays < 0) return { status: 'overdue', text: `Overdue ${Math.abs(diffDays)} days` }
  if (diffDays === 0) return { status: 'urgent', text: 'Due today' }
  if (diffDays === 1) return { status: 'urgent', text: 'Due tomorrow' }
  if (diffDays <= 3) return { status: 'upcoming', text: `${diffDays} days left` }
  return { status: 'normal', text: `${diffDays} days left` }
}

function getStepsProgress (steps) {
  if (!steps?.length) return { completed: 0, total: 0 }
  return { completed: steps.filter(step => step.completed).length, total: steps.length }
}

function renderBoard () {
  if (!currentBoard) return
  const boardElement = document.getElementById('kanban-board')
  const focusedKey = document.activeElement?.dataset?.focusKey
  boardElement.innerHTML = ''

  const normalColumns = currentBoard.columns.filter(column => !column.archived)
  const archivedColumns = currentBoard.columns.filter(column => column.archived)

  normalColumns.forEach(column => boardElement.appendChild(createColumnElement(column)))
  if (archivedColumns.length) boardElement.appendChild(createUnifiedArchiveColumn(archivedColumns))

  if (!currentBoard.columns.length) {
    boardElement.innerHTML = `
      <div class="empty-state">
        <h2>No columns yet</h2>
        <p>Add a column to start organizing this board.</p>
        <button class="btn btn-primary" type="button" data-action="add-column">Add column</button>
      </div>`
  }

  setupDragAndDrop()
  if (focusedKey) boardElement.querySelector(`[data-focus-key="${CSS.escape(focusedKey)}"]`)?.focus()
}

function createColumnElement (column) {
  const columnDiv = document.createElement('section')
  columnDiv.className = 'kanban-column'
  columnDiv.dataset.columnId = column.id
  columnDiv.setAttribute('aria-label', `${column.title} column`)

  const tasks = sortTasks(filterTasks(column.tasks))
  columnDiv.innerHTML = `
    <div class="column-header" draggable="true">
      <div class="column-title-section">
        <h2 class="column-title">${escapeHtml(column.title)}</h2>
        <span class="task-count" aria-label="${tasks.length} tasks">${tasks.length}</span>
      </div>
      <button class="icon-btn" type="button" data-action="archive-column" data-column-id="${column.id}"
        title="Archive column" aria-label="Archive ${escapeHtml(column.title)}">Archive</button>
    </div>
    <div class="tasks-container" data-column-id="${column.id}">
      ${tasks.map(task => createTaskElement(task, column.id)).join('')}
    </div>
    <button class="add-task-btn" type="button" data-action="add-task" data-column-id="${column.id}">Add task</button>`
  return columnDiv
}

function createTaskElement (task, columnId) {
  const isExpanded = getTaskExpansionState(task)
  const deadlineInfo = getDeadlineInfo(task.dueDate)
  const progress = getStepsProgress(task.steps)
  return `
    <article class="task-item ${isExpanded ? 'expanded' : ''}" tabindex="0"
      aria-expanded="${isExpanded}" aria-label="${escapeHtml(task.title)}"
      data-task-id="${task.id}" data-column-id="${columnId}" data-focus-key="task-${task.id}">
      <div class="task-header">
        <div class="task-drag-handle" title="Drag to move task" aria-hidden="true">::</div>
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          ${progress.total ? `<span class="task-steps-progress" title="${progress.completed} of ${progress.total} steps complete">${progress.completed}/${progress.total}</span>` : ''}
          ${task.priority ? `<span class="task-priority priority-${task.priority}" title="${escapeHtml(getPriorityText(task.priority))} priority"><span class="sr-only">${escapeHtml(getPriorityText(task.priority))} priority</span></span>` : ''}
          <button class="terminal-task-btn" type="button" data-action="start-task" data-task-id="${task.id}"
            data-column-id="${columnId}" title="Run task in terminal" aria-label="Run ${escapeHtml(task.title)} in terminal"><span aria-hidden="true">&gt;_</span></button>
        </div>
      </div>
      ${createTaskTagsRow(task, deadlineInfo)}
      ${createTaskDetails(task, columnId)}
      <div class="task-actions">
        <button class="action-btn" type="button" data-action="edit-task" data-task-id="${task.id}" data-column-id="${columnId}">Edit</button>
        <button class="action-btn danger-text" type="button" data-action="delete-task" data-task-id="${task.id}" data-column-id="${columnId}">Delete</button>
      </div>
    </article>`
}

function getTaskExpansionState (task) {
  if (expandedTasks.has(task.id)) return true
  if (!expandedTasks.has(`toggled:${task.id}`) && task.defaultExpanded) {
    expandedTasks.add(task.id)
    return true
  }
  return false
}

function createTaskTagsRow (task, deadlineInfo) {
  const tags = []
  if (task.workload) tags.push(`<span class="task-tag workload-${task.workload.toLowerCase()}">${escapeHtml(task.workload)}</span>`)
  for (const tag of task.tags || []) tags.push(`<span class="task-tag">${escapeHtml(tag)}</span>`)
  if (!tags.length && !deadlineInfo) return ''
  return `<div class="task-tags-row"><div class="task-tags">${tags.join('')}</div>${deadlineInfo ? `<span class="task-deadline deadline-${deadlineInfo.status}" title="Due ${escapeHtml(task.dueDate)}">${deadlineInfo.text}</span>` : ''}</div>`
}

function createTaskDetails (task, columnId) {
  const description = task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''
  const steps = task.steps?.length ? `
    <div class="task-steps">
      <div class="task-steps-header">Steps</div>
      <div class="task-steps-list" data-task-id="${task.id}" data-column-id="${columnId}">
        ${task.steps.map((step, index) => `
          <div class="task-step-item" data-step-index="${index}">
            <div class="step-drag-handle" draggable="true" title="Drag to reorder step" aria-hidden="true">::</div>
            <input type="checkbox" ${step.completed ? 'checked' : ''} data-action="update-step"
              data-task-id="${task.id}" data-column-id="${columnId}" data-step-index="${index}"
              aria-label="Mark ${escapeHtml(step.text)} complete">
            <span class="task-step-text ${step.completed ? 'completed' : ''}">${escapeHtml(step.text)}</span>
          </div>`).join('')}
      </div>
    </div>` : ''
  return `<div class="task-details">${description}${steps}</div>`
}

function createUnifiedArchiveColumn (columns) {
  const element = document.createElement('section')
  element.className = 'kanban-column archived unified-archive collapsed'
  element.dataset.columnId = 'unified-archive'
  const count = columns.reduce((total, column) => total + filterTasks(column.tasks).length, 0)
  element.innerHTML = `
    <div class="column-header">
      <div class="column-title-section">
        <h2 class="column-title">Archived</h2>
        <span class="task-count">${count}</span>
      </div>
      <button class="icon-btn" type="button" data-action="toggle-archive" aria-expanded="false">Show</button>
    </div>
    <div class="archive-content">
      ${columns.map(column => createArchiveSection(column)).join('')}
    </div>`
  return element
}

function createArchiveSection (column) {
  const tasks = sortTasks(filterTasks(column.tasks))
  return `
    <section class="archive-section">
      <div class="archive-section-header">
        <h3 class="archive-section-title">${escapeHtml(column.title)} <span class="archive-section-count">${tasks.length}</span></h3>
        <button class="icon-btn" type="button" data-action="unarchive-column" data-column-id="${column.id}">Restore</button>
      </div>
      ${tasks.length ? `<div class="archive-tasks">${tasks.map(task => `<div class="archive-task-item"><span>${escapeHtml(task.title)}</span></div>`).join('')}</div>` : '<div class="archive-empty-section">No tasks</div>'}
    </section>`
}

function filterTasks (tasks) {
  const tags = currentTagFilter.toLowerCase().split(',').map(tag => tag.trim()).filter(Boolean)
  if (!tags.length) return tasks
  return tasks.filter(task => {
    const taskTags = [...(task.tags || []), task.workload || ''].map(tag => tag.toLowerCase())
    return tags.some(filter => taskTags.some(tag => tag.includes(filter)))
  })
}

function sortTasks (tasks) {
  const sorted = [...tasks]
  const priority = { high: 3, medium: 2, low: 1 }
  const workload = { Extreme: 4, Hard: 3, Normal: 2, Easy: 1 }
  if (currentSort === 'title') return sorted.sort((a, b) => a.title.localeCompare(b.title))
  if (currentSort === 'deadline') return sorted.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
  if (currentSort === 'priority') return sorted.sort((a, b) => (priority[b.priority] || 0) - (priority[a.priority] || 0))
  if (currentSort === 'workload') return sorted.sort((a, b) => (workload[b.workload] || 0) - (workload[a.workload] || 0))
  if (currentSort === 'tags') return sorted.sort((a, b) => (a.tags?.[0] || '').localeCompare(b.tags?.[0] || ''))
  return sorted
}

function getPriorityText (priority) {
  return ({ high: 'High', medium: 'Medium', low: 'Low' })[priority] || ''
}

function toggleTaskExpansion (taskId) {
  expandedTasks.add(`toggled:${taskId}`)
  if (expandedTasks.has(taskId)) expandedTasks.delete(taskId)
  else expandedTasks.add(taskId)
  persistState()

  const task = [...document.querySelectorAll('.task-item')].find(item => item.dataset.taskId === taskId)
  if (task) {
    task.classList.toggle('expanded')
    task.setAttribute('aria-expanded', String(task.classList.contains('expanded')))
  }
}

function setupDragAndDrop () {
  setupColumnDragAndDrop()
  setupTaskDragAndDrop()
  setupStepLists(document.querySelectorAll('.task-steps-list'), true)
}

function setupTaskDragAndDrop () {
  const orderIsVisible = !currentTagFilter && currentSort === 'none'
  document.querySelectorAll('.kanban-column:not(.unified-archive)').forEach(column => {
    const container = column.querySelector('.tasks-container')
    const columnId = column.dataset.columnId
    if (!container) return

    container.querySelectorAll('.task-drag-handle').forEach(handle => {
      handle.draggable = orderIsVisible
      handle.title = orderIsVisible ? 'Drag to move task' : 'Clear filtering and sorting before reordering'
      handle.addEventListener('dragstart', event => {
        if (!orderIsVisible) return event.preventDefault()
        const task = handle.closest('.task-item')
        event.stopPropagation()
        event.dataTransfer.setData('text/task-id', task.dataset.taskId)
        event.dataTransfer.setData('text/column-id', task.dataset.columnId)
        event.dataTransfer.effectAllowed = 'move'
        task.classList.add('dragging')
      })
      handle.addEventListener('dragend', () => handle.closest('.task-item')?.classList.remove('dragging'))
    })

    container.addEventListener('dragover', event => {
      if (!orderIsVisible || !event.dataTransfer.types.includes('text/task-id')) return
      event.preventDefault()
      column.classList.add('drag-over')
    })
    container.addEventListener('dragleave', event => {
      if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over')
    })
    container.addEventListener('drop', event => {
      if (!orderIsVisible) return
      const taskId = event.dataTransfer.getData('text/task-id')
      const fromColumnId = event.dataTransfer.getData('text/column-id')
      if (!taskId || !fromColumnId) return
      event.preventDefault()
      column.classList.remove('drag-over')
      const after = getDragAfterElement(container, event.clientY, '.task-item:not(.dragging)')
      const children = [...container.querySelectorAll('.task-item:not(.dragging)')]
      const newIndex = after ? children.indexOf(after) : children.length
      vscode.postMessage({ type: 'moveTask', taskId, fromColumnId, toColumnId: columnId, newIndex })
    })
  })
}

function setupColumnDragAndDrop () {
  const columns = [...document.querySelectorAll('.kanban-column:not(.unified-archive)')]
  let draggedColumnId = ''
  columns.forEach(column => {
    const header = column.querySelector('.column-header')
    header.addEventListener('dragstart', event => {
      if (event.target.closest('button') || event.target.classList.contains('task-drag-handle')) return event.preventDefault()
      draggedColumnId = column.dataset.columnId
      event.dataTransfer.effectAllowed = 'move'
      column.classList.add('column-dragging')
    })
    header.addEventListener('dragend', () => {
      draggedColumnId = ''
      column.classList.remove('column-dragging')
    })
    column.addEventListener('dragover', event => {
      if (!draggedColumnId || draggedColumnId === column.dataset.columnId) return
      event.preventDefault()
      column.classList.add('drag-over')
    })
    column.addEventListener('dragleave', event => {
      if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over')
    })
    column.addEventListener('drop', event => {
      if (!draggedColumnId || draggedColumnId === column.dataset.columnId) return
      event.preventDefault()
      const fromIndex = currentBoard.columns.findIndex(item => item.id === draggedColumnId)
      const toIndex = currentBoard.columns.findIndex(item => item.id === column.dataset.columnId)
      vscode.postMessage({ type: 'moveColumn', fromIndex, toIndex })
    })
  })
}

function setupStepLists (lists, persistImmediately) {
  lists.forEach(list => {
    if (list.dataset.dragSetup === 'true') return
    list.dataset.dragSetup = 'true'
    list.addEventListener('dragstart', event => {
      const handle = event.target.closest('.step-drag-handle')
      if (!handle) return event.preventDefault()
      const item = handle.closest('.task-step-item, .step-item')
      event.stopPropagation()
      item.classList.add('dragging')
      event.dataTransfer.setData('text/step', item.dataset.stepIndex || String([...list.children].indexOf(item)))
    })
    list.addEventListener('dragend', event => event.target.closest('.task-step-item, .step-item')?.classList.remove('dragging'))
    list.addEventListener('dragover', event => {
      if (!event.dataTransfer.types.includes('text/step')) return
      event.preventDefault()
      const dragging = list.querySelector('.dragging')
      if (!dragging) return
      const after = getDragAfterElement(list, event.clientY, '.task-step-item:not(.dragging), .step-item:not(.dragging)')
      if (after) list.insertBefore(dragging, after)
      else list.appendChild(dragging)
    })
    list.addEventListener('drop', event => {
      if (!event.dataTransfer.types.includes('text/step')) return
      event.preventDefault()
      if (!persistImmediately) return
      const newOrder = [...list.querySelectorAll('.task-step-item')].map(item => Number(item.dataset.stepIndex))
      vscode.postMessage({
        type: 'reorderTaskSteps',
        taskId: list.dataset.taskId,
        columnId: list.dataset.columnId,
        newOrder
      })
    })
  })
}

function getDragAfterElement (container, y, selector) {
  return [...container.querySelectorAll(selector)].reduce((closest, child) => {
    const box = child.getBoundingClientRect()
    const offset = y - box.top - box.height / 2
    return offset < 0 && offset > closest.offset ? { offset, element: child } : closest
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element
}

function openTaskModal (columnId, taskId = null) {
  currentEditingColumn = columnId
  currentEditingTask = taskId
  isEditMode = Boolean(taskId)
  document.getElementById('modal-title').textContent = isEditMode ? 'Edit task' : 'Add task'
  document.getElementById('task-form-error').textContent = ''
  if (isEditMode) populateTaskForm(columnId, taskId)
  else clearTaskForm()
  openModal('task-modal', 'task-title')
}

function populateTaskForm (columnId, taskId) {
  const task = currentBoard.columns.find(column => column.id === columnId)?.tasks.find(item => item.id === taskId)
  if (!task) return
  document.getElementById('task-title').value = task.title || ''
  document.getElementById('task-description').value = task.description || ''
  document.getElementById('task-priority').value = task.priority || ''
  document.getElementById('task-workload').value = task.workload || ''
  document.getElementById('task-due-date').value = task.dueDate || ''
  document.getElementById('task-default-expanded').checked = Boolean(task.defaultExpanded)
  setFormTags(task.tags || [])
  setFormSteps(task.steps || [])
}

function clearTaskForm () {
  document.getElementById('task-form').reset()
  setFormTags([])
  setFormSteps([])
}

function setFormTags (tags) {
  document.querySelectorAll('#tags-container .tag-item').forEach(tag => tag.remove())
  tags.forEach(addTagToContainer)
}

function addTagToContainer (tagText) {
  const value = String(tagText).trim()
  if (!value || getFormTags().includes(value)) return
  const element = document.createElement('span')
  element.className = 'tag-item'
  element.dataset.value = value
  element.innerHTML = `${escapeHtml(value)}<button type="button" class="tag-remove" data-action="remove-tag" aria-label="Remove ${escapeHtml(value)}">&times;</button>`
  document.getElementById('tags-container').insertBefore(element, document.getElementById('tags-input'))
}

function getFormTags () {
  return [...document.querySelectorAll('#tags-container .tag-item')].map(tag => tag.dataset.value)
}

function setFormSteps (steps) {
  const list = document.getElementById('steps-list')
  list.innerHTML = ''
  steps.forEach(step => addStepToContainer(step.text, step.completed))
}

function addStepToContainer (text, completed = false) {
  const value = String(text).trim()
  if (!value) return
  const element = document.createElement('div')
  element.className = 'step-item'
  element.dataset.stepIndex = String(document.getElementById('steps-list').children.length)
  element.innerHTML = `
    <div class="step-drag-handle" draggable="true" title="Drag to reorder" aria-hidden="true">::</div>
    <input type="checkbox" ${completed ? 'checked' : ''} aria-label="Mark ${escapeHtml(value)} complete">
    <span class="step-text ${completed ? 'completed' : ''}">${escapeHtml(value)}</span>
    <button type="button" class="step-remove" data-action="remove-step" aria-label="Remove ${escapeHtml(value)}">&times;</button>`
  document.getElementById('steps-list').appendChild(element)
  setupStepLists([document.getElementById('steps-list')], false)
}

function getFormSteps () {
  return [...document.querySelectorAll('#steps-list .step-item')].map(item => ({
    text: item.querySelector('.step-text').textContent.trim(),
    completed: item.querySelector('input').checked
  }))
}

function openModal (id, focusId) {
  lastFocusedElement = document.activeElement
  const modal = document.getElementById(id)
  modal.classList.add('open')
  modal.setAttribute('aria-hidden', 'false')
  requestAnimationFrame(() => document.getElementById(focusId)?.focus())
}

function closeModal (id) {
  const modal = document.getElementById(id)
  modal.classList.remove('open')
  modal.setAttribute('aria-hidden', 'true')
  if (id === 'task-modal') {
    currentEditingTask = null
    currentEditingColumn = null
    isEditMode = false
  }
  lastFocusedElement?.focus?.()
}

function showConfirmModal (message, action) {
  document.getElementById('confirm-message').textContent = message
  confirmAction = action
  openModal('confirm-modal', 'confirm-ok-btn')
}

function showInputModal (action) {
  inputAction = action
  document.getElementById('input-modal-field').value = ''
  openModal('input-modal', 'input-modal-field')
}

function populateTerminalSettings (settings) {
  document.getElementById('terminal-binary').value = settings.binary || 'codex'
  document.getElementById('terminal-args').value = (settings.args || []).join('\n')
  document.getElementById('terminal-env').value = Object.entries(settings.env || {}).map(([key, value]) => `${key}=${value}`).join('\n')
  document.getElementById('terminal-append-prompt').checked = settings.appendTaskPrompt !== false
  document.getElementById('terminal-prompt-template').value = settings.promptTemplate || ''
  document.getElementById('terminal-form-error').textContent = ''
}

function parseEnvironment (source) {
  const env = {}
  const invalid = []
  source.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return
    const separator = line.indexOf('=')
    const key = separator >= 0 ? line.slice(0, separator).trim() : ''
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) invalid.push(index + 1)
    else env[key] = line.slice(separator + 1)
  })
  if (invalid.length) throw new Error(`Invalid environment variable on line ${invalid.join(', ')}.`)
  return env
}

function showStatus (message, isError = false) {
  const status = document.getElementById('action-status')
  status.textContent = message
  status.classList.toggle('error', Boolean(isError))
  status.classList.add('visible')
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => status.classList.remove('visible'), 3500)
}

function toggleFilters (visible) {
  filtersVisible = visible
  document.getElementById('kanban-header').classList.toggle('visible', visible)
  document.getElementById('show-filters').setAttribute('aria-expanded', String(visible))
  persistState()
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('tag-filter').value = currentTagFilter
  document.getElementById('sort-select').value = currentSort
  toggleFilters(filtersVisible)
  setupStaticEvents()
  vscode.postMessage({ type: 'ready' })
})

function setupStaticEvents () {
  document.getElementById('select-board').addEventListener('click', () => vscode.postMessage({ type: 'selectBoard' }))
  document.getElementById('show-filters').addEventListener('click', () => toggleFilters(!filtersVisible))
  document.getElementById('hide-filters').addEventListener('click', () => toggleFilters(false))
  document.getElementById('add-column').addEventListener('click', () => showInputModal(title => vscode.postMessage({ type: 'addColumn', title })))
  document.getElementById('terminal-settings').addEventListener('click', () => vscode.postMessage({ type: 'getTerminalSettings' }))
  document.getElementById('copy-skill-command').addEventListener('click', () => vscode.postMessage({ type: 'copySkillInstallCommand' }))

  document.getElementById('tag-filter').addEventListener('input', event => {
    currentTagFilter = event.target.value
    persistState()
    renderBoard()
  })
  document.getElementById('sort-select').addEventListener('change', event => {
    currentSort = event.target.value
    persistState()
    renderBoard()
  })
  document.getElementById('clear-filters').addEventListener('click', () => {
    currentTagFilter = ''
    currentSort = 'none'
    document.getElementById('tag-filter').value = ''
    document.getElementById('sort-select').value = 'none'
    persistState()
    renderBoard()
  })

  document.getElementById('kanban-board').addEventListener('click', handleBoardClick)
  document.getElementById('kanban-board').addEventListener('keydown', handleBoardKeydown)
  document.getElementById('kanban-board').addEventListener('change', handleBoardChange)
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)))
  document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('mousedown', event => {
    if (event.target === modal) closeModal(modal.id)
  }))

  document.getElementById('confirm-ok-btn').addEventListener('click', () => {
    closeModal('confirm-modal')
    confirmAction?.()
    confirmAction = null
  })
  document.getElementById('input-ok-btn').addEventListener('click', submitInputModal)
  document.getElementById('input-modal-field').addEventListener('keydown', event => {
    if (event.key === 'Enter') submitInputModal()
  })
  document.getElementById('add-step').addEventListener('click', addStepFromInput)
  document.getElementById('steps-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault()
      addStepFromInput()
    }
  })
  document.getElementById('tags-input').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTagToContainer(event.target.value)
      event.target.value = ''
    }
  })
  document.getElementById('steps-list').addEventListener('click', event => {
    if (event.target.closest('[data-action="remove-step"]')) event.target.closest('.step-item').remove()
  })
  document.getElementById('steps-list').addEventListener('change', event => {
    if (event.target.matches('input[type="checkbox"]')) event.target.nextElementSibling.classList.toggle('completed', event.target.checked)
  })
  document.getElementById('tags-container').addEventListener('click', event => {
    if (event.target.closest('[data-action="remove-tag"]')) event.target.closest('.tag-item').remove()
  })
  document.getElementById('task-form').addEventListener('submit', submitTaskForm)
  document.getElementById('terminal-form').addEventListener('submit', submitTerminalForm)
  document.addEventListener('keydown', handleGlobalKeydown)
}

function handleBoardClick (event) {
  const action = event.target.closest('[data-action]')
  if (action) {
    event.stopPropagation()
    const { taskId, columnId } = action.dataset
    switch (action.dataset.action) {
      case 'start-task': vscode.postMessage({ type: 'startTask', taskId, columnId }); break
      case 'edit-task': openTaskModal(columnId, taskId); break
      case 'delete-task': showConfirmModal('Delete this task? This cannot be undone.', () => vscode.postMessage({ type: 'deleteTask', taskId, columnId })); break
      case 'add-task': openTaskModal(columnId); break
      case 'archive-column': vscode.postMessage({ type: 'toggleColumnArchive', columnId, archived: true }); break
      case 'unarchive-column': vscode.postMessage({ type: 'toggleColumnArchive', columnId, archived: false }); break
      case 'toggle-archive': {
        const archive = action.closest('.unified-archive')
        archive.classList.toggle('collapsed')
        const expanded = !archive.classList.contains('collapsed')
        action.textContent = expanded ? 'Hide' : 'Show'
        action.setAttribute('aria-expanded', String(expanded))
        break
      }
      case 'add-column': showInputModal(title => vscode.postMessage({ type: 'addColumn', title })); break
    }
    return
  }
  const task = event.target.closest('.task-item')
  if (task && !event.target.closest('input, button, .step-drag-handle, .task-drag-handle')) toggleTaskExpansion(task.dataset.taskId)
}

function handleBoardKeydown (event) {
  if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('task-item')) {
    event.preventDefault()
    toggleTaskExpansion(event.target.dataset.taskId)
  }
}

function handleBoardChange (event) {
  if (event.target.dataset.action !== 'update-step') return
  const { taskId, columnId, stepIndex } = event.target.dataset
  vscode.postMessage({ type: 'updateTaskStep', taskId, columnId, stepIndex: Number(stepIndex), completed: event.target.checked })
}

function submitInputModal () {
  const field = document.getElementById('input-modal-field')
  const value = field.value.trim()
  if (!value) return field.focus()
  closeModal('input-modal')
  inputAction?.(value)
  inputAction = null
}

function addStepFromInput () {
  const input = document.getElementById('steps-input')
  addStepToContainer(input.value)
  input.value = ''
  input.focus()
}

function submitTaskForm (event) {
  event.preventDefault()
  const title = document.getElementById('task-title').value.trim()
  if (!title) {
    document.getElementById('task-form-error').textContent = 'Enter a task title.'
    document.getElementById('task-title').focus()
    return
  }
  const taskData = {
    title,
    description: document.getElementById('task-description').value.trim(),
    priority: document.getElementById('task-priority').value || undefined,
    workload: document.getElementById('task-workload').value || undefined,
    dueDate: document.getElementById('task-due-date').value || undefined,
    defaultExpanded: document.getElementById('task-default-expanded').checked,
    tags: getFormTags(),
    steps: getFormSteps()
  }
  vscode.postMessage({
    type: isEditMode ? 'editTask' : 'addTask',
    taskId: currentEditingTask,
    columnId: currentEditingColumn,
    taskData
  })
  closeModal('task-modal')
}

function submitTerminalForm (event) {
  event.preventDefault()
  const error = document.getElementById('terminal-form-error')
  error.textContent = ''
  try {
    const binary = document.getElementById('terminal-binary').value.trim()
    if (!binary) throw new Error('Enter a terminal binary.')
    const settings = {
      binary,
      args: document.getElementById('terminal-args').value.split(/\r?\n/).filter(line => line.length > 0),
      env: parseEnvironment(document.getElementById('terminal-env').value),
      appendTaskPrompt: document.getElementById('terminal-append-prompt').checked,
      promptTemplate: document.getElementById('terminal-prompt-template').value
    }
    vscode.postMessage({ type: 'saveTerminalSettings', settings })
    closeModal('terminal-modal')
  } catch (exception) {
    error.textContent = exception.message
  }
}

function handleGlobalKeydown (event) {
  const openModalElement = [...document.querySelectorAll('.modal.open')].pop()
  if (!openModalElement) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeModal(openModalElement.id)
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [...openModalElement.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
