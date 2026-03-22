import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";

const STORE_FILE = "library_settings.json";
/** Browser-only fallback when `vite` is opened outside the Tauri shell (no `invoke`). */
const LS_RECENT = "digital-library:recentSearches";
const MAX_RECENT = 10;
/** Idle list preview when the search box is empty */
const MAX_PREVIEW = 200;
/** Max rows to render per search — avoids freezing the UI on huge libraries */
const MAX_SEARCH_RESULTS = 500;

type LibraryEntry = {
  name: string;
  relativePath: string;
  absolutePath: string;
  isDir: boolean;
};

let store: Store | null = null;
const inTauri = isTauri();
let libraryRoot: string | null = null;
let allEntries: LibraryEntry[] = [];
let categories: string[] = [];
let recentSearches: string[] = [];
let searchQuery = "";
let settingsOpen = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const appEl = document.querySelector<HTMLDivElement>("#app");
if (!appEl) {
  throw new Error("#app missing");
}
const app = appEl;

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

function filterEntries(query: string): {
  entries: LibraryEntry[];
  truncated: boolean;
} {
  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      entries: allEntries.slice(0, MAX_PREVIEW),
      truncated: allEntries.length > MAX_PREVIEW,
    };
  }
  const out: LibraryEntry[] = [];
  let truncated = false;
  for (const e of allEntries) {
    const n = e.name.toLowerCase();
    const p = e.relativePath.toLowerCase();
    if (n.includes(q) || p.includes(q)) {
      out.push(e);
      if (out.length > MAX_SEARCH_RESULTS) {
        truncated = true;
        out.length = MAX_SEARCH_RESULTS;
        break;
      }
    }
  }
  return { entries: out, truncated };
}

async function persistRecent(query: string): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) return;
  recentSearches = recentSearches.filter((s) => s !== trimmed);
  recentSearches.unshift(trimmed);
  recentSearches = recentSearches.slice(0, MAX_RECENT);
  if (store) {
    await store.set("recentSearches", recentSearches);
    await store.save();
  } else {
    try {
      localStorage.setItem(LS_RECENT, JSON.stringify(recentSearches));
    } catch {
      /* ignore */
    }
  }
}

async function pickLibraryFolder(): Promise<void> {
  if (!inTauri) {
    window.alert(
      "Folder selection runs in the desktop app. From the project folder run:\n\n  npm run tauri dev",
    );
    return;
  }
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select your library folder",
    recursive: true,
  });
  if (selected === null || Array.isArray(selected)) return;
  libraryRoot = selected;
  if (store) {
    await store.set("libraryRoot", libraryRoot);
    await store.save();
  }
  await refreshIndex();
}

async function refreshIndex(): Promise<void> {
  if (!libraryRoot) {
    allEntries = [];
    categories = [];
    render();
    return;
  }
  if (!inTauri) {
    allEntries = [];
    categories = [];
    render();
    return;
  }
  try {
    allEntries = await invoke<LibraryEntry[]>("walk_library", {
      root: libraryRoot,
    });
    categories = await invoke<string[]>("list_categories", {
      root: libraryRoot,
    });
  } catch (e) {
    console.error(e);
    allEntries = [];
    categories = [];
  }
  render();
}

async function onResultClick(entry: LibraryEntry): Promise<void> {
  if (!inTauri) {
    window.alert(
      "Opening files uses the desktop app. Run:\n\n  npm run tauri dev",
    );
    return;
  }
  if (!libraryRoot) return;
  try {
    await invoke("open_library_path", {
      libraryRoot,
      path: entry.absolutePath,
    });
  } catch (e) {
    console.error(e);
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "Could not open this item.";
    window.alert(msg);
  }
}

function debouncedRenderInput(value: string): void {
  searchQuery = value;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    render();
  }, 280);
}

