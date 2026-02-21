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
const TASK_COMPLETE_ANIMATION_MS = 440;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_INPUT_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
const DUE_DATE_MONTH_NAME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  month: "long",
});
const DUE_DATE_MONTH_NAMES = Array.from({ length: 12 }, (_, monthIndex) =>
  DUE_DATE_MONTH_NAME_FORMATTER.format(new Date(2024, monthIndex, 1))
);
const DUE_DATE_YEAR_RANGE = 120;

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

function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const candidate = new Date(year, month - 1, day);
  return (
    candidate.getFullYear() === year &&
    candidate.getMonth() === month - 1 &&
    candidate.getDate() === day
  );
}

function toIsoDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toIsoDateFromLocalDate(date) {
  return toIsoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function parseIsoDate(isoDate) {
  if (typeof isoDate !== "string") {
    return null;
  }

  const match = isoDate.trim().match(ISO_DATE_PATTERN);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function normalizeDueDate(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) {
    return null;
  }

  return toIsoDateFromLocalDate(parsed);
}

function parseDueDateInput(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return {
      status: "empty",
      value: null,
    };
  }

  const match = raw.match(LOCAL_DATE_INPUT_PATTERN);
  if (!match) {
    return {
      status: "invalid",
      value: null,
    };
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (match[3].length === 2) {
    year += year >= 70 ? 1900 : 2000;
  }

  if (!isValidDateParts(year, month, day)) {
    return {
      status: "invalid",
      value: null,
    };
  }

  return {
    status: "valid",
    value: toIsoDate(year, month, day),
  };
}

function formatDueDateInput(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) {
    return "";
  }

  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
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
  const dueDate = normalizeDueDate(task.dueDate);
  const completed = task.completed === true;

  return {
    id: task.id,
    contentHtml: task.contentHtml,
    template,
    dueDate,
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
    composerDueDate: null,
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
      composerDueDate: null,
      activeFilter: FILTER_MODE_ALL,
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
  const filterPickerEl = document.getElementById("task-filter-picker");
  const filterToggleEl = document.getElementById("task-filter-toggle");
  const filterToggleLabelEl = document.getElementById("task-filter-toggle-label");
  const filterToggleCaretEl = document.getElementById("task-filter-toggle-caret");
  const filterMenuEl = document.getElementById("task-filter-menu");
  const filterOptionsEl = document.getElementById("task-filter-options");
  const completedTabToggleEl = document.getElementById("completed-tab-toggle");

  const templatePickerEl = document.getElementById("template-picker");
  const templateToggleEl = document.getElementById("template-toggle");
  const templateToggleLabelEl = document.getElementById("template-toggle-label");
  const templateToggleCaretEl = document.getElementById("template-toggle-caret");
  const templateMenuEl = document.getElementById("template-menu");
  const templateOptionsEl = document.getElementById("template-options");
  const templateAddTriggerEl = document.getElementById("template-add-trigger");
  const templateAddFormEl = document.getElementById("template-add-form");
  const templateAddInputEl = document.getElementById("template-add-input");
  const templateClearOptionEl = templateMenuEl?.querySelector(".template-option-clear");
  const dueDatePickerEl = document.getElementById("due-date-picker");
  const dueDateInputEl = document.getElementById("due-date-input");
  const dueDateToggleEl = document.getElementById("due-date-toggle");
  const dueDateMenuEl = document.getElementById("due-date-menu");
  const dueDateMonthToggleEl = document.getElementById("due-date-month-toggle");
  const dueDateMonthLabelEl = document.getElementById("due-date-month-label");
  const dueDateMonthMenuEl = document.getElementById("due-date-month-menu");
  const dueDateMonthToggleCaretEl = dueDateMonthToggleEl?.querySelector(".due-date-select-caret");
  const dueDateYearToggleEl = document.getElementById("due-date-year-toggle");
  const dueDateYearLabelEl = document.getElementById("due-date-year-label");
  const dueDateYearMenuEl = document.getElementById("due-date-year-menu");
  const dueDateYearToggleCaretEl = dueDateYearToggleEl?.querySelector(".due-date-select-caret");
  const dueDateGridEl = document.getElementById("due-date-grid");
  const filterAllOptionEl = filterMenuEl?.querySelector(`[data-filter-value="${FILTER_VALUE_ALL}"]`);
  const filterNoneOptionEl = filterMenuEl?.querySelector(`[data-filter-value="${FILTER_VALUE_NONE}"]`);

  if (
    !taskListEl ||
    !editorEl ||
    !composerEl ||
    !filterPickerEl ||
    !filterToggleEl ||
    !filterToggleLabelEl ||
    !filterToggleCaretEl ||
    !filterMenuEl ||
    !filterOptionsEl ||
    !filterAllOptionEl ||
    !filterNoneOptionEl ||
    !completedTabToggleEl ||
    !templatePickerEl ||
    !templateToggleEl ||
    !templateToggleLabelEl ||
    !templateToggleCaretEl ||
    !templateMenuEl ||
    !templateOptionsEl ||
    !templateAddTriggerEl ||
    !templateAddFormEl ||
    !templateAddInputEl ||
    !templateClearOptionEl ||
    !dueDatePickerEl ||
    !dueDateInputEl ||
    !dueDateToggleEl ||
    !dueDateMenuEl ||
    !dueDateMonthToggleEl ||
    !dueDateMonthLabelEl ||
    !dueDateMonthMenuEl ||
    !dueDateMonthToggleCaretEl ||
    !dueDateYearToggleEl ||
    !dueDateYearLabelEl ||
    !dueDateYearMenuEl ||
    !dueDateYearToggleCaretEl ||
    !dueDateGridEl
  ) {
    throw new Error("App could not initialize due to missing required DOM nodes.");
  }

  const state = loadState();
  let templateMenuOpen = false;
  let filterMenuOpen = false;
  let dueDateMenuOpen = false;
  let dueDateMonthMenuOpen = false;
  let dueDateYearMenuOpen = false;
  let dueDateViewDate = new Date();
  dueDateViewDate.setDate(1);
  let placementRafId = 0;
  const pendingCompletionTimers = new Map();
  state.composerDueDate = normalizeDueDate(state.composerDueDate);
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
    const maxVisibleRows = 5;
    const visibleRowCap =
      rowHeight * maxVisibleRows + optionRowGap * Math.max(0, maxVisibleRows - 1);
    const nextMaxHeight = Math.max(52, Math.floor(Math.min(availableHeight, visibleRowCap)));

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
    templateToggleCaretEl.textContent = isOpen ? "▾" : "▴";
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

  function updateFilterOptionsScrollArea() {
    if (filterOptionsEl.hidden) {
      filterOptionsEl.style.maxHeight = "";
      return;
    }

    const optionStyles = window.getComputedStyle(filterOptionsEl);
    const optionRowGap = parseFloat(optionStyles.rowGap || optionStyles.gap || "0") || 0;
    const rows = filterOptionsEl.querySelectorAll(".template-option-row");
    const rowCount = rows.length;
    if (rowCount === 0) {
      filterOptionsEl.style.maxHeight = "";
      return;
    }

    const firstRow = rows[0];
    const rowHeight = firstRow.getBoundingClientRect().height || 30;
    const maxVisibleRows = 5;
    const visibleRows = Math.min(maxVisibleRows, rowCount);
    const nextMaxHeight =
      rowHeight * visibleRows + optionRowGap * Math.max(0, visibleRows - 1);
    filterOptionsEl.style.maxHeight = `${Math.floor(nextMaxHeight)}px`;
  }

  function setFilterMenuOpen(isOpen) {
    filterMenuOpen = isOpen;
    filterMenuEl.hidden = !isOpen;
    filterToggleEl.setAttribute("aria-expanded", String(isOpen));
    filterToggleCaretEl.textContent = isOpen ? "▴" : "▾";
  }

  function setDueDateViewMonthFromValue(isoDate = null) {
    const parsed = isoDate ? parseIsoDate(isoDate) : null;
    const source = parsed || new Date();
    dueDateViewDate = new Date(source.getFullYear(), source.getMonth(), 1);
  }

  function scrollDueDateSelectToCurrentOption(menuEl) {
    const selectedOption = menuEl.querySelector(".due-date-select-option.is-selected");
    if (!selectedOption) {
      return;
    }
    selectedOption.scrollIntoView({ block: "nearest" });
  }

  function setDueDateMonthMenuOpen(isOpen) {
    dueDateMonthMenuOpen = isOpen;
    dueDateMonthMenuEl.hidden = !isOpen;
    dueDateMonthToggleEl.setAttribute("aria-expanded", String(isOpen));
    dueDateMonthToggleCaretEl.textContent = isOpen ? "▴" : "▾";
    if (isOpen) {
      dueDateYearMenuOpen = false;
      dueDateYearMenuEl.hidden = true;
      dueDateYearToggleEl.setAttribute("aria-expanded", "false");
      dueDateYearToggleCaretEl.textContent = "▾";
      scrollDueDateSelectToCurrentOption(dueDateMonthMenuEl);
    }
  }

  function setDueDateYearMenuOpen(isOpen) {
    dueDateYearMenuOpen = isOpen;
    dueDateYearMenuEl.hidden = !isOpen;
    dueDateYearToggleEl.setAttribute("aria-expanded", String(isOpen));
    dueDateYearToggleCaretEl.textContent = isOpen ? "▴" : "▾";
    if (isOpen) {
      dueDateMonthMenuOpen = false;
      dueDateMonthMenuEl.hidden = true;
      dueDateMonthToggleEl.setAttribute("aria-expanded", "false");
      dueDateMonthToggleCaretEl.textContent = "▾";
      scrollDueDateSelectToCurrentOption(dueDateYearMenuEl);
    }
  }

  function closeDueDateHeaderMenus() {
    dueDateMonthMenuOpen = false;
    dueDateYearMenuOpen = false;
    dueDateMonthMenuEl.hidden = true;
    dueDateYearMenuEl.hidden = true;
    dueDateMonthToggleEl.setAttribute("aria-expanded", "false");
    dueDateYearToggleEl.setAttribute("aria-expanded", "false");
    dueDateMonthToggleCaretEl.textContent = "▾";
    dueDateYearToggleCaretEl.textContent = "▾";
  }

  function renderDueDateCalendar() {
    dueDateMonthLabelEl.textContent = DUE_DATE_MONTH_NAMES[dueDateViewDate.getMonth()];
    dueDateMonthMenuEl.innerHTML = "";
    DUE_DATE_MONTH_NAMES.forEach((monthName, monthIndex) => {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "due-date-select-option";
      optionButton.dataset.action = "due-date-select-month";
      optionButton.dataset.monthValue = String(monthIndex);
      optionButton.textContent = monthName;
      if (monthIndex === dueDateViewDate.getMonth()) {
        optionButton.classList.add("is-selected");
      }
      dueDateMonthMenuEl.append(optionButton);
    });

    const viewYear = dueDateViewDate.getFullYear();
    dueDateYearLabelEl.textContent = String(viewYear);
    dueDateYearMenuEl.innerHTML = "";
    const yearStart = viewYear - DUE_DATE_YEAR_RANGE;
    const yearEnd = viewYear + DUE_DATE_YEAR_RANGE;
    for (let year = yearStart; year <= yearEnd; year += 1) {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "due-date-select-option";
      optionButton.dataset.action = "due-date-select-year";
      optionButton.dataset.yearValue = String(year);
      optionButton.textContent = String(year);
      if (year === viewYear) {
        optionButton.classList.add("is-selected");
      }
      dueDateYearMenuEl.append(optionButton);
    }
    if (dueDateMonthMenuOpen) {
      scrollDueDateSelectToCurrentOption(dueDateMonthMenuEl);
    }
    if (dueDateYearMenuOpen) {
      scrollDueDateSelectToCurrentOption(dueDateYearMenuEl);
    }

    dueDateGridEl.innerHTML = "";

    const firstDayOfMonth = new Date(dueDateViewDate.getFullYear(), dueDateViewDate.getMonth(), 1);
    const startWeekday = (firstDayOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(
      dueDateViewDate.getFullYear(),
      dueDateViewDate.getMonth() + 1,
      0
    ).getDate();
    const daysInPreviousMonth = new Date(
      dueDateViewDate.getFullYear(),
      dueDateViewDate.getMonth(),
      0
    ).getDate();

    const selectedDueDate = state.composerDueDate;
    const todayIsoDate = toIsoDateFromLocalDate(new Date());
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < 42; i += 1) {
      let monthOffset = 0;
      let dayNumber = 0;

      if (i < startWeekday) {
        monthOffset = -1;
        dayNumber = daysInPreviousMonth - startWeekday + i + 1;
      } else if (i >= startWeekday + daysInMonth) {
        monthOffset = 1;
        dayNumber = i - (startWeekday + daysInMonth) + 1;
      } else {
        dayNumber = i - startWeekday + 1;
      }

      const date = new Date(
        dueDateViewDate.getFullYear(),
        dueDateViewDate.getMonth() + monthOffset,
        dayNumber
      );
      const isoDate = toIsoDateFromLocalDate(date);

      const dayButton = document.createElement("button");
      dayButton.type = "button";
      dayButton.className = "due-date-day";
      if (monthOffset !== 0) {
        dayButton.classList.add("is-outside");
      }
      if (isoDate === todayIsoDate) {
        dayButton.classList.add("is-today");
      }
      if (selectedDueDate && isoDate === selectedDueDate) {
        dayButton.classList.add("is-selected");
      }
      dayButton.dataset.action = "due-date-select";
      dayButton.dataset.dueDateValue = isoDate;
      dayButton.textContent = String(date.getDate());
      dayButton.setAttribute("aria-label", formatDueDateInput(isoDate));
      fragment.append(dayButton);
    }

    dueDateGridEl.append(fragment);
  }

  function setDueDateMenuOpen(isOpen) {
    dueDateMenuOpen = isOpen;
    dueDateMenuEl.hidden = !isOpen;
    dueDateToggleEl.setAttribute("aria-expanded", String(isOpen));

    if (isOpen) {
      closeDueDateHeaderMenus();
      setDueDateViewMonthFromValue(state.composerDueDate);
      renderDueDateCalendar();
      return;
    }

    closeDueDateHeaderMenus();
  }

  function renderDueDateControl() {
    if (document.activeElement !== dueDateInputEl) {
      dueDateInputEl.value = state.composerDueDate ? formatDueDateInput(state.composerDueDate) : "";
    }

    dueDateToggleEl.setAttribute(
      "aria-label",
      state.composerDueDate
        ? `Open due date calendar. Current: ${formatDueDateInput(state.composerDueDate)}`
        : "Open due date calendar"
    );

    if (dueDateMenuOpen) {
      renderDueDateCalendar();
    }
  }

  function commitDueDateInputValue(rawValue) {
    const parsedValue = parseDueDateInput(rawValue);
    if (parsedValue.status === "invalid") {
      dueDateInputEl.setAttribute("aria-invalid", "true");
      dueDateInputEl.value = state.composerDueDate ? formatDueDateInput(state.composerDueDate) : "";
      return false;
    }

    state.composerDueDate = parsedValue.value;
    dueDateInputEl.setAttribute("aria-invalid", "false");
    dueDateInputEl.value = state.composerDueDate ? formatDueDateInput(state.composerDueDate) : "";

    if (state.composerDueDate) {
      setDueDateViewMonthFromValue(state.composerDueDate);
    }

    if (dueDateMenuOpen) {
      renderDueDateCalendar();
    }

    return true;
  }

  function renderFilterDropdown() {
    const resolvedActiveFilter = resolveActiveFilter(state.activeFilter, state.templates);
    const activeFilterValue = toFilterValue(resolvedActiveFilter);

    filterAllOptionEl.classList.toggle("is-selected", activeFilterValue === FILTER_VALUE_ALL);
    filterNoneOptionEl.classList.toggle("is-selected", activeFilterValue === FILTER_VALUE_NONE);

    filterOptionsEl.innerHTML = "";
    const fragment = document.createDocumentFragment();
    state.templates.forEach((templateName) => {
      const row = document.createElement("div");
      row.className = "template-option-row";

      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "template-option template-option-main";
      optionButton.dataset.action = "select-filter";
      optionButton.dataset.filterValue = `${FILTER_VALUE_TEMPLATE_PREFIX}${templateName}`;
      optionButton.textContent = templateName;
      if (activeFilterValue === optionButton.dataset.filterValue) {
        optionButton.classList.add("is-selected");
      }

      row.append(optionButton);
      fragment.append(row);
    });

    filterOptionsEl.append(fragment);
    filterOptionsEl.hidden = state.templates.length === 0;
    updateFilterOptionsScrollArea();

    const currentLabel =
      resolvedActiveFilter === FILTER_MODE_ALL
        ? "All"
        : resolvedActiveFilter === FILTER_MODE_NONE
          ? "No template"
          : resolvedActiveFilter;
    filterToggleLabelEl.textContent = currentLabel;
    filterToggleEl.setAttribute("aria-label", `Filter tasks by template. Current: ${currentLabel}`);
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
    if (isCompletedView && dueDateMenuOpen) {
      setDueDateMenuOpen(false);
    }

    renderTemplateDropdown();
    renderFilterDropdown();
    renderDueDateControl();

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
    const task = createTask(html, state.composerTemplate, state.composerDueDate);
    state.tasks.push(task);
    state.composerDueDate = null;
    dueDateInputEl.setAttribute("aria-invalid", "false");
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

      if (
        !existingTask.completed &&
        state.activeView === VIEW_MODE_TASKS &&
        !taskCard.classList.contains("is-completing")
      ) {
        const toggleButton = actionEl.closest(".task-toggle");
        if (toggleButton) {
          toggleButton.classList.add("is-complete");
          toggleButton.textContent = "✓";
          toggleButton.setAttribute("aria-pressed", "true");
          toggleButton.setAttribute("aria-label", "Mark as incomplete");
        }

        taskCard.classList.add("is-completing");
        const timerId = window.setTimeout(() => {
          pendingCompletionTimers.delete(taskId);
          const pendingTaskIndex = state.tasks.findIndex((task) => task.id === taskId);
          if (pendingTaskIndex === -1) {
            return;
          }

          const pendingTask = state.tasks[pendingTaskIndex];
          state.tasks[pendingTaskIndex] = {
            ...pendingTask,
            completed: true,
            completedAt: new Date().toISOString(),
          };
          saveState(state);
          renderApp();
        }, TASK_COMPLETE_ANIMATION_MS);
        pendingCompletionTimers.set(taskId, timerId);
        return;
      }

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
      const pendingTimerId = pendingCompletionTimers.get(taskId);
      if (pendingTimerId) {
        window.clearTimeout(pendingTimerId);
        pendingCompletionTimers.delete(taskId);
      }
      state.tasks.splice(taskIndex, 1);
      saveState(state);
      renderApp();
    }
  }

  function handleFilterMenuAction(event) {
    const actionEl = event.target.closest("[data-action='select-filter']");
    if (!actionEl) {
      return;
    }

    const selectedFilter = fromFilterValue(actionEl.dataset.filterValue || FILTER_VALUE_ALL, state.templates);
    state.activeFilter = selectedFilter;
    saveState(state);
    renderApp();
    setFilterMenuOpen(false);
    filterToggleEl.focus();
  }

  function handleFilterToggleClick() {
    if (templateMenuOpen) {
      setTemplateMenuOpen(false);
    }
    if (dueDateMenuOpen) {
      setDueDateMenuOpen(false);
    }
    setFilterMenuOpen(!filterMenuOpen);
  }

  function handleDueDateToggleClick() {
    if (templateMenuOpen) {
      setTemplateMenuOpen(false);
    }
    if (filterMenuOpen) {
      setFilterMenuOpen(false);
    }

    const shouldOpen = !dueDateMenuOpen;
    setDueDateMenuOpen(shouldOpen);
    if (shouldOpen) {
      dueDateInputEl.focus();
    }
  }

  function handleDueDateInputFocus() {
    if (templateMenuOpen) {
      setTemplateMenuOpen(false);
    }
    if (filterMenuOpen) {
      setFilterMenuOpen(false);
    }
    setDueDateMenuOpen(true);
  }

  function handleDueDateInputBlur(event) {
    const nextFocusedEl = event.relatedTarget;
    if (nextFocusedEl && dueDatePickerEl.contains(nextFocusedEl)) {
      return;
    }
    commitDueDateInputValue(dueDateInputEl.value);
    renderDueDateControl();
  }

  function handleDueDateInputKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDueDateInputValue(dueDateInputEl.value);
      setDueDateMenuOpen(false);
      focusEditor(editorEl);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setDueDateMenuOpen(true);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setDueDateMenuOpen(false);
      dueDateInputEl.value = state.composerDueDate ? formatDueDateInput(state.composerDueDate) : "";
      dueDateInputEl.setAttribute("aria-invalid", "false");
      focusEditor(editorEl);
    }
  }

  function handleDueDateMenuAction(event) {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) {
      return;
    }

    const action = actionEl.dataset.action;
    if (action === "due-date-toggle-month-menu") {
      setDueDateMonthMenuOpen(!dueDateMonthMenuOpen);
      return;
    }

    if (action === "due-date-toggle-year-menu") {
      setDueDateYearMenuOpen(!dueDateYearMenuOpen);
      return;
    }

    if (action === "due-date-select-month") {
      const month = Number(actionEl.dataset.monthValue);
      if (!Number.isInteger(month) || month < 0 || month > 11) {
        return;
      }
      dueDateViewDate = new Date(dueDateViewDate.getFullYear(), month, 1);
      setDueDateMonthMenuOpen(false);
      renderDueDateCalendar();
      return;
    }

    if (action === "due-date-select-year") {
      const year = Number(actionEl.dataset.yearValue);
      if (!Number.isInteger(year) || year < 1 || year > 9999) {
        return;
      }
      dueDateViewDate = new Date(year, dueDateViewDate.getMonth(), 1);
      setDueDateYearMenuOpen(false);
      renderDueDateCalendar();
      return;
    }

    if (dueDateMonthMenuOpen || dueDateYearMenuOpen) {
      closeDueDateHeaderMenus();
    }

    if (action === "due-date-prev-month" || action === "due-date-next-month") {
      const monthOffset = action === "due-date-prev-month" ? -1 : 1;
      dueDateViewDate = new Date(
        dueDateViewDate.getFullYear(),
        dueDateViewDate.getMonth() + monthOffset,
        1
      );
      renderDueDateCalendar();
      return;
    }

    if (action === "due-date-today") {
      state.composerDueDate = toIsoDateFromLocalDate(new Date());
      dueDateInputEl.value = formatDueDateInput(state.composerDueDate);
      dueDateInputEl.setAttribute("aria-invalid", "false");
      setDueDateViewMonthFromValue(state.composerDueDate);
      setDueDateMenuOpen(false);
      renderDueDateControl();
      focusEditor(editorEl);
      return;
    }

    if (action === "due-date-select") {
      const selectedDueDate = normalizeDueDate(actionEl.dataset.dueDateValue);
      if (!selectedDueDate) {
        return;
      }
      state.composerDueDate = selectedDueDate;
      dueDateInputEl.value = formatDueDateInput(state.composerDueDate);
      dueDateInputEl.setAttribute("aria-invalid", "false");
      setDueDateMenuOpen(false);
      renderDueDateControl();
      focusEditor(editorEl);
    }
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
    if (filterMenuOpen) {
      setFilterMenuOpen(false);
    }
    if (dueDateMenuOpen) {
      setDueDateMenuOpen(false);
    }
    setTemplateMenuOpen(!templateMenuOpen);
  }

  function handleHeaderDropdownOutsidePointerDown(event) {
    if (templateMenuOpen && !templatePickerEl.contains(event.target)) {
      setTemplateMenuOpen(false);
    }

    if (filterMenuOpen && !filterPickerEl.contains(event.target)) {
      setFilterMenuOpen(false);
    }

    if (dueDateMenuOpen && !dueDatePickerEl.contains(event.target)) {
      setDueDateMenuOpen(false);
    }
  }

  function handleViewportResize() {
    if (templateMenuOpen) {
      scheduleTemplateMenuPlacement();
    }

    if (filterMenuOpen) {
      updateFilterOptionsScrollArea();
    }
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

  function handleHeaderDropdownKeydown(event) {
    if (event.key !== "Escape") {
      return;
    }

    if (dueDateMenuOpen) {
      event.preventDefault();
      if (dueDateMonthMenuOpen || dueDateYearMenuOpen) {
        closeDueDateHeaderMenus();
        return;
      }
      setDueDateMenuOpen(false);
      dueDateInputEl.focus();
      return;
    }

    if (templateMenuOpen) {
      event.preventDefault();
      setTemplateMenuOpen(false);
      templateToggleEl.focus();
      return;
    }

    if (filterMenuOpen) {
      event.preventDefault();
      setFilterMenuOpen(false);
      filterToggleEl.focus();
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

  initEditor(editorEl);
  renderApp();
  if (state.activeView === VIEW_MODE_TASKS) {
    focusEditor(editorEl);
  }

  editorEl.addEventListener("keydown", handleEditorKeydown);
  taskListEl.addEventListener("click", handleTaskActionClick);
  completedTabToggleEl.addEventListener("click", handleCompletedTabToggle);
  filterToggleEl.addEventListener("click", handleFilterToggleClick);
  filterMenuEl.addEventListener("click", handleFilterMenuAction);
  dueDateToggleEl.addEventListener("click", handleDueDateToggleClick);
  dueDateInputEl.addEventListener("focus", handleDueDateInputFocus);
  dueDateInputEl.addEventListener("blur", handleDueDateInputBlur);
  dueDateInputEl.addEventListener("keydown", handleDueDateInputKeydown);
  dueDateMenuEl.addEventListener("click", handleDueDateMenuAction);
  templateToggleEl.addEventListener("click", handleTemplateToggleClick);
  templateMenuEl.addEventListener("click", handleTemplateMenuAction);
  templateAddFormEl.addEventListener("submit", handleTemplateAddSubmit);
  templateAddInputEl.addEventListener("keydown", handleTemplateAddInputKeydown);
  document.addEventListener("pointerdown", handleHeaderDropdownOutsidePointerDown);
  document.addEventListener("keydown", handleHeaderDropdownKeydown);
  window.addEventListener("resize", handleViewportResize);
  window.addEventListener("scroll", handleDocumentScroll, true);
}

document.addEventListener("DOMContentLoaded", initApp);
