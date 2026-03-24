import { DotLottie } from "@lottiefiles/dotlottie-web";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";

import splashAnimationUrl from "./assets/girl-with-books.lottie?url";

const STORE_FILE = "library_settings.json";
/** Browser-only fallback when `vite` is opened outside the Tauri shell (no `invoke`). */
const LS_RECENT = "digital-library:recentSearches";
const LS_APPEARANCE = "digital-library:appearance";
const MAX_RECENT = 10;
/** Idle list preview when the search box is empty */
const MAX_PREVIEW = 200;
/** Max rows to render per search — avoids freezing the UI on huge libraries */
const MAX_SEARCH_RESULTS = 500;
/** Reject logo uploads larger than this to keep Store / localStorage reasonable. */
const MAX_LOGO_BYTES = 600_000;

type LibraryEntry = {
  name: string;
  relativePath: string;
  absolutePath: string;
  isDir: boolean;
};

type ThemeSource = "preset" | "custom";

type AppearanceSettings = {
  themeSource: ThemeSource;
  presetId: string;
  primary: string;
  secondary: string;
  appTitle: string;
  logoDataUrl: string | null;
};

const DEFAULT_TITLE = "Digital Library";

const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeSource: "preset",
  presetId: "midnight",
  primary: "#6ee7ff",
  secondary: "#c4b5fd",
  appTitle: DEFAULT_TITLE,
  logoDataUrl: null,
};

const PRESET_IDS = [
  "midnight",
  "forest",
  "ember",
  "paper",
  "sage",
  "ocean",
] as const;

type PresetId = (typeof PRESET_IDS)[number];

const PRESET_META: Record<
  PresetId,
  { label: string; dark: boolean; swatch: string }
> = {
  midnight: { label: "Midnight", dark: true, swatch: "#6ee7ff" },
  forest: { label: "Forest", dark: true, swatch: "#6effa8" },
  ember: { label: "Ember", dark: true, swatch: "#ff9f6e" },
  paper: { label: "Paper", dark: false, swatch: "#2563eb" },
  sage: { label: "Sage", dark: false, swatch: "#2d6a4f" },
  ocean: { label: "Ocean", dark: false, swatch: "#0ea5e9" },
};

const PRESET_VARS: Record<PresetId, Record<string, string>> = {
  midnight: {
    "--bg0": "#0a0c10",
    "--bg1": "#12151c",
    "--surface": "#1a1f2a",
    "--border": "rgba(255, 255, 255, 0.08)",
    "--text": "#e8eaef",
    "--muted": "#8b93a5",
    "--accent": "#6ee7ff",
    "--accent-dim": "rgba(110, 231, 255, 0.15)",
    "--pdf": "#ff8a7a",
    "--folder": "#c4b5fd",
    "--glow-a": "#1a2340",
    "--glow-b": "#1a3040",
  },
  forest: {
    "--bg0": "#0a100c",
    "--bg1": "#121c15",
    "--surface": "#1a2a22",
    "--border": "rgba(255, 255, 255, 0.08)",
    "--text": "#e8f0ea",
    "--muted": "#8ba595",
    "--accent": "#6effa8",
    "--accent-dim": "rgba(110, 255, 168, 0.15)",
    "--pdf": "#ffb87a",
    "--folder": "#c4f5b5",
    "--glow-a": "#1a4025",
    "--glow-b": "#1a5040",
  },
  ember: {
    "--bg0": "#100c0a",
    "--bg1": "#1c1512",
    "--surface": "#2a221a",
    "--border": "rgba(255, 255, 255, 0.08)",
    "--text": "#f0eae8",
    "--muted": "#a5988b",
    "--accent": "#ff9f6e",
    "--accent-dim": "rgba(255, 159, 110, 0.15)",
    "--pdf": "#ff8a9a",
    "--folder": "#ffd4a6",
    "--glow-a": "#40251a",
    "--glow-b": "#503020",
  },
  paper: {
    "--bg0": "#f5f6f8",
    "--bg1": "#eef0f4",
    "--surface": "#ffffff",
    "--border": "rgba(0, 0, 0, 0.1)",
    "--text": "#1a1d26",
    "--muted": "#5c6370",
    "--accent": "#2563eb",
    "--accent-dim": "rgba(37, 99, 235, 0.12)",
    "--pdf": "#dc2626",
    "--folder": "#7c3aed",
    "--glow-a": "#dbeafe",
    "--glow-b": "#e0e7ff",
  },
  sage: {
    "--bg0": "#f4f7f4",
    "--bg1": "#eef2ee",
    "--surface": "#fbfcfb",
    "--border": "rgba(0, 0, 0, 0.1)",
    "--text": "#1a221a",
    "--muted": "#5c6b5c",
    "--accent": "#2d6a4f",
    "--accent-dim": "rgba(45, 106, 79, 0.12)",
    "--pdf": "#c05621",
    "--folder": "#606c38",
    "--glow-a": "#d8f3dc",
    "--glow-b": "#e9f5e9",
  },
  ocean: {
    "--bg0": "#f3f7fa",
    "--bg1": "#eef4f8",
    "--surface": "#ffffff",
    "--border": "rgba(0, 0, 0, 0.1)",
    "--text": "#0f172a",
    "--muted": "#64748b",
    "--accent": "#0ea5e9",
    "--accent-dim": "rgba(14, 165, 233, 0.12)",
    "--pdf": "#f97316",
    "--folder": "#6366f1",
    "--glow-a": "#bae6fd",
    "--glow-b": "#e0f2fe",
  },
};

