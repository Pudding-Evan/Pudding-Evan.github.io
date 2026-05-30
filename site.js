const siteScript = document.currentScript;

const SIDE_DECOR_ITEMS = [
  { side: "left", kind: "chest", x: 38, y: 8, label: "宝箱" },
  { side: "left", kind: "stone", x: 78, y: 18, label: "小石头" },
  { side: "left", kind: "key", x: 24, y: 31, label: "钥匙" },
  { side: "left", kind: "coin", x: 68, y: 45, label: "金币" },
  { side: "left", kind: "potion", x: 42, y: 61, label: "药水" },
  { side: "left", kind: "stone small", x: 18, y: 73, label: "碎石" },
  { side: "left", kind: "spark", x: 80, y: 84, label: "星光" },
  { side: "right", kind: "key", x: 58, y: 10, label: "钥匙" },
  { side: "right", kind: "stone small", x: 22, y: 24, label: "碎石" },
  { side: "right", kind: "chest", x: 30, y: 38, label: "宝箱" },
  { side: "right", kind: "spark", x: 74, y: 51, label: "星光" },
  { side: "right", kind: "potion", x: 52, y: 66, label: "药水" },
  { side: "right", kind: "coin", x: 20, y: 79, label: "金币" },
  { side: "right", kind: "stone", x: 72, y: 88, label: "小石头" },
];

const SIDE_DECOR_LINKS = {
  left: [
    { x: 48, y: 15, h: 64, rotate: 32 },
    { x: 26, y: 39, h: 58, rotate: -24 },
    { x: 58, y: 53, h: 56, rotate: 18 },
    { x: 34, y: 71, h: 50, rotate: 66 },
  ],
  right: [
    { x: 52, y: 17, h: 62, rotate: -30 },
    { x: 34, y: 34, h: 52, rotate: 24 },
    { x: 58, y: 58, h: 54, rotate: -18 },
    { x: 38, y: 77, h: 48, rotate: -58 },
  ],
};

function buildSideDecor() {
  if (document.querySelector(".side-quest")) return;

  ["left", "right"].forEach((side) => {
    const rail = document.createElement("div");
    rail.className = `side-quest side-quest-${side}`;
    rail.setAttribute("aria-hidden", "true");

    SIDE_DECOR_LINKS[side].forEach((link) => {
      const line = document.createElement("span");
      line.className = "decor-link";
      line.style.setProperty("--x", `${link.x}%`);
      line.style.setProperty("--y", `${link.y}%`);
      line.style.setProperty("--h", `${link.h}px`);
      line.style.setProperty("--r", `${link.rotate}deg`);
      rail.append(line);
    });

    SIDE_DECOR_ITEMS.filter((item) => item.side === side).forEach((item) => {
      const node = document.createElement("span");
      node.className = `decor-item decor-${item.kind}`;
      node.style.setProperty("--x", `${item.x}%`);
      node.style.setProperty("--y", `${item.y}%`);
      node.setAttribute("aria-label", item.label);
      rail.append(node);
    });

    document.body.prepend(rail);
  });
}

buildSideDecor();

if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener("load", () => {
    const workerUrl = new URL("sw.js", siteScript?.src || window.location.href);
    navigator.serviceWorker.register(workerUrl, { scope: new URL("./", workerUrl).pathname }).catch(() => {
      // The site still works when a preview server does not expose a root worker.
    });
  });
}
