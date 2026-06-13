const siteScript = document.currentScript;

function normalizeArticleTag(tag) {
  return (tag || "all").trim().toLowerCase();
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

  const controls = Array.from(browser.querySelectorAll("[data-tag-filter]"));
  const rows = Array.from(browser.querySelectorAll("[data-tag], [data-tags]"));
  const empty = browser.querySelector("[data-archive-empty]");
  if (!controls.length || !rows.length) return;

  const availableTags = new Set(
    controls.map((control) => normalizeArticleTag(control.dataset.tagFilter)),
  );

  function applyFilter(nextTag, updateUrl) {
    const requestedTag = normalizeArticleTag(nextTag);
    const activeTag = availableTags.has(requestedTag) ? requestedTag : "all";
    let visibleCount = 0;

    controls.forEach((control) => {
      const isActive = normalizeArticleTag(control.dataset.tagFilter) === activeTag;
      control.setAttribute("aria-pressed", String(isActive));
      control.classList.toggle("is-active", isActive);
    });

    rows.forEach((row) => {
      const visible = activeTag === "all" || articleRowTags(row).includes(activeTag);
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    if (empty) {
      empty.hidden = visibleCount > 0;
    }

    if (updateUrl) {
      const url = new URL(window.location.href);
      if (activeTag === "all") {
        url.searchParams.delete("tag");
      } else {
        url.searchParams.set("tag", activeTag);
      }
      window.history.pushState({ tag: activeTag }, "", url);
    } else {
      window.history.replaceState({ tag: activeTag }, "", window.location.href);
    }
  }

  browser.addEventListener("click", (event) => {
    const control = event.target?.closest?.("[data-tag-filter]");
    if (!control || !browser.contains(control)) return;
    event.preventDefault();
    applyFilter(control.dataset.tagFilter, true);
  });

  window.addEventListener("popstate", () => {
    applyFilter(new URLSearchParams(window.location.search).get("tag"), false);
  });

  applyFilter(new URLSearchParams(window.location.search).get("tag"), false);
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

setupHomeWheelSnap();

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