const CUSTOM_BASE: Record<string, string> = {
  "--bg0": "#0a0c10",
  "--bg1": "#12151c",
  "--surface": "#1a1f2a",
  "--border": "rgba(255, 255, 255, 0.08)",
  "--text": "#e8eaef",
  "--muted": "#8b93a5",
  "--pdf": "#ff8a7a",
};

let store: Store | null = null;
const inTauri = isTauri();
let libraryRoot: string | null = null;
let allEntries: LibraryEntry[] = [];
let categories: string[] = [];
let recentSearches: string[] = [];
let searchQuery = "";
let settingsOpen = false;
let settingsTab: "library" | "appearance" = "library";
let appearance: AppearanceSettings = { ...DEFAULT_APPEARANCE };
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** Debounce delay for filtering results only — full `render()` is avoided on each keystroke. */
const SEARCH_DEBOUNCE_MS = 300;
/** Failsafe if the splash Lottie never fires `complete` (should not happen in practice). */
const SPLASH_ANIMATION_FAILSAFE_MS = 120_000;
/** Matches `.splash-out` transition in `styles.css`. */
const SPLASH_FADE_MS = 450;

const appEl = document.querySelector<HTMLDivElement>("#app");
if (!appEl) {
  throw new Error("#app missing");
}
const app = appEl;

const GEAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

function isPresetId(id: string): id is PresetId {
  return (PRESET_IDS as readonly string[]).includes(id);
}

function hexAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(110, 231, 255, ${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function normalizeHex(hex: string, fallback: string): string {
  const t = hex.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  return fallback;
}

function normalizeAppearance(raw: unknown): AppearanceSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const themeSource =
    o.themeSource === "custom" || o.themeSource === "preset"
      ? o.themeSource
      : DEFAULT_APPEARANCE.themeSource;
  const presetId =
    typeof o.presetId === "string" && isPresetId(o.presetId)
      ? o.presetId
      : DEFAULT_APPEARANCE.presetId;
  const primary = normalizeHex(
    typeof o.primary === "string" ? o.primary : "",
    DEFAULT_APPEARANCE.primary,
  );
  const secondary = normalizeHex(
    typeof o.secondary === "string" ? o.secondary : "",
    DEFAULT_APPEARANCE.secondary,
  );
  let appTitle =
    typeof o.appTitle === "string" && o.appTitle.trim()
      ? o.appTitle.trim()
      : DEFAULT_APPEARANCE.appTitle;
  if (appTitle.length > 120) appTitle = appTitle.slice(0, 120);
  const logoDataUrl =
    typeof o.logoDataUrl === "string" && o.logoDataUrl.startsWith("data:image/")
      ? o.logoDataUrl
      : null;
  return {
    themeSource,
    presetId,
    primary,
    secondary,
    appTitle,
    logoDataUrl,
  };
}

function applyAppearance(a: AppearanceSettings): void {
  const root = document.documentElement;
  if (a.themeSource === "preset" && isPresetId(a.presetId)) {
    const meta = PRESET_META[a.presetId];
    root.style.setProperty("color-scheme", meta.dark ? "dark" : "light");
    const vars = PRESET_VARS[a.presetId];
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(k, v);
    }
    return;
  }
  root.style.setProperty("color-scheme", "dark");
  for (const [k, v] of Object.entries(CUSTOM_BASE)) {
    root.style.setProperty(k, v);
  }
  root.style.setProperty("--accent", a.primary);
  root.style.setProperty("--folder", a.secondary);
  root.style.setProperty("--accent-dim", hexAlpha(a.primary, 0.15));
  root.style.setProperty(
    "--glow-a",
    `color-mix(in srgb, ${a.primary} 22%, #1a2340)`,
  );
  root.style.setProperty(
    "--glow-b",
    `color-mix(in srgb, ${a.primary} 18%, #1a3040)`,
  );
}