function render(): void {
  const { entries: filtered, truncated } = filterEntries(searchQuery);
  const hasLibrary = Boolean(libraryRoot);
  const showRecent = recentSearches.length > 0 && !searchQuery.trim();

  app.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "shell intro";

  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "btn-icon";
  settingsBtn.title = "Library settings";
  settingsBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>`;
  settingsBtn.addEventListener("click", () => {
    settingsOpen = true;
    render();
  });

  const hero = document.createElement("div");
  hero.className = "hero";
  hero.innerHTML = `
    <h1>Digital Library</h1>
    <p>Browse folders and PDFs offline — search, then open with your system apps.</p>${
      inTauri
        ? ""
        : `<p class="browser-hint">Preview: this page has no Tauri APIs. Use <code>npm run tauri dev</code> for the desktop app.</p>`
    }`;

  const searchWrap = document.createElement("div");
  searchWrap.className = "search-wrap";
  searchWrap.innerHTML = `<svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;
  const input = document.createElement("input");
  input.type = "search";
  input.placeholder = hasLibrary
    ? "Search by file or folder name…"
    : "Choose a library folder in settings to begin";
  input.autocomplete = "off";
  input.value = searchQuery;
  input.disabled = !hasLibrary;
  input.addEventListener("input", () => debouncedRenderInput(input.value));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      void persistRecent(searchQuery);
      render();
    }
  });
  searchWrap.appendChild(input);

  const chips = document.createElement("div");
  chips.className = "chips";
  if (hasLibrary && categories.length) {
    for (const cat of categories) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = cat;
      chip.addEventListener("click", () => {
        searchQuery = cat;
        debouncedRenderInput(cat);
        input.value = cat;
        void persistRecent(cat);
      });
      chips.appendChild(chip);
    }
  }

  let recentBlock: HTMLElement | null = null;
  if (showRecent) {
    recentBlock = document.createElement("div");
    recentBlock.className = "recent";
    recentBlock.innerHTML = "<h2>Recent searches</h2>";
    const tags = document.createElement("div");
    tags.className = "recent-tags";
    for (const r of recentSearches) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = r;
      b.addEventListener("click", () => {
        searchQuery = r;
        input.value = r;
        debouncedRenderInput(r);
      });
      tags.appendChild(b);
    }
    recentBlock.appendChild(tags);
  }

  const results = document.createElement("div");
  results.className = "results";
  const header = document.createElement("div");
  header.className = "results-header";
  if (!hasLibrary) {
    header.textContent = "No library folder configured.";
  } else {
    const q = searchQuery.trim();
    if (q) {
      header.textContent = truncated
        ? `${MAX_SEARCH_RESULTS}+ matches (showing first ${MAX_SEARCH_RESULTS})`
        : `${filtered.length} match${filtered.length === 1 ? "" : "es"}`;
    } else {
      header.textContent = `${allEntries.length} items indexed (showing first ${MAX_PREVIEW} until you search)`;
    }
  }
  results.appendChild(header);

  const list = document.createElement("div");
  list.className = "results-list";

  if (!hasLibrary) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      "Use the settings button above to choose the folder that contains your categories and books.";
    list.appendChild(empty);
  } else if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = searchQuery.trim()
      ? "No matches. Try another term."
      : "Type to search, or click a category chip.";
    list.appendChild(empty);
  } else {
    for (const entry of filtered) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "result-row";
      row.addEventListener("click", () => {
        void onResultClick(entry);
      });

      const icon = document.createElement("div");
      icon.className = "result-icon";
      if (entry.isDir) {
        icon.classList.add("folder");
        icon.textContent = "📁";
      } else if (isPdf(entry.name)) {
        icon.classList.add("pdf");
        icon.textContent = "PDF";
      } else {
        icon.classList.add("file");
        icon.textContent = "∎";
      }

      const meta = document.createElement("div");
      meta.className = "result-meta";
      const nameEl = document.createElement("div");
      nameEl.className = "result-name";
      nameEl.textContent = entry.name;
      const pathEl = document.createElement("div");
      pathEl.className = "result-path";
      pathEl.textContent = entry.relativePath || "(library root)";
      meta.appendChild(nameEl);
      meta.appendChild(pathEl);

      row.appendChild(icon);
      row.appendChild(meta);
      list.appendChild(row);
    }
  }
  results.appendChild(list);

  const status = document.createElement("div");
  status.className = "status-bar";
  status.textContent = hasLibrary
    ? libraryRoot!
    : "Offline • No cloud • Local files only";

  shell.appendChild(hero);
  shell.appendChild(searchWrap);
  if (chips.childElementCount) shell.appendChild(chips);
  if (recentBlock) shell.appendChild(recentBlock);
  shell.appendChild(results);
  shell.appendChild(status);

  app.appendChild(settingsBtn);
  app.appendChild(shell);

  if (settingsOpen) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        settingsOpen = false;
        render();
      }
    });

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.addEventListener("click", (e) => e.stopPropagation());

    modal.innerHTML = `<h2>Library settings</h2>
      <p>Select the top-level folder for your digital library. Subfolders and PDFs will appear in search.</p>`;

    const pathDisplay = document.createElement("div");
    pathDisplay.className = "path-display";
    pathDisplay.textContent = libraryRoot ?? "No folder selected yet.";

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "btn btn-primary";
    choose.textContent = "Choose folder…";
    choose.addEventListener("click", async () => {
      await pickLibraryFolder();
      settingsOpen = false;
      render();
    });

    const rescan = document.createElement("button");
    rescan.type = "button";
    rescan.className = "btn btn-ghost";
    rescan.textContent = "Re-scan";
    rescan.disabled = !libraryRoot;
    rescan.addEventListener("click", async () => {
      await refreshIndex();
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn-ghost";
    close.textContent = "Close";
    close.addEventListener("click", () => {
      settingsOpen = false;
      render();
    });

    actions.appendChild(choose);
    actions.appendChild(rescan);
    actions.appendChild(close);

    modal.appendChild(pathDisplay);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    app.appendChild(overlay);
  }
}

async function bootstrap(): Promise<void> {
  if (inTauri) {
    store = await Store.load(STORE_FILE, {
      defaults: {},
      autoSave: 200,
    });
    libraryRoot = (await store.get<string>("libraryRoot")) ?? null;
    recentSearches = (await store.get<string[]>("recentSearches")) ?? [];
  } else {
    store = null;
    libraryRoot = null;
    try {
      const raw = localStorage.getItem(LS_RECENT);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        recentSearches = Array.isArray(parsed)
          ? parsed.filter((x): x is string => typeof x === "string")
          : [];
      }
    } catch {
      recentSearches = [];
    }
  }

  if (libraryRoot) {
    await refreshIndex();
  } else {
    settingsOpen = true;
    render();
  }
}

void bootstrap();
