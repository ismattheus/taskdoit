import {
  clearEditor,
  focusEditor,
  getEditorContent,
  initEditor,
  isEditorEmpty,
} from "./editor.js";
import { createTask, renderTasks } from "./tasks.js";

const STORAGE_KEY = "taskdoit.state.v1";
const STORAGE_VERSION = 2;
const LEGACY_AUTO_TEMPLATE = "GENERAL";
const TEMPLATE_NAME_MAX_LENGTH = 32;
const FILTER_MODE_ALL = "all";
const FILTER_MODE_NONE = "none";
const FILTER_VALUE_ALL = "__all__";
const FILTER_VALUE_NONE = "__none__";
const FILTER_VALUE_TEMPLATE_PREFIX = "__tpl__:";
const VIEW_MODE_TASKS = "tasks";
const VIEW_MODE_COMPLETED = "completed";

function sanitizeTemplateName(value) {
  if (typeof value !== "string") {
    return "";
  }

  const withoutBrackets = value.replace(/\[/g, " ").replace(/\]/g, " ");
  const collapsed = withoutBrackets.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, TEMPLATE_NAME_MAX_LENGTH);
}

function getTemplateKey(templateName) {
  return templateName.toLocaleLowerCase();
}

function findTemplateValue(templates, candidate) {
  const cleaned = sanitizeTemplateName(candidate);
  if (!cleaned) {
    return null;
  }

  const candidateKey = getTemplateKey(cleaned);
  return templates.find((templateName) => getTemplateKey(templateName) === candidateKey) || null;
}

function pushUniqueTemplate(templates, candidate) {
  const cleaned = sanitizeTemplateName(candidate);
  if (!cleaned) {
    return null;
  }

  const existing = findTemplateValue(templates, cleaned);
  if (existing) {
    return existing;
  }

  templates.push(cleaned);
  return cleaned;
}

function sanitizeTask(task, templates, options = {}) {
  if (!task || typeof task !== "object") {
    return null;
  }

  if (typeof task.id !== "string" || task.id.trim().length === 0) {
    return null;
  }

  if (typeof task.contentHtml !== "string" || task.contentHtml.trim().length === 0) {
    return null;
  }

  let template =
    typeof task.template === "string" ? sanitizeTemplateName(task.template) : null;
  if (template && options.stripLegacyGeneral && getTemplateKey(template) === getTemplateKey(LEGACY_AUTO_TEMPLATE)) {
    template = null;
  }
  if (template) {
    template = pushUniqueTemplate(templates, template);
  }
  const completed = task.completed === true;

  return {
    id: task.id,
    contentHtml: task.contentHtml,
    template,
    createdAt: typeof task.createdAt === "string" ? task.createdAt : new Date().toISOString(),
    completed,
    completedAt: completed && typeof task.completedAt === "string" ? task.completedAt : null,
    sourceType: "manual",
    projectId: null,
  };
}

function resolveActiveFilter(activeFilter, templates) {
  if (activeFilter === FILTER_MODE_ALL || activeFilter === FILTER_MODE_NONE) {
    return activeFilter;
  }

  const template = findTemplateValue(templates, activeFilter);
  return template || FILTER_MODE_ALL;
}

function resolveActiveView(activeView) {
  return activeView === VIEW_MODE_COMPLETED ? VIEW_MODE_COMPLETED : VIEW_MODE_TASKS;
}

function toFilterValue(activeFilter) {
  if (activeFilter === FILTER_MODE_ALL) {
    return FILTER_VALUE_ALL;
  }

  if (activeFilter === FILTER_MODE_NONE) {
    return FILTER_VALUE_NONE;
  }

  return `${FILTER_VALUE_TEMPLATE_PREFIX}${activeFilter}`;
}

function fromFilterValue(filterValue, templates) {
  if (filterValue === FILTER_VALUE_ALL) {
    return FILTER_MODE_ALL;
  }

  if (filterValue === FILTER_VALUE_NONE) {
    return FILTER_MODE_NONE;
  }

  if (!filterValue.startsWith(FILTER_VALUE_TEMPLATE_PREFIX)) {
    return FILTER_MODE_ALL;
  }

  const templateName = filterValue.slice(FILTER_VALUE_TEMPLATE_PREFIX.length);
  return findTemplateValue(templates, templateName) || FILTER_MODE_ALL;
}