async function persistAppearance(): Promise<void> {
  if (store) {
    await store.set("appearance", appearance);
    await store.save();
  } else {
    try {
      localStorage.setItem(LS_APPEARANCE, JSON.stringify(appearance));
    } catch {
      /* ignore */
    }
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () =>
      resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
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

function debouncedSearchInput(value: string): void {
  searchQuery = value;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    applySearchUi();
  }, SEARCH_DEBOUNCE_MS);
}

function populateResultsPanel(header: HTMLElement, list: HTMLElement): void {
  const { entries: filtered, truncated } = filterEntries(searchQuery);
  const hasLibrary = Boolean(libraryRoot);

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

  list.replaceChildren();

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
}

function syncRecentSection(): void {
  const recentRoot = document.getElementById("recent-searches");
  const shouldShow = recentSearches.length > 0 && !searchQuery.trim();
  if (!recentRoot && shouldShow) {
    render();
    return;
  }
  if (!recentRoot) return;
  const show = shouldShow;
  recentRoot.hidden = !show;
  if (!show) return;
  let tags = recentRoot.querySelector<HTMLDivElement>(".recent-tags");
  if (!tags) {
    tags = document.createElement("div");
    tags.className = "recent-tags";
    recentRoot.appendChild(tags);
  }
  tags.replaceChildren();
  for (const r of recentSearches) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = r;
    b.addEventListener("click", () => {
      const input = document.getElementById(
        "library-search-input",
      ) as HTMLInputElement | null;
      searchQuery = r;
      if (input) input.value = r;
      if (debounceTimer) clearTimeout(debounceTimer);
      applySearchUi();
    });
    tags.appendChild(b);
  }
}

function applySearchUi(): void {
  const header = document.getElementById("results-header");
  const list = document.getElementById("results-list");
  if (!header || !list) {
    render();
    return;
  }
  populateResultsPanel(header, list);
  syncRecentSection();
}

