function createTaskId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createTask(contentHtml, template = null) {
  const normalizedTemplate =
    typeof template === "string" && template.trim().length > 0 ? template.trim() : null;

  return {
    id: createTaskId(),
    contentHtml,
    template: normalizedTemplate,
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

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "task-delete";
  deleteButton.dataset.action = "delete-task";
  deleteButton.setAttribute("aria-label", "Delete task");
  deleteButton.textContent = "×";

  row.append(toggleButton, content, deleteButton);
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
