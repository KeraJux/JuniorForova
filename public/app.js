import { readNotes, saveNote, deleteNote } from "./notes.js";

const nativeApp = Boolean(window.Capacitor?.isNativePlatform());
const apiBase = window.STUDY_API_URL || "";
const backendMissing = nativeApp && !apiBase;
let notes = [];
try {
  notes = readNotes(localStorage);
} catch {
  /* Storage may be disabled. */
}
let editingNote = null;

const $ = (selector) => document.querySelector(selector);
const topics = [
  {
    subject: "Science",
    icon: "⚛",
    title: "Could we ever live on Mars?",
    detail: "Space, science & possibility",
    question:
      "What are the biggest scientific challenges of humans living on Mars?",
  },
  {
    subject: "History",
    icon: "▥",
    title: "How did the printing press change the world?",
    detail: "Small invention. Big impact.",
    question:
      "How did the printing press change access to knowledge and reshape society?",
  },
  {
    subject: "Literature",
    icon: "❦",
    title: "Why do stories stay with us?",
    detail: "Words, meaning & imagination",
    question:
      "How do authors use symbolism and character to make stories memorable?",
  },
  {
    subject: "Our world",
    icon: "◎",
    title: "What makes a city sustainable?",
    detail: "People, places & our planet",
    question:
      "What makes a city sustainable, and which real examples can we learn from?",
  },
  {
    subject: "Science",
    icon: "❋",
    title: "What can a forest teach us?",
    detail: "The hidden life of ecosystems",
    question:
      "How do trees and fungi interact in a forest ecosystem, and what is still uncertain?",
  },
  {
    subject: "History",
    icon: "◷",
    title: "How do we know what happened?",
    detail: "Evidence, perspective & the past",
    question:
      "How do historians evaluate conflicting primary sources about the same event?",
  },
  {
    subject: "Literature",
    icon: "❧",
    title: "Can a poem change a mind?",
    detail: "Reading between the lines",
    question:
      "How do poets use imagery and rhythm to influence how readers think and feel?",
  },
  {
    subject: "Our world",
    icon: "↝",
    title: "Where does our water go?",
    detail: "Everyday questions, global impact",
    question:
      "How does a city treat and reuse wastewater, and what are the environmental trade-offs?",
  },
];
let configured = false;
let webSearch = true;
let current = null;
let busy = false;
let library = [];
try {
  const saved = JSON.parse(localStorage.getItem("folio-library") || "[]");
  if (Array.isArray(saved))
    library = saved
      .filter(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.question === "string" &&
          Array.isArray(item.parts) &&
          Array.isArray(item.sources),
      )
      .slice(0, 40);
} catch {
  /* A disabled or full browser store should not prevent research. */
}