function buildAppearancePanel(): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "appearance-panel";

  const titleField = document.createElement("div");
  titleField.className = "appearance-field";
  const titleLabel = document.createElement("div");
  titleLabel.className = "modal-section-title";
  titleLabel.textContent = "Title";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.value = appearance.appTitle;
  titleInput.autocomplete = "off";
  titleInput.addEventListener("change", () => {
    const v = titleInput.value.trim() || DEFAULT_TITLE;
    appearance.appTitle = v;
    document.title = v;
    void persistAppearance();
    render();
  });
  titleField.appendChild(titleLabel);
  titleField.appendChild(titleInput);

  const logoField = document.createElement("div");
  logoField.className = "appearance-field";
  const logoLabel = document.createElement("div");
  logoLabel.className = "modal-section-title";
  logoLabel.textContent = "Logo";
  const logoRow = document.createElement("div");
  logoRow.className = "logo-actions";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.hidden = true;
  const uploadBtn = document.createElement("button");
  uploadBtn.type = "button";
  uploadBtn.className = "btn btn-ghost";
  uploadBtn.textContent = "Upload image…";
  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      window.alert(
        `Image is too large (max ${Math.round(MAX_LOGO_BYTES / 1000)}KB).`,
      );
      return;
    }
    void (async () => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        appearance.logoDataUrl = dataUrl;
        await persistAppearance();
        applyAppearance(appearance);
        render();
      } catch (e) {
        console.error(e);
        window.alert("Could not read that image.");
      }
    })();
  });
  let preview: HTMLImageElement | null = null;
  if (appearance.logoDataUrl) {
    preview = document.createElement("img");
    preview.className = "logo-preview";
    preview.src = appearance.logoDataUrl;
    preview.alt = "";
  }
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn btn-ghost";
  removeBtn.textContent = "Remove logo";
  removeBtn.disabled = !appearance.logoDataUrl;
  removeBtn.addEventListener("click", () => {
    appearance.logoDataUrl = null;
    void persistAppearance();
    render();
  });
  logoRow.appendChild(fileInput);
  logoRow.appendChild(uploadBtn);
  if (preview) logoRow.appendChild(preview);
  logoRow.appendChild(removeBtn);
  logoField.appendChild(logoLabel);
  logoField.appendChild(logoRow);

  const themeLabel = document.createElement("div");
  themeLabel.className = "modal-section-title";
  themeLabel.textContent = "Theme";
  themeLabel.style.marginTop = "0.25rem";

  const sourceRow = document.createElement("div");
  sourceRow.className = "theme-source-row";
  const presetRadio = document.createElement("label");
  const pr = document.createElement("input");
  pr.type = "radio";
  pr.name = "theme-source";
  pr.checked = appearance.themeSource === "preset";
  pr.addEventListener("change", () => {
    if (!pr.checked) return;
    appearance.themeSource = "preset";
    void persistAppearance();
    applyAppearance(appearance);
    render();
  });
  presetRadio.appendChild(pr);
  presetRadio.appendChild(document.createTextNode(" Preset themes"));
  const customRadio = document.createElement("label");
  const cr = document.createElement("input");
  cr.type = "radio";
  cr.name = "theme-source";
  cr.checked = appearance.themeSource === "custom";
  cr.addEventListener("change", () => {
    if (!cr.checked) return;
    appearance.themeSource = "custom";
    void persistAppearance();
    applyAppearance(appearance);
    render();
  });
  customRadio.appendChild(cr);
  customRadio.appendChild(document.createTextNode(" Custom colors"));
  sourceRow.appendChild(presetRadio);
  sourceRow.appendChild(customRadio);

  const presetGrid = document.createElement("div");
  presetGrid.className = "preset-grid";
  for (const id of PRESET_IDS) {
    const meta = PRESET_META[id];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "preset-card";
    card.setAttribute(
      "aria-pressed",
      appearance.themeSource === "preset" && appearance.presetId === id
        ? "true"
        : "false",
    );
    const sw = document.createElement("div");
    sw.className = "preset-swatch";
    sw.style.background = `linear-gradient(135deg, ${meta.swatch}, ${PRESET_VARS[id]["--bg0"]})`;
    const nm = document.createElement("div");
    nm.className = "preset-name";
    nm.textContent = meta.label;
    card.appendChild(sw);
    card.appendChild(nm);
    card.addEventListener("click", () => {
      appearance.themeSource = "preset";
      appearance.presetId = id;
      void persistAppearance();
      applyAppearance(appearance);
      render();
    });
    presetGrid.appendChild(card);
  }
  presetGrid.hidden = appearance.themeSource !== "preset";

  const colorRow = document.createElement("div");
  colorRow.className = "appearance-field";
  const row1 = document.createElement("div");
  row1.className = "color-row";
  const l1 = document.createElement("label");
  l1.textContent = "Primary";
  const c1 = document.createElement("input");
  c1.type = "color";
  c1.value = appearance.primary;
  c1.addEventListener("input", () => {
    appearance.primary = c1.value;
    void persistAppearance();
    applyAppearance(appearance);
  });
  row1.appendChild(l1);
  row1.appendChild(c1);
  const row2 = document.createElement("div");
  row2.className = "color-row";
  const l2 = document.createElement("label");
  l2.textContent = "Secondary";
  const c2 = document.createElement("input");
  c2.type = "color";
  c2.value = appearance.secondary;
  c2.addEventListener("input", () => {
    appearance.secondary = c2.value;
    void persistAppearance();
    applyAppearance(appearance);
  });
  row2.appendChild(l2);
  row2.appendChild(c2);
  colorRow.appendChild(row1);
  colorRow.appendChild(row2);
  colorRow.hidden = appearance.themeSource !== "custom";

  panel.appendChild(titleField);
  panel.appendChild(logoField);
  panel.appendChild(themeLabel);
  panel.appendChild(sourceRow);
  panel.appendChild(presetGrid);
  panel.appendChild(colorRow);

  const closeRow = document.createElement("div");
  closeRow.className = "modal-actions";
  closeRow.style.marginTop = "1rem";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-ghost";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => {
    settingsOpen = false;
    render();
  });
  closeRow.appendChild(closeBtn);
  panel.appendChild(closeRow);

  return panel;
}

