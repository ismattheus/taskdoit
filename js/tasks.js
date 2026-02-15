function createTaskId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createTask(contentHtml) {
  return {
    id: createTaskId(),
    contentHtml,
    createdAt: new Date().toISOString(),
    completed: false,
    completedAt: null,
    sourceType: "manual",
    projectId: null,
  };
}

function renderEmptyState(container) {
  container.innerHTML = `
    <article class="empty-state" data-empty-state>
      <h2>No tasks yet</h2>
      <p>Add your first task below.</p>
    </article>
  `;
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

export function renderTasks(container, tasks) {
  container.innerHTML = "";

  if (!tasks.length) {
    renderEmptyState(container);
    return;
  }

  const fragment = document.createDocumentFragment();
  tasks.forEach((task) => {
    fragment.appendChild(createTaskElement(task));
  });
  container.appendChild(fragment);
}
