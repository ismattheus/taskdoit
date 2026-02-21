function createTaskId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeDueDate(dueDate) {
  if (typeof dueDate !== "string") {
    return null;
  }

  const trimmed = dueDate.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toIsoDateFromLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeCompletedDate(completedAt) {
  if (typeof completedAt !== "string" || completedAt.trim().length === 0) {
    return null;
  }

  const date = new Date(completedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return toIsoDateFromLocalDate(date);
}

function formatIsoDateForLabel(isoDate) {
  const normalized = normalizeDueDate(isoDate);
  if (!normalized) {
    return "";
  }

  const [year, month, day] = normalized.split("-");
  return `${day}/${month}/${year}`;
}

function formatDueDateForLabel(dueDate) {
  return formatIsoDateForLabel(dueDate);
}

function formatCompletedDateForLabel(completedAt) {
  return formatIsoDateForLabel(normalizeCompletedDate(completedAt));
}

function getCompletionStatus(dueDate, completedAt) {
  const normalizedDueDate = normalizeDueDate(dueDate);
  const normalizedCompletedDate = normalizeCompletedDate(completedAt);
  if (!normalizedDueDate || !normalizedCompletedDate) {
    return null;
  }

  return normalizedCompletedDate <= normalizedDueDate ? "on-time" : "late";
}

function isTaskOverdue(task) {
  if (!task || task.completed) {
    return false;
  }

  const normalizedDueDate = normalizeDueDate(task.dueDate);
  if (!normalizedDueDate) {
    return false;
  }

  const todayIsoDate = toIsoDateFromLocalDate(new Date());
  return normalizedDueDate < todayIsoDate;
}

export function createTask(contentHtml, template = null, dueDate = null) {
  const normalizedTemplate =
    typeof template === "string" && template.trim().length > 0 ? template.trim() : null;
  const normalizedDueDate = normalizeDueDate(dueDate);

  return {
    id: createTaskId(),
    contentHtml,
    template: normalizedTemplate,
    dueDate: normalizedDueDate,
    createdAt: new Date().toISOString(),
    completed: false,
    completedAt: null,
    sourceType: "manual",
    projectId: null,
  };
}

function renderEmptyState(container, emptyState) {
  const title = emptyState?.title || "No tasks yet";
  const copy = typeof emptyState?.copy === "string" ? emptyState.copy : "";
  const article = document.createElement("article");
  article.className = "empty-state";
  article.dataset.emptyState = "";

  const heading = document.createElement("h2");
  heading.textContent = title;

  article.append(heading);
  if (copy.trim().length > 0) {
    const paragraph = document.createElement("p");
    paragraph.textContent = copy;
    article.append(paragraph);
  }
  container.append(article);
}

function createTaskElement(task) {
  const article = document.createElement("article");
  article.className = "task-item";
  if (task.completed) {
    article.classList.add("is-complete");
    const completionStatus = getCompletionStatus(task.dueDate, task.completedAt);
    if (completionStatus === "on-time") {
      article.classList.add("is-on-time");
    } else if (completionStatus === "late") {
      article.classList.add("is-late");
    }
  }
  if (isTaskOverdue(task)) {
    article.classList.add("is-overdue");
  }
  article.dataset.taskId = task.id;

  const row = document.createElement("div");
  row.className = "task-item-row";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "task-toggle";
  if (task.completed) {
    toggleButton.classList.add("is-complete");
  }
  toggleButton.dataset.action = "toggle-complete";
  toggleButton.setAttribute("aria-label", task.completed ? "Mark as incomplete" : "Mark as complete");
  toggleButton.setAttribute("aria-pressed", String(task.completed));
  toggleButton.textContent = task.completed ? "✓" : "";

  const content = document.createElement("div");
  content.className = "task-item-content";
  if (typeof task.template === "string" && task.template.trim().length > 0) {
    content.dataset.template = task.template.trim();
  }
  content.innerHTML = task.contentHtml;

  const body = document.createElement("div");
  body.className = "task-item-body";
  body.append(content);

  const dueDateLabel = formatDueDateForLabel(task.dueDate);
  const completedDateLabel = task.completed ? formatCompletedDateForLabel(task.completedAt) : "";
  if (completedDateLabel && !dueDateLabel) {
    article.classList.add("is-no-due-date");
  }
  if (dueDateLabel || completedDateLabel) {
    body.classList.add("has-meta");
    const meta = document.createElement("div");
    meta.className = "task-item-meta";

    if (dueDateLabel) {
      const dueDate = document.createElement("p");
      dueDate.className = "task-item-date-badge task-item-due-date";
      dueDate.textContent = `Due ${dueDateLabel}`;
      meta.append(dueDate);
    }

    if (completedDateLabel) {
      const completedDate = document.createElement("p");
      completedDate.className = "task-item-date-badge task-item-completed-date";
      completedDate.textContent = `Done ${completedDateLabel}`;
      meta.append(completedDate);
    }

    body.append(meta);
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "task-delete";
  deleteButton.dataset.action = "delete-task";
  deleteButton.setAttribute("aria-label", "Delete task");
  deleteButton.textContent = "×";

  row.append(toggleButton, body, deleteButton);
  article.append(row);
  return article;
}

export function renderTasks(container, tasks, options = {}) {
  container.innerHTML = "";

  if (!tasks.length) {
    renderEmptyState(container, options.emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();
  tasks.forEach((task) => {
    fragment.appendChild(createTaskElement(task));
  });
  container.appendChild(fragment);
}