function showView(view) {
  $("#research-view").hidden = view !== "research";
  $("#library-view").hidden = view !== "library";
  $("#nav-research").classList.toggle("active", view === "research");
  $("#nav-library").classList.toggle("active", view === "library");
  $("#nav-research").setAttribute(
    "aria-current",
    view === "research" ? "page" : "false",
  );
  $("#nav-library").setAttribute(
    "aria-current",
    view === "library" ? "page" : "false",
  );
  $("#page-label").textContent =
    view === "research" ? "Study & research" : "My library";
  if (view === "library") {
    renderLibrary();
    renderNotes();
  }
}
function setQuestion(question) {
  if (busy) return;
  showView("research");
  $("#question").value = question;
  updateCount();
  $("#question").focus();
  $("#research-form").scrollIntoView({ behavior: "smooth", block: "center" });
}
function renderTopics(subject = "All topics") {
  const list =
    subject === "All topics"
      ? topics.slice(0, 3)
      : topics.filter((topic) => topic.subject === subject);
  $("#topic-grid").replaceChildren(
    ...list.map((topic) => {
      const button = document.createElement("button");
      button.className = `topic-card ${topic.subject === "Our world" ? "world" : topic.subject.toLowerCase()}`;
      const label = document.createElement("span");
      label.className = "topic-label";
      const icon = document.createElement("span");
      icon.className = "topic-icon";
      icon.textContent = topic.icon;
      icon.setAttribute("aria-hidden", "true");
      label.append(icon, document.createTextNode(topic.subject));
      const title = document.createElement("h3");
      title.textContent = topic.title;
      const bottom = document.createElement("span");
      bottom.className = "topic-bottom";
      const detail = document.createElement("span");
      detail.textContent = topic.detail;
      const arrow = document.createElement("span");
      arrow.textContent = "↗";
      arrow.setAttribute("aria-hidden", "true");
      bottom.append(detail, arrow);
      button.append(label, title, bottom);
      button.addEventListener("click", () => setQuestion(topic.question));
      return button;
    }),
  );
}
function feedback(message, error = false, setup = false) {
  const node = $("#feedback");
  node.replaceChildren(document.createTextNode(message));
  node.hidden = !message;
  node.className = error ? "error" : "";
  if (setup) {
    const button = document.createElement("button");
    button.className = "text-button";
    button.textContent = "View setup ↗";
    button.addEventListener("click", openSetup);
    node.append(button);
  }
}
function safeSource(source) {
  try {
    const url = new URL(source.url);
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}
function renderAnswer(answer) {
  current = answer;
  $("#answer-section").hidden = false;
  $("#answer-title").textContent = answer.question;
  $("#answer-meta").textContent =
    `${answer.subject || "General"} · ${answer.mode === "explain" ? "Subject explanation" : "Research"} · ${answer.level} · ${answer.sources.length ? "Includes web citations" : "No source citations returned"} · ${new Date(answer.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const body = $("#answer-body");
  body.replaceChildren();
  for (const part of answer.parts) {
    if (typeof part.text !== "string") continue;
    let cursor = 0;
    for (const citation of [...(part.citations || [])].sort(
      (a, b) => a.start - b.start,
    )) {
      const source = answer.sources[citation.source];
      const url = source && safeSource(source);
      if (
        !url ||
        !Number.isInteger(citation.start) ||
        !Number.isInteger(citation.end) ||
        citation.start < cursor ||
        citation.end <= citation.start ||
        citation.end > part.text.length
      )
        continue;
      body.append(
        document.createTextNode(part.text.slice(cursor, citation.start)),
      );
      const link = document.createElement("a");
      link.className = "citation";
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `[${citation.source + 1}]`;
      link.title = source.title;
      link.setAttribute(
        "aria-label",
        `Source ${citation.source + 1}: ${source.title}`,
      );
      body.append(link);
      cursor = citation.end;
    }
    body.append(document.createTextNode(part.text.slice(cursor) + "\n\n"));
  }
  const sources = $("#sources");
  sources.replaceChildren();
  answer.sources.forEach((source, index) => {
    const url = safeSource(source);
    if (!url) return;
    const link = document.createElement("a");
    link.className = "source-link";
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${index + 1}. ${source.title} ↗`;
    const host = document.createElement("small");
    host.textContent = url.hostname;
    link.append(host);
    sources.append(link);
  });
  $("#source-count").textContent = `${sources.children.length} sources`;
  if (!sources.children.length) {
    const note = document.createElement("p");
    note.className = "no-sources";
    note.textContent = answer.webSearch
      ? "No source citations were returned for this answer. Treat it as an unverified starting point and check claims independently."
      : "Live web search is off. This answer is based on model knowledge and has no verified web sources.";
    sources.append(note);
  }
  updateSaveButton();
}
function updateSaveButton() {
  const saved = current && library.some((item) => item.id === current.id);
  $("#save-button").textContent = saved
    ? "✓ Saved to library"
    : "＋ Save to library";
  $("#save-button").disabled = Boolean(saved);
  $("#library-count").textContent = library.length + notes.length;
}
function persistLibrary(next) {
  try {
    localStorage.setItem("folio-library", JSON.stringify(next));
    library = next;
    updateSaveButton();
    return true;
  } catch {
    showView("research");
    feedback(
      "This device could not save this answer. Free up browser storage or enable local storage, then retry.",
      true,
    );
    return false;
  }
}
function renderLibrary() {
  const container = $("#library-items");
  container.replaceChildren();
  if (!library.length) {
    const empty = document.createElement("div");
    empty.className = "empty-library";
    const icon = document.createElement("span");
    icon.textContent = "❦";
    const title = document.createElement("h2");
    title.textContent = "Your next discovery belongs here.";
    const text = document.createElement("p");
    text.textContent =
      "Explore a question, then save your research brief. Your answers and source links will be kept together on this device.";
    const button = document.createElement("button");
    button.className = "primary-button";
    button.textContent = "Start a little research ↗";
    button.addEventListener("click", () => {
      showView("research");
      $("#question").focus();
    });
    empty.append(icon, title, text, button);
    container.append(empty);
  }
  for (const item of library) {
    const row = document.createElement("article");
    row.className = "saved-item";
    const open = document.createElement("button");
    open.className = "saved-open";
    open.textContent = item.question;
    const meta = document.createElement("small");
    meta.textContent = `${item.level} · ${item.sources.length} sources · ${new Date(item.createdAt).toLocaleDateString()}`;
    open.append(meta);
    open.addEventListener("click", () => {
      showView("research");
      renderAnswer(item);
      $("#answer-title").focus();
    });
    const remove = document.createElement("button");
    remove.className = "remove-button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${item.question} from library`);
    remove.addEventListener("click", () => {
      if (persistLibrary(library.filter((saved) => saved.id !== item.id)))
        renderLibrary();
    });
    row.append(open, remove);
    container.append(row);
  }
}
function openSetup() {
  $("#setup-status").textContent = configured
    ? `A server API key is set. Live web search is ${webSearch ? "on" : "off"}. Key validity and provider access are checked when you submit a question.`
    : "AI is not connected yet. You can explore topic prompts now; answers need a server API key.";
  $("#backend-status").textContent = nativeApp
    ? apiBase
      ? "Android backend: " + apiBase
      : "No Android AI backend is configured. The app owner must set STUDY_API_URL to the HTTPS backend origin and rebuild the app. Your notes work without it."
    : "This web workspace uses its own server for AI requests.";
  $("#setup-dialog").showModal();
}
function updateCount() {
  $("#char-count").textContent =
    `${$("#question").value.length.toLocaleString()} / 2,000`;
}

