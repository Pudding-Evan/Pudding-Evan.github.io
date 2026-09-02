const siteScript = document.currentScript;


function normalizeArticleTag(tag) {
  return (tag || "").trim().toLowerCase();
}

function articleRowTags(row) {
  return (row.dataset.tags || row.dataset.tag || "")
    .split(/[\s,，|\/]+/)
    .map(normalizeArticleTag)
    .filter(Boolean);
}

function setupArticleTagFilter() {
  const browser = document.querySelector("[data-article-browser]");
  if (!browser) return;

  const controls = Array.from(browser.querySelectorAll("[data-tag-filter], [data-category-filter]"));
  const rows = Array.from(browser.querySelectorAll("[data-tag], [data-tags]"));
  const empty = browser.querySelector("[data-archive-empty]");
  if (!controls.length || !rows.length) return;

  const availableTags = new Set(
    controls
      .filter((control) => control.hasAttribute("data-tag-filter"))
      .map((control) => normalizeArticleTag(control.dataset.tagFilter)),
  );
  const availableCategories = new Set(
    controls
      .filter((control) => control.hasAttribute("data-category-filter"))
      .map((control) => normalizeArticleTag(control.dataset.categoryFilter)),
  );

  function filterFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const category = normalizeArticleTag(params.get("category"));
    if (availableCategories.has(category)) return { type: "category", value: category };

    const tag = normalizeArticleTag(params.get("tag"));
    return { type: "tag", value: availableTags.has(tag) ? tag : "all" };
  }

  function applyFilter(nextFilter, updateUrl) {
    const requestedType = nextFilter?.type === "category" ? "category" : "tag";
    const requestedValue = normalizeArticleTag(nextFilter?.value);
    const isAvailable = requestedType === "category"
      ? availableCategories.has(requestedValue)
      : availableTags.has(requestedValue);
    const activeFilter = isAvailable
      ? { type: requestedType, value: requestedValue }
      : { type: "tag", value: "all" };
    let visibleCount = 0;

    controls.forEach((control) => {
      const controlType = control.hasAttribute("data-category-filter") ? "category" : "tag";
      const controlValue = normalizeArticleTag(
        controlType === "category" ? control.dataset.categoryFilter : control.dataset.tagFilter,
      );
      const isActive = controlType === activeFilter.type && controlValue === activeFilter.value;
      control.setAttribute("aria-pressed", String(isActive));
      control.classList.toggle("is-active", isActive);
    });

    rows.forEach((row) => {
      const collection = normalizeArticleTag(row.dataset.collection || "");
      const visible = activeFilter.type === "category"
        ? collection === activeFilter.value
        : activeFilter.value === "all" || (!collection && articleRowTags(row).includes(activeFilter.value));
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    browser.querySelectorAll("[data-article-group]").forEach((group) => {
      const groupRows = Array.from(group.querySelectorAll("[data-tag], [data-tags]"));
      const groupVisibleCount = groupRows.filter((row) => !row.hidden).length;
      group.hidden = groupVisibleCount === 0;
      const count = group.querySelector("[data-group-count]");
      if (count) count.textContent = String(groupVisibleCount).padStart(2, "0");
    });

    if (empty) empty.hidden = visibleCount > 0;

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.delete("tag");
      url.searchParams.delete("category");
      if (activeFilter.type === "category") {
        url.searchParams.set("category", activeFilter.value);
      } else if (activeFilter.value !== "all") {
        url.searchParams.set("tag", activeFilter.value);
      }
      window.history.pushState(activeFilter, "", url);
    } else {
      window.history.replaceState(activeFilter, "", window.location.href);
    }
  }

  browser.addEventListener("click", (event) => {
    const control = event.target?.closest?.("[data-tag-filter], [data-category-filter]");
    if (!control || !browser.contains(control)) return;
    event.preventDefault();
    const type = control.hasAttribute("data-category-filter") ? "category" : "tag";
    const value = type === "category" ? control.dataset.categoryFilter : control.dataset.tagFilter;

    applyFilter({ type, value }, true);
  });

  window.addEventListener("popstate", () => applyFilter(filterFromUrl(), false));
  applyFilter(filterFromUrl(), false);
}

