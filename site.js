const siteScript = document.currentScript;

if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener("load", () => {
    const workerUrl = new URL("sw.js", siteScript?.src || window.location.href);
    navigator.serviceWorker.register(workerUrl, { scope: new URL("./", workerUrl).pathname }).catch(() => {
      // The site still works when a preview server does not expose a root worker.
    });
  });
}