function loadState() {
  const fallback = {
    tasks: [],
    templates: [],
    composerTemplate: null,
    activeFilter: FILTER_MODE_ALL,
    activeView: VIEW_MODE_TASKS,
  };

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    const isLegacyData = parsed.version !== STORAGE_VERSION;
    const templates = [];

    if (Array.isArray(parsed.templates)) {
      parsed.templates.forEach((templateName) => {
        const cleaned = sanitizeTemplateName(templateName);
        if (!cleaned) {
          return;
        }
        if (isLegacyData && getTemplateKey(cleaned) === getTemplateKey(LEGACY_AUTO_TEMPLATE)) {
          return;
        }
        pushUniqueTemplate(templates, templateName);
      });
    }

    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks
          .map((task) => sanitizeTask(task, templates, { stripLegacyGeneral: isLegacyData }))
          .filter((task) => task !== null)
      : [];

    return {
      tasks,
      templates,
      composerTemplate: null,
      activeFilter: resolveActiveFilter(
        isLegacyData &&
          getTemplateKey(sanitizeTemplateName(parsed.activeFilter || "")) ===
            getTemplateKey(LEGACY_AUTO_TEMPLATE)
          ? FILTER_MODE_ALL
          : parsed.activeFilter,
        templates
      ),
      activeView: resolveActiveView(parsed.activeView),
    };
  } catch {
    return fallback;
  }
}

function saveState(state) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        tasks: state.tasks,
        templates: state.templates,
        activeFilter: state.activeFilter,
        activeView: state.activeView,
      })
    );
  } catch {
    // Ignore persistence failures so the app remains usable.
  }
}

function fillFilterSelect(selectEl, templates, activeFilter) {
  selectEl.innerHTML = "";
  const fragment = document.createDocumentFragment();

  const allOption = document.createElement("option");
  allOption.value = FILTER_VALUE_ALL;
  allOption.textContent = "All";
  fragment.append(allOption);

  const noneOption = document.createElement("option");
  noneOption.value = FILTER_VALUE_NONE;
  noneOption.textContent = "No template";
  fragment.append(noneOption);

  templates.forEach((templateName) => {
    const option = document.createElement("option");
    option.value = `${FILTER_VALUE_TEMPLATE_PREFIX}${templateName}`;
    option.textContent = templateName;
    fragment.append(option);
  });

  selectEl.append(fragment);
  selectEl.value = toFilterValue(resolveActiveFilter(activeFilter, templates));
}

function getTasksForActiveView(state) {
  if (state.activeView === VIEW_MODE_COMPLETED) {
    return state.tasks.filter((task) => task.completed);
  }

  return state.tasks.filter((task) => !task.completed);
}

function getVisibleTasks(state) {
  const tabTasks = getTasksForActiveView(state);
  if (state.activeFilter === FILTER_MODE_ALL) {
    return tabTasks;
  }

  if (state.activeFilter === FILTER_MODE_NONE) {
    return tabTasks.filter(
      (task) => !(typeof task.template === "string" && task.template.trim().length > 0)
    );
  }

  return tabTasks.filter((task) => task.template === state.activeFilter);
}

function getEmptyState(state, visibleTasks) {
  if (state.activeView === VIEW_MODE_COMPLETED && visibleTasks.length === 0) {
    return {
      title: "No completed tasks yet",
      copy: "",
    };
  }

  const tabTasks = getTasksForActiveView(state);
  if (tabTasks.length === 0) {
    return null;
  }

  if (state.activeFilter === FILTER_MODE_NONE && visibleTasks.length === 0) {
    return {
      title: "No untemplated tasks",
      copy: "Create a task without a template or switch filter.",
    };
  }

  if (state.activeFilter !== FILTER_MODE_ALL && visibleTasks.length === 0) {
    return {
      title: `No ${state.activeFilter} tasks`,
      copy: "Create a task with this template or switch filter.",
    };
  }

  return null;
}

function deleteTemplateFromState(state, templateName) {
  const template = findTemplateValue(state.templates, templateName);
  if (!template) {
    return;
  }

  const templateKey = getTemplateKey(template);
  state.templates = state.templates.filter(
    (existingTemplate) => getTemplateKey(existingTemplate) !== templateKey
  );
  state.tasks = state.tasks.map((task) => {
    if (typeof task.template !== "string") {
      return task;
    }

    if (getTemplateKey(task.template) !== templateKey) {
      return task;
    }

    return {
      ...task,
      template: null,
    };
  });

  if (state.composerTemplate && getTemplateKey(state.composerTemplate) === templateKey) {
    state.composerTemplate = null;
  }

  if (state.activeFilter !== FILTER_MODE_ALL && state.activeFilter !== FILTER_MODE_NONE) {
    if (getTemplateKey(state.activeFilter) === templateKey) {
      state.activeFilter = FILTER_MODE_ALL;
    }
  }
}