setupArticleTagFilter();

function setupHomeScrollReveal() {
  const sections = Array.from(document.querySelectorAll("[data-home-section]"));
  if (!sections.length) return;

  document.documentElement.classList.add("has-scroll-reveal");

  if (!("IntersectionObserver" in window)) {
    sections.forEach((section) => section.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
        }
      });
    },
    {
      rootMargin: "-12% 0px -38%",
      threshold: 0.18,
    },
  );

  sections[0]?.classList.add("is-visible");
  sections.forEach((section) => observer.observe(section));
}

setupHomeScrollReveal();

function setupHomeWheelSnap() {
  const panels = Array.from(document.querySelectorAll("[data-home-section]"));
  if (panels.length < 2) return;

  const desktop = window.matchMedia("(min-width: 861px)");
  const root = document.documentElement;
  let isSnapping = false;
  const freeScrollThreshold = 32;

  function snapTops() {
    const header = document.querySelector(".site-header");
    const headerHeight = header?.offsetHeight || 0;
    const viewportHeight = Math.max(1, window.innerHeight - headerHeight);
    return panels.map((panel, index) => {
      if (index === 0) return 0;
      const centerOffset = Math.max(0, (viewportHeight - panel.offsetHeight) / 2);
      return Math.max(0, panel.offsetTop - headerHeight - centerOffset);
    });
  }

  function lastSnapTop(tops = snapTops()) {
    return tops[tops.length - 1] || 0;
  }

  function updateFreeScroll(tops) {
    if (!desktop.matches) {
      root.classList.remove("is-home-free-scroll");
      return;
    }

    root.classList.toggle(
      "is-home-free-scroll",
      window.scrollY > lastSnapTop(tops) + freeScrollThreshold,
    );
  }

  function nearestPanelIndex(tops) {
    return tops.reduce((nearest, top, index) => {
      return Math.abs(top - window.scrollY) < Math.abs(tops[nearest] - window.scrollY)
        ? index
        : nearest;
    }, 0);
  }

  window.addEventListener("scroll", () => updateFreeScroll(), { passive: true });
  desktop.addEventListener?.("change", () => updateFreeScroll());
  updateFreeScroll();

  window.addEventListener(
    "wheel",
    (event) => {
      if (!desktop.matches || isSnapping || Math.abs(event.deltaY) < 18) {
        return;
      }

      const tops = snapTops();
      const lastTop = lastSnapTop(tops);
      if (window.scrollY > lastTop + freeScrollThreshold) {
        return;
      }

      const current = nearestPanelIndex(tops);
      if (current === panels.length - 1 && event.deltaY > 0) {
        root.classList.add("is-home-free-scroll");
        return;
      }

      const next = Math.max(0, Math.min(panels.length - 1, current + (event.deltaY > 0 ? 1 : -1)));
      if (next === current) return;

      event.preventDefault();
      isSnapping = true;
      root.classList.remove("is-home-free-scroll");
      window.scrollTo({ top: tops[next], behavior: "smooth" });
      window.setTimeout(() => {
        isSnapping = false;
        updateFreeScroll();
      }, 760);
    },
    { passive: false },
  );
}

// Native free scrolling keeps reading behavior predictable across both themes.

if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener("load", () => {
    const isLocalPreview = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    if (isLocalPreview) {
      navigator.serviceWorker.getRegistrations?.().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
      return;
    }

    const workerUrl = new URL("sw.js", siteScript?.src || window.location.href);
    navigator.serviceWorker.register(workerUrl, { scope: new URL("./", workerUrl).pathname }).catch(() => {
      // The site still works when a preview server does not expose a root worker.
    });
  });
}
