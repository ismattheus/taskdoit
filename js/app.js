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

  addTaskBtn.addEventListener("click", handleAddTask);
}

document.addEventListener("DOMContentLoaded", initApp);