$("#research-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const question = $("#question").value.trim();
  if (question.length < 8) {
    feedback(
      "Give your question a little more detail — at least 8 characters.",
      true,
    );
    return;
  }
  const level = $("#level").value;
  if (!configured) {
    feedback(
      "Connect AI to start your research. Your question is ready when you are.",
      true,
      true,
    );
    return;
  }
  busy = true;
  $("#ask-button").disabled = true;
  $("#ask-button").textContent = "Exploring…";
  $("#question").readOnly = true;
  $("#level").disabled = true;
  $("#study-mode").disabled = true;
  $("#subject").disabled = true;
  $("#answer-section").hidden = true;
  $("#research-form").setAttribute("aria-busy", "true");
  feedback(
    webSearch && $("#study-mode").value === "research"
      ? "Following your question, searching the web, and putting the ideas together… This can take up to 90 seconds."
      : "Thinking through your question… Live web search is off.",
  );
  try {
    const response = await fetch(`${apiBase}/api/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        level,
        mode: $("#study-mode").value,
        subject: $("#subject").value,
      }),
      signal: AbortSignal.timeout(100000),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.code === "NOT_CONFIGURED") configured = false;
      feedback(
        data.error || "Research could not be completed. Please retry.",
        true,
        ["NOT_CONFIGURED", "KEY_REJECTED"].includes(data.code),
      );
      return;
    }
    feedback("");
    showView("research");
    renderAnswer({
      ...data,
      question,
      level,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
    $("#answer-title").focus();
  } catch {
    feedback(
      "We could not complete your research. Check your connection and try again. Your question is still here.",
      true,
    );
  } finally {
    busy = false;
    $("#ask-button").disabled = false;
    $("#ask-button").replaceChildren(
      document.createTextNode("Start exploring "),
    );
    const arrow = document.createElement("span");
    arrow.textContent = "↗";
    arrow.setAttribute("aria-hidden", "true");
    $("#ask-button").append(arrow);
    $("#question").readOnly = false;
    $("#level").disabled = false;
    $("#study-mode").disabled = false;
    $("#subject").disabled = false;
    $("#research-form").setAttribute("aria-busy", "false");
  }
});
$("#question").addEventListener("input", updateCount);
$("#nav-research").addEventListener("click", () => showView("research"));
$("#nav-library").addEventListener("click", () => showView("library"));
$("#setup-button").addEventListener("click", openSetup);
$("#mobile-setup").addEventListener("click", openSetup);
$("#close-setup").addEventListener("click", () => $("#setup-dialog").close());
$("#done-setup").addEventListener("click", () => $("#setup-dialog").close());
$("#setup-dialog").addEventListener("click", (event) => {
  if (event.target === $("#setup-dialog")) {
    const rect = event.target.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      event.target.close();
  }
});
$("#save-button").addEventListener("click", () => {
  if (!current || library.some((item) => item.id === current.id)) return;
  if (library.length >= 40) {
    feedback(
      "Your library holds up to 40 briefs. Remove one to make room for a new discovery.",
      true,
    );
    return;
  }
  if (persistLibrary([current, ...library]))
    feedback("Research brief saved to your library on this device.");
});
$("#followup-button").addEventListener("click", () => {
  if (current) setQuestion(`About “${current.question}”: `);
});
document.querySelectorAll(".filter").forEach((button) =>
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((filter) => {
      const active = filter === button;
      filter.classList.toggle("active", active);
      filter.setAttribute("aria-pressed", String(active));
    });
    renderTopics(button.dataset.filter);
  }),
);
renderTopics();
updateSaveButton();
showView("research");
(backendMissing
  ? Promise.reject(new Error("No backend"))
  : fetch(`${apiBase}/api/config`, { signal: AbortSignal.timeout(10000) })
)
  .then((response) => {
    if (!response.ok) throw new Error("Config unavailable");
    return response.json();
  })
  .then((config) => {
    configured = config.configured;
    webSearch = config.webSearch;
    $("#connection-dot").classList.toggle("connected", configured);
    updateMode();
    if (!configured)
      feedback(
        "Your workspace is ready. Connect AI to turn your questions into research.",
        false,
        true,
      );
  })
  .catch(() =>
    feedback(
      backendMissing
        ? "AI backend not configured. You can write and save notes now; AI answers need an HTTPS backend."
        : "Could not check the AI connection. Notes still work. Check your connection and refresh to try again.",
      true,
      true,
    ),
  );

function updateMode() {
  const explain = $("#study-mode").value === "explain";
  $("#mode-hint").textContent = explain
    ? "Learn step by step with a worked example and practice question. Explanations use model knowledge without live web verification."
    : "Investigate a question with live web sources. Open citations to check the evidence.";
  $("#search-label").textContent = explain
    ? "Subject explanation"
    : webSearch
      ? "Web sources"
      : "Web search off";
}
$("#study-mode").addEventListener("change", updateMode);

function resetNoteEditor() {
  editingNote = null;
  $("#note-form").reset();
  $("#note-editor-title").textContent = "Write a study note";
  $("#cancel-note").hidden = true;
}
function renderNotes() {
  $("#study-notes").replaceChildren(
    ...notes.map((note) => {
      const card = document.createElement("article");
      card.className = "study-note";
      const title = document.createElement("h3");
      title.textContent = note.title;
      const body = document.createElement("p");
      body.textContent = note.body;
      const meta = document.createElement("small");
      meta.textContent = `Your note · ${new Date(note.updatedAt).toLocaleDateString()}`;
      const actions = document.createElement("div");
      actions.className = "note-actions";
      const edit = document.createElement("button");
      edit.className = "text-button";
      edit.textContent = "Edit note";
      edit.setAttribute("aria-label", `Edit ${note.title}`);
      edit.addEventListener("click", () => {
        editingNote = note.id;
        $("#note-title").value = note.title;
        $("#note-body").value = note.body;
        $("#note-editor-title").textContent = "Edit your study note";
        $("#cancel-note").hidden = false;
        $("#note-title").focus();
      });
      const remove = document.createElement("button");
      remove.className = "text-button";
      remove.textContent = "Delete note";
      remove.setAttribute("aria-label", `Delete ${note.title}`);
      remove.addEventListener("click", () => {
        if (!confirm(`Delete “${note.title}”? This cannot be undone.`)) return;
        try {
          notes = deleteNote(localStorage, notes, note.id);
          if (editingNote === note.id) resetNoteEditor();
          renderNotes();
          updateSaveButton();
          $("#note-status").textContent = "Note deleted.";
        } catch {
          $("#note-status").textContent =
            "Could not delete this note. Check device storage and retry.";
        }
      });
      actions.append(edit, remove);
      card.append(meta, title, body, actions);
      return card;
    }),
  );
}
$("#cancel-note").addEventListener("click", resetNoteEditor);
$("#note-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    notes = saveNote(localStorage, notes, {
      id: editingNote || crypto.randomUUID(),
      title: $("#note-title").value,
      body: $("#note-body").value,
      updatedAt: new Date().toISOString(),
    });
    resetNoteEditor();
    renderNotes();
    updateSaveButton();
    $("#note-status").textContent = "Note saved on this device.";
  } catch (error) {
    $("#note-status").textContent =
      error.message.startsWith("Add a title") ||
      error.message.startsWith("You have")
        ? error.message
        : "Could not save your note. Free up device storage and retry. Your text is still here.";
  }
});