function initApp() {
  const taskListEl = document.getElementById("task-list");
  const editorEl = document.getElementById("editor");
  const composerEl = document.querySelector(".composer");
  const toolbarEl = document.querySelector(".format-toolbar");
  const filterSelectEl = document.getElementById("task-filter");
  const completedTabToggleEl = document.getElementById("completed-tab-toggle");

  const templatePickerEl = document.getElementById("template-picker");
  const templateToggleEl = document.getElementById("template-toggle");
  const templateToggleLabelEl = document.getElementById("template-toggle-label");
  const templateMenuEl = document.getElementById("template-menu");
  const templateOptionsEl = document.getElementById("template-options");
  const templateAddTriggerEl = document.getElementById("template-add-trigger");
  const templateAddFormEl = document.getElementById("template-add-form");
  const templateAddInputEl = document.getElementById("template-add-input");
  const templateClearOptionEl = templateMenuEl?.querySelector(".template-option-clear");

  if (
    !taskListEl ||
    !editorEl ||
    !composerEl ||
    !toolbarEl ||
    !filterSelectEl ||
    !completedTabToggleEl ||
    !templatePickerEl ||
    !templateToggleEl ||
    !templateToggleLabelEl ||
    !templateMenuEl ||
    !templateOptionsEl ||
    !templateAddTriggerEl ||
    !templateAddFormEl ||
    !templateAddInputEl ||
    !templateClearOptionEl
  ) {
    throw new Error("App could not initialize due to missing required DOM nodes.");
  }

  const state = loadState();
  let templateMenuOpen = false;
  let placementRafId = 0;
  saveState(state);

  function resetTemplateMenuPlacement() {
    templateMenuEl.classList.remove("is-open-up", "is-open-down", "is-side-right", "is-side-left");
    templateMenuEl.style.maxHeight = "";
    templateOptionsEl.style.maxHeight = "";
  }

  function updateTemplateOptionsScrollArea() {
    const visibleChildren = Array.from(templateMenuEl.children).filter((child) => !child.hidden);
    const nonListChildren = visibleChildren.filter((child) => child !== templateOptionsEl);
    const menuStyles = window.getComputedStyle(templateMenuEl);
    const menuRowGap = parseFloat(menuStyles.rowGap || menuStyles.gap || "0") || 0;
    const siblingHeights = nonListChildren.reduce(
      (sum, child) => sum + child.getBoundingClientRect().height,
      0
    );
    const availableHeight =
      templateMenuEl.clientHeight -
      siblingHeights -
      menuRowGap * Math.max(0, visibleChildren.length - 1);

    const optionStyles = window.getComputedStyle(templateOptionsEl);
    const optionRowGap = parseFloat(optionStyles.rowGap || optionStyles.gap || "0") || 0;
    const firstRow = templateOptionsEl.querySelector(".template-option-row");
    const rowHeight = firstRow ? firstRow.getBoundingClientRect().height : 30;
    const maxVisibleRows = 6;
    const sixRowCap =
      rowHeight * maxVisibleRows + optionRowGap * Math.max(0, maxVisibleRows - 1);
    const nextMaxHeight = Math.max(56, Math.floor(Math.min(availableHeight, sixRowCap)));

    templateOptionsEl.style.maxHeight = `${nextMaxHeight}px`;
  }

  function updateTemplateMenuPlacement() {
    if (!templateMenuOpen) {
      return;
    }

    resetTemplateMenuPlacement();

    const viewportPadding = 10;
    const toggleRect = templateToggleEl.getBoundingClientRect();
    const menuRect = templateMenuEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const spaceBelow = viewportHeight - toggleRect.bottom - viewportPadding;
    const spaceAbove = toggleRect.top - viewportPadding;
    const spaceRight = viewportWidth - toggleRect.right - viewportPadding;
    const spaceLeft = toggleRect.left - viewportPadding;

    const menuHeight = menuRect.height;
    const menuWidth = menuRect.width;

    const canOpenRight = spaceRight >= Math.max(180, menuWidth * 0.72);
    const canOpenLeft = spaceLeft >= Math.max(180, menuWidth * 0.72);
    const canOpenBelow = spaceBelow >= Math.max(150, menuHeight * 0.55);
    const canOpenAbove = spaceAbove >= Math.max(150, menuHeight * 0.55);

    let maxHeight = Math.max(140, Math.min(320, spaceAbove));

    if (!canOpenAbove && canOpenBelow) {
      templateMenuEl.classList.add("is-open-down");
      maxHeight = Math.max(140, Math.min(320, spaceBelow));
    } else if (!canOpenAbove && !canOpenBelow && (canOpenRight || canOpenLeft)) {
      if (canOpenRight) {
        templateMenuEl.classList.add("is-side-right");
      } else {
        templateMenuEl.classList.add("is-side-left");
      }
      maxHeight = Math.max(140, Math.min(360, viewportHeight - toggleRect.top - viewportPadding));
    } else if (!canOpenAbove && !canOpenBelow) {
      maxHeight = Math.max(140, Math.min(320, viewportHeight - viewportPadding * 2));
    }

    templateMenuEl.style.maxHeight = `${Math.floor(maxHeight)}px`;
    updateTemplateOptionsScrollArea();
  }

  function scheduleTemplateMenuPlacement() {
    if (!templateMenuOpen) {
      return;
    }

    if (placementRafId) {
      window.cancelAnimationFrame(placementRafId);
    }

    placementRafId = window.requestAnimationFrame(() => {
      placementRafId = 0;
      updateTemplateMenuPlacement();
    });
  }

  function setTemplateMenuOpen(isOpen) {
    templateMenuOpen = isOpen;
    templateMenuEl.hidden = !isOpen;
    templateToggleEl.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      scheduleTemplateMenuPlacement();
    } else {
      hideTemplateInput();
      resetTemplateMenuPlacement();
      if (placementRafId) {
        window.cancelAnimationFrame(placementRafId);
        placementRafId = 0;
      }
    }
  }

  function showTemplateInput() {
    templateAddTriggerEl.hidden = true;
    templateAddFormEl.hidden = false;
    templateAddInputEl.value = "";
    templateAddInputEl.focus();
    scheduleTemplateMenuPlacement();
  }

  function hideTemplateInput() {
    templateAddFormEl.hidden = true;
    templateAddTriggerEl.hidden = false;
    templateAddInputEl.value = "";
    scheduleTemplateMenuPlacement();
  }

  function renderTemplateDropdown() {
    templateToggleLabelEl.textContent = state.composerTemplate || "No template";
    templateClearOptionEl.classList.toggle("is-selected", !state.composerTemplate);

    templateOptionsEl.innerHTML = "";
    const fragment = document.createDocumentFragment();

    state.templates.forEach((templateName) => {
      const row = document.createElement("div");
      row.className = "template-option-row";

      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "template-option template-option-main";
      if (state.composerTemplate === templateName) {
        optionButton.classList.add("is-selected");
      }
      optionButton.dataset.action = "select-template";
      optionButton.dataset.templateValue = templateName;
      optionButton.textContent = templateName;

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "template-delete";
      deleteButton.dataset.action = "delete-template";
      deleteButton.dataset.templateValue = templateName;
      deleteButton.setAttribute("aria-label", `Delete template ${templateName}`);
      deleteButton.textContent = "×";

      row.append(optionButton, deleteButton);
      fragment.append(row);
    });

    templateOptionsEl.append(fragment);
    scheduleTemplateMenuPlacement();
  }

  function renderApp() {
    const isCompletedView = state.activeView === VIEW_MODE_COMPLETED;
    completedTabToggleEl.classList.toggle("is-active", isCompletedView);
    completedTabToggleEl.textContent = isCompletedView ? "Tasks" : "Completed";
    completedTabToggleEl.setAttribute(
      "aria-label",
      isCompletedView ? "Back to active tasks" : "Open completed tasks"
    );
    composerEl.classList.toggle("is-hidden", isCompletedView);
    if (isCompletedView && templateMenuOpen) {
      setTemplateMenuOpen(false);
    }

    renderTemplateDropdown();
    fillFilterSelect(filterSelectEl, state.templates, state.activeFilter);

    const visibleTasks = getVisibleTasks(state);
    const emptyState = getEmptyState(state, visibleTasks);
    renderTasks(taskListEl, visibleTasks, { emptyState });
  }

  function handleAddTask() {
    if (state.activeView !== VIEW_MODE_TASKS) {
      return;
    }

    if (isEditorEmpty(editorEl)) {
      focusEditor(editorEl);
      return;
    }

    const { html } = getEditorContent(editorEl);
    const task = createTask(html, state.composerTemplate);
    state.tasks.unshift(task);
    saveState(state);

    renderApp();
    clearEditor(editorEl);
    focusEditor(editorEl);
  }

  function handleEditorKeydown(event) {
    if (event.key !== "Enter") {
      return;
    }

    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    event.preventDefault();
    handleAddTask();
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
      saveState(state);
      renderApp();
      return;
    }

    if (action === "delete-task") {
      state.tasks.splice(taskIndex, 1);
      saveState(state);
      renderApp();
    }
  }

  function handleFilterChange(event) {
    const selectedFilter = fromFilterValue(event.target.value, state.templates);
    state.activeFilter = selectedFilter;
    saveState(state);
    renderApp();
  }

  function handleCompletedTabToggle() {
    state.activeView =
      state.activeView === VIEW_MODE_COMPLETED ? VIEW_MODE_TASKS : VIEW_MODE_COMPLETED;
    saveState(state);
    renderApp();

    if (state.activeView === VIEW_MODE_TASKS) {
      focusEditor(editorEl);
      return;
    }

    editorEl.blur();
  }

  function handleTemplateMenuAction(event) {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) {
      return;
    }

    const action = actionEl.dataset.action;
    if (action === "start-add-template") {
      showTemplateInput();
      return;
    }

    if (action === "select-template") {
      const value = actionEl.dataset.templateValue || "";
      state.composerTemplate = value ? findTemplateValue(state.templates, value) : null;
      saveState(state);
      renderApp();
      setTemplateMenuOpen(false);
      focusEditor(editorEl);
      return;
    }

    if (action === "delete-template") {
      const value = actionEl.dataset.templateValue || "";
      deleteTemplateFromState(state, value);
      saveState(state);
      renderApp();
      setTemplateMenuOpen(true);
    }
  }

  function handleTemplateAddSubmit(event) {
    event.preventDefault();
    const templateName = sanitizeTemplateName(templateAddInputEl.value);
    if (!templateName) {
      templateAddInputEl.focus();
      return;
    }

    const resolvedTemplate = pushUniqueTemplate(state.templates, templateName);
    state.composerTemplate = resolvedTemplate;
    saveState(state);

    renderApp();
    setTemplateMenuOpen(true);
    templateAddInputEl.value = "";
    templateAddInputEl.focus();
  }

  function handleTemplateToggleClick() {
    setTemplateMenuOpen(!templateMenuOpen);
  }

  function handleTemplatePickerOutsidePointerDown(event) {
    if (!templateMenuOpen) {
      return;
    }

    if (templatePickerEl.contains(event.target)) {
      return;
    }

    setTemplateMenuOpen(false);
  }

  function handleViewportResize() {
    if (!templateMenuOpen) {
      return;
    }

    scheduleTemplateMenuPlacement();
  }

  function handleDocumentScroll(event) {
    if (!templateMenuOpen) {
      return;
    }

    if (event?.target && templatePickerEl.contains(event.target)) {
      return;
    }

    scheduleTemplateMenuPlacement();
  }

  function handleTemplatePickerKeydown(event) {
    if (!templateMenuOpen) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setTemplateMenuOpen(false);
      templateToggleEl.focus();
    }
  }

  function handleTemplateAddInputKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    hideTemplateInput();
    templateToggleEl.focus();
  }

  initEditor(editorEl, toolbarEl);
  renderApp();
  if (state.activeView === VIEW_MODE_TASKS) {
    focusEditor(editorEl);
  }

  editorEl.addEventListener("keydown", handleEditorKeydown);
  taskListEl.addEventListener("click", handleTaskActionClick);
  completedTabToggleEl.addEventListener("click", handleCompletedTabToggle);
  filterSelectEl.addEventListener("change", handleFilterChange);
  templateToggleEl.addEventListener("click", handleTemplateToggleClick);
  templateMenuEl.addEventListener("click", handleTemplateMenuAction);
  templateAddFormEl.addEventListener("submit", handleTemplateAddSubmit);
  templateAddInputEl.addEventListener("keydown", handleTemplateAddInputKeydown);
  document.addEventListener("pointerdown", handleTemplatePickerOutsidePointerDown);
  document.addEventListener("keydown", handleTemplatePickerKeydown);
  window.addEventListener("resize", handleViewportResize);
  window.addEventListener("scroll", handleDocumentScroll, true);
}

document.addEventListener("DOMContentLoaded", initApp);