function render(): void {
  const hasLibrary = Boolean(libraryRoot);
  const showRecent = recentSearches.length > 0 && !searchQuery.trim();

  app.innerHTML = "";

  const shell = document.createElement("div");
  shell.className = "shell intro";

  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "btn-icon";
  settingsBtn.title = "Settings";
  settingsBtn.innerHTML = GEAR_SVG;
  settingsBtn.addEventListener("click", () => {
    settingsOpen = true;
    render();
  });

  const hero = document.createElement("div");
  hero.className = "hero";
  const h1 = document.createElement("h1");
  h1.textContent = appearance.appTitle;
  hero.appendChild(h1);
  if (appearance.logoDataUrl) {
    const img = document.createElement("img");
    img.className = "hero-logo";
    img.src = appearance.logoDataUrl;
    img.alt = "";
    hero.appendChild(img);
  }
  const tag = document.createElement("p");
  tag.textContent =
    "Browse folders and PDFs offline — search, then open with your system apps.";
  hero.appendChild(tag);
  if (!inTauri) {
    const hint = document.createElement("p");
    hint.className = "browser-hint";
    hint.innerHTML =
      'Preview: this page has no Tauri APIs. Use <code>npm run tauri dev</code> for the desktop app.';
    hero.appendChild(hint);
  }

  const searchWrap = document.createElement("div");
  searchWrap.className = "search-wrap";
  searchWrap.innerHTML = `<svg class="search-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;
  const input = document.createElement("input");
  input.id = "library-search-input";
  input.type = "search";
  input.placeholder = hasLibrary
    ? "Search by file or folder name…"
    : "Choose a library folder in settings to begin";
  input.autocomplete = "off";
  input.value = searchQuery;
  input.disabled = !hasLibrary;
  input.addEventListener("input", () => debouncedSearchInput(input.value));
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      void persistRecent(searchQuery).then(() => applySearchUi());
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
        input.value = cat;
        if (debounceTimer) clearTimeout(debounceTimer);
        applySearchUi();
        void persistRecent(cat);
      });
      chips.appendChild(chip);
    }
  }

  let recentBlock: HTMLElement | null = null;
  if (showRecent) {
    recentBlock = document.createElement("div");
    recentBlock.id = "recent-searches";
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
        if (debounceTimer) clearTimeout(debounceTimer);
        applySearchUi();
      });
      tags.appendChild(b);
    }
    recentBlock.appendChild(tags);
  }

  const results = document.createElement("div");
  results.className = "results";
  const header = document.createElement("div");
  header.id = "results-header";
  header.className = "results-header";
  results.appendChild(header);

  const list = document.createElement("div");
  list.id = "results-list";
  list.className = "results-list";
  populateResultsPanel(header, list);
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
    if (settingsTab === "appearance") {
      modal.classList.add("modal-wide");
    }
    modal.addEventListener("click", (e) => e.stopPropagation());

    const h2 = document.createElement("h2");
    h2.textContent = "Settings";
    modal.appendChild(h2);

    const tablist = document.createElement("div");
    tablist.className = "modal-tabs";
    tablist.setAttribute("role", "tablist");
    const tabLibrary = document.createElement("button");
    tabLibrary.type = "button";
    tabLibrary.className = "modal-tab";
    tabLibrary.setAttribute("role", "tab");
    tabLibrary.setAttribute(
      "aria-selected",
      settingsTab === "library" ? "true" : "false",
    );
    tabLibrary.textContent = "Library";
    tabLibrary.addEventListener("click", () => {
      settingsTab = "library";
      render();
    });
    const tabAppearance = document.createElement("button");
    tabAppearance.type = "button";
    tabAppearance.className = "modal-tab";
    tabAppearance.setAttribute("role", "tab");
    tabAppearance.setAttribute(
      "aria-selected",
      settingsTab === "appearance" ? "true" : "false",
    );
    tabAppearance.textContent = "Appearance";
    tabAppearance.addEventListener("click", () => {
      settingsTab = "appearance";
      render();
    });
    tablist.appendChild(tabLibrary);
    tablist.appendChild(tabAppearance);
    modal.appendChild(tablist);

    if (settingsTab === "library") {
      const desc = document.createElement("p");
      desc.textContent =
        "Select the top-level folder for your digital library. Subfolders and PDFs will appear in search.";
      modal.appendChild(desc);

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
    } else {
      modal.appendChild(buildAppearancePanel());
    }

    overlay.appendChild(modal);
    app.appendChild(overlay);
  }
}

/** Resolves after one full play (`loop: false`) or on load error / failsafe timeout. */
function waitForSplashAnimationComplete(player: DotLottie | null): Promise<void> {
  if (!player) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(failsafeTimer);
      player.removeEventListener("complete", onComplete);
      player.removeEventListener("loadError", onErr);
      resolve();
    };

    const onComplete = () => finish();
    const onErr = () => finish();

    player.addEventListener("complete", onComplete);
    player.addEventListener("loadError", onErr);

    const failsafeTimer = setTimeout(() => {
      finish();
    }, SPLASH_ANIMATION_FAILSAFE_MS);
  });
}

async function runSplashThenBootstrap(): Promise<void> {
  const splash = document.createElement("div");
  splash.id = "splash-screen";
  splash.setAttribute("aria-hidden", "true");

  const stage = document.createElement("div");
  stage.className = "splash-stage";

  const canvas = document.createElement("canvas");
  canvas.className = "splash-canvas";

  stage.appendChild(canvas);
  splash.appendChild(stage);
  document.body.appendChild(splash);

  let player: DotLottie | null = null;
  try {
    player = new DotLottie({
      canvas,
      src: splashAnimationUrl,
      autoplay: true,
      loop: false,
      layout: { fit: "contain", align: [0.5, 0.5] },
      backgroundColor: "transparent",
      renderConfig: { autoResize: true },
    });
  } catch (e) {
    console.error(e);
  }

  await Promise.all([bootstrap(), waitForSplashAnimationComplete(player)]);

  splash.classList.add("splash-out");
  player?.destroy();

  await new Promise<void>((resolve) => {
    setTimeout(resolve, SPLASH_FADE_MS);
  });
  splash.remove();
}

async function bootstrap(): Promise<void> {
  if (inTauri) {
    store = await Store.load(STORE_FILE, {
      defaults: {},
      autoSave: 200,
    });
    libraryRoot = (await store.get<string>("libraryRoot")) ?? null;
    recentSearches = (await store.get<string[]>("recentSearches")) ?? [];
    const stored = await store.get<unknown>("appearance");
    appearance = normalizeAppearance(stored ?? undefined);
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
    try {
      const rawA = localStorage.getItem(LS_APPEARANCE);
      appearance = normalizeAppearance(rawA ? JSON.parse(rawA) : undefined);
    } catch {
      appearance = { ...DEFAULT_APPEARANCE };
    }
  }

  document.title = appearance.appTitle;
  applyAppearance(appearance);

  if (libraryRoot) {
    await refreshIndex();
  } else {
    settingsOpen = true;
    render();
  }
}

void runSplashThenBootstrap();
