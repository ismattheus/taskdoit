import {
  clearEditor,
  focusEditor,
  getEditorContent,
  initEditor,
  isEditorEmpty,
} from "./editor.js";
import { createTask, renderTasks } from "./tasks.js";

function initApp() {
  const taskListEl = document.getElementById("task-list");
  const editorEl = document.getElementById("editor");
  const addTaskBtn = document.getElementById("add-task");
  const toolbarEl = document.querySelector(".format-toolbar");

  if (!taskListEl || !editorEl || !addTaskBtn || !toolbarEl) {
    throw new Error("App could not initialize due to missing required DOM nodes.");
  }

  const state = {
    tasks: [],
  };

  initEditor(editorEl, toolbarEl);
  renderTasks(taskListEl, state.tasks);
  focusEditor(editorEl);

  function handleAddTask() {
    if (isEditorEmpty(editorEl)) {
      focusEditor(editorEl);
      return;
    }

    const { html } = getEditorContent(editorEl);
    const task = createTask(html);
    state.tasks.unshift(task);
    renderTasks(taskListEl, state.tasks);
    clearEditor(editorEl);
    focusEditor(editorEl);
  }

  function handleTaskActionClick(event) {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) {
      return;
    }

    const taskCard = actionEl.closest(".task-item");
    if (!taskCard) {
      return;
    }

    const taskId = taskCard.dataset.taskId;
    if (!taskId) {
      return;
    }

    const taskIndex = state.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex === -1) {
      return;
    }

    const action = actionEl.dataset.action;
    if (action === "toggle-complete") {
      const existingTask = state.tasks[taskIndex];
      const completed = !existingTask.completed;
      state.tasks[taskIndex] = {
        ...existingTask,
        completed,
        completedAt: completed ? new Date().toISOString() : null,
      };
      renderTasks(taskListEl, state.tasks);
      return;
    }

    if (action === "delete-task") {
      state.tasks.splice(taskIndex, 1);
      renderTasks(taskListEl, state.tasks);
    }
  }

  addTaskBtn.addEventListener("click", handleAddTask);
  taskListEl.addEventListener("click", handleTaskActionClick);
}

document.addEventListener("DOMContentLoaded", initApp);
