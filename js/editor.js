const ALLOWED_TAGS = new Set(["B", "I", "U", "BR", "STRONG", "EM", "P", "DIV"]);
const TAG_NORMALIZATION = {
  STRONG: "B",
  EM: "I",
  DIV: "P",
};

function sanitizeNode(node, documentRef) {
  if (node.nodeType === Node.TEXT_NODE) {
    return documentRef.createTextNode(node.textContent || "");
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return documentRef.createTextNode("");
  }

  const originalTag = node.tagName.toUpperCase();
  const normalizedTag = TAG_NORMALIZATION[originalTag] || originalTag;

  if (!ALLOWED_TAGS.has(originalTag)) {
    const passthrough = documentRef.createDocumentFragment();
    node.childNodes.forEach((child) => {
      passthrough.appendChild(sanitizeNode(child, documentRef));
    });
    return passthrough;
  }

  if (normalizedTag === "BR") {
    return documentRef.createElement("br");
  }

  const safeElement = documentRef.createElement(normalizedTag.toLowerCase());
  node.childNodes.forEach((child) => {
    safeElement.appendChild(sanitizeNode(child, documentRef));
  });
  return safeElement;
}

function sanitizeEditorHTML(html) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = parsed.body.firstElementChild;
  const safeRoot = document.createElement("div");

  if (!root) {
    return "";
  }

  root.childNodes.forEach((child) => {
    safeRoot.appendChild(sanitizeNode(child, document));
  });

  return safeRoot.innerHTML.trim();
}

function getTextFromHTML(html) {
  const temp = document.createElement("div");
  temp.innerHTML = html;
  return (temp.textContent || "").replace(/\u00a0/g, " ").trim();
}

function runFormatCommand(command) {
  document.execCommand(command, false);
}

function moveCaretToStart(editorEl) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  range.setStart(editorEl, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function syncEmptyState(editorEl) {
  const { plainText } = getEditorContent(editorEl);
  editorEl.dataset.empty = plainText.length === 0 ? "true" : "false";
}

export function initEditor(editorEl, toolbarEl) {
  if (!editorEl || !toolbarEl) {
    throw new Error("Editor and toolbar elements are required.");
  }

  // Keep text selection in the editor when clicking toolbar buttons (Safari/Chromium parity).
  toolbarEl.addEventListener("mousedown", (event) => {
    const button = event.target.closest("[data-format]");
    if (!button) {
      return;
    }
    event.preventDefault();
  });

  toolbarEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-format]");
    if (!button) {
      return;
    }

    const command = button.dataset.format;
    if (!command) {
      return;
    }

    editorEl.focus();
    runFormatCommand(command);
    syncEmptyState(editorEl);
  });

  editorEl.addEventListener("input", () => {
    syncEmptyState(editorEl);
    if (editorEl.dataset.empty === "true" && document.activeElement === editorEl) {
      moveCaretToStart(editorEl);
    }
  });

  editorEl.addEventListener("blur", () => {
    syncEmptyState(editorEl);
  });

  syncEmptyState(editorEl);
}

export function getEditorContent(editorEl) {
  const sanitizedHtml = sanitizeEditorHTML(editorEl.innerHTML);
  return {
    html: sanitizedHtml,
    plainText: getTextFromHTML(sanitizedHtml),
  };
}

export function isEditorEmpty(editorEl) {
  const { plainText } = getEditorContent(editorEl);
  return plainText.length === 0;
}

export function clearEditor(editorEl) {
  editorEl.innerHTML = "";
  editorEl.dataset.empty = "true";
}

export function focusEditor(editorEl) {
  editorEl.focus();

  // Ensure caret is visible at the start when the editor is empty.
  if (!isEditorEmpty(editorEl)) {
    return;
  }

  moveCaretToStart(editorEl);
}
