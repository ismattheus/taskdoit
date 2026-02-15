function formatTimestamp(dateString) {
  const date = new Date(dateString);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  article.dataset.taskId = task.id;

  const content = document.createElement("div");
  content.className = "task-item-content";
  content.innerHTML = task.contentHtml;

  const meta = document.createElement("p");
  meta.className = "task-item-meta";
  meta.textContent = `Added ${formatTimestamp(task.createdAt)}`;

  article.append(content, meta);
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
