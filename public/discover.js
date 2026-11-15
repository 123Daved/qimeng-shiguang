"use strict";

/*
 * 发现页：一句话找人。服务端负责把句子切成关键词并说明每位结果为什么匹配；
 * 这里只负责展示。所有用户内容用 textContent 写入，不拼接 HTML。
 */

const ICON = {
  user: '<circle cx="12" cy="9" r="3"/><path d="M6.5 19.2a5.5 5.5 0 0 1 11 0"/>',
  pin: '<path d="M12 20s6-5.4 6-10a6 6 0 0 0-12 0c0 4.6 6 10 6 10z"/><circle cx="12" cy="10" r="2.2"/>',
  search: '<circle cx="11" cy="11" r="5.5"/><path d="M15.5 15.5L20 20"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
};
const THEME_NAME = { warm: "温暖", simple: "简约", ink: "墨色", cinema: "光影", editorial: "杂志" };
// 无图时的封面：按名字生成固定的山形，同一个人每次都一样。
function seedOf(text) { let h = 7; for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h || 1; }
function ridge(seed, w, h) {
  let s = seed;
  const rand = () => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 1013904223) >>> 0; return s / 4294967296; };
  const points = [[0, h * (0.55 + rand() * 0.2)]];
  const peaks = 3 + Math.floor(rand() * 2);
  for (let i = 1; i <= peaks * 4; i += 1) points.push([(w * i) / (peaks * 4), h * (0.15 + rand() * 0.55)]);
  return `M0 ${h} ${points.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} L${w} ${h} Z`;
}

function svgIcon(name, cls) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", cls || "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = ICON[name] || "";
  return svg;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(person, index) {
  const link = el("a", "person");
  link.href = person.url;
  link.setAttribute("data-reveal", "");
  link.style.setProperty("--i", String(Math.min(index, 5)));

  const theme = THEME_NAME[person.theme] ? person.theme : "warm";
  const cover = el("div", `person-cover cover-${theme}`);
  cover.setAttribute("aria-hidden", "true");
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 400 100");
  svg.setAttribute("preserveAspectRatio", "none");
  const back = document.createElementNS(ns, "path");
  back.setAttribute("d", ridge(seedOf(person.slug), 400, 100));
  back.setAttribute("fill", "currentColor");
  back.setAttribute("opacity", "0.35");
  const front = document.createElementNS(ns, "path");
  front.setAttribute("d", ridge(seedOf(`${person.slug}~`), 400, 100).replace(/L(\S+) (\S+)/g, (m, x, y) => `L${x} ${Math.min(100, Number(y) + 22).toFixed(1)}`));
  front.setAttribute("fill", "currentColor");
  svg.append(back, front);
  cover.append(svg);
  if (person.example) cover.append(el("span", "tag tag-demo", "示例"));
  cover.append(el("span", "theme-name", THEME_NAME[theme]));
  cover.append(el("span", "mono", Array.from(person.name || "憩")[0]));
  link.append(cover);

  const body = el("div", "person-body");
  body.append(el("h2", "", person.name || "未命名"));
  const meta = el("p", "person-meta");
  if (person.title) { const t = el("span"); t.append(svgIcon("user"), document.createTextNode(person.title)); meta.append(t); }
  if (person.city) { const c = el("span"); c.append(svgIcon("pin"), document.createTextNode(person.city)); meta.append(c); }
  if (meta.childNodes.length) body.append(meta);
  if (person.tags && person.tags.length) {
    const tags = el("ul", "tags");
    person.tags.slice(0, 4).forEach((tag) => tags.append(el("li", "", tag)));
    body.append(tags);
  }
  if (person.services && person.services.length) {
    const list = el("ul", "svc");
    person.services.slice(0, 2).forEach((item) => {
      const li = el("li");
      li.append(el("span", "", item.name));
      if (item.price) li.append(el("b", "", item.price));
      list.append(li);
    });
    body.append(list);
  }
  if (person.seeking && person.seeking.length) {
    const seek = el("p", "seek");
    seek.append(svgIcon("search"), document.createTextNode(`TA 在找：${person.seeking.join("、")}`));
    body.append(seek);
  }
  if (person.matched && person.matched.length) {
    body.append(el("p", "why", `匹配：${person.matched.map((item) => `${item.field}「${item.term}」`).join(" · ")}`));
  }
  const go = el("span", "go", "查看主页");
  go.append(svgIcon("arrow"));
  body.append(go);
  link.append(body);
  return link;
}

function showUnderstood(data) {
  const box = document.querySelector("#understood");
  box.replaceChildren();
  if (!data.terms || !data.terms.length) return;
  box.append(document.createTextNode("我理解你要找："));
  data.terms.forEach((term) => box.append(el("span", "tag", term)));
}

function showEmpty(q, total) {
  const empty = document.querySelector("#empty");
  empty.className = "empty-state";
  empty.replaceChildren();
  empty.append(el("h2", "", q ? "没有找到匹配的人" : "还没有已发布的网站"));
  empty.append(el("p", "", q
    ? `目前一共只有 ${total} 位已发布的人，我们不会为了好看而编造结果。换个说法试试，或者自己做一个主页，让别人来找你。`
    : "第一个发布的人会出现在这里。"));
  const cta = el("a", "primary", "我也做一个");
  cta.href = "/";
  empty.append(cta);
}

async function search(q) {
  const results = document.querySelector("#results");
  const count = document.querySelector("#result-count");
  count.textContent = "正在找…";
  let data;
  try {
    const response = await fetch(`/api/discover?q=${encodeURIComponent(q)}`);
    data = await response.json();
    if (!response.ok) throw new Error(data.error || "没有完成");
  } catch (error) {
    count.textContent = "";
    results.replaceChildren();
    const empty = document.querySelector("#empty");
    empty.className = "banner warn";
    empty.replaceChildren(svgIcon("alert"), el("span", "", "现在连不上服务，请检查网络后再试一次。"));
    return;
  }
  results.replaceChildren();
  showUnderstood(data);
  const n = data.results.length;
  count.textContent = n ? (q ? `找到 ${n} 位` : `已发布 ${n} 位`) : "";
  if (!n) { showEmpty(q, data.total || 0); return; }
  document.querySelector("#empty").className = "hidden";
  data.results.forEach((person, index) => results.append(card(person, index)));
  if (window.QDMotion) window.QDMotion.observe(results);
}

fetch("/api/config").then((response) => response.json()).then((config) => {
  const notice = document.querySelector("#model-notice");
  if (notice) notice.textContent = config.modelNotice || "";
}).catch(() => {});

const initial = new URLSearchParams(location.search).get("q") || "";
document.querySelector("#q").value = initial;
document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const q = document.querySelector("#q").value.trim();
  const next = new URL(location.href);
  if (q) next.searchParams.set("q", q); else next.searchParams.delete("q");
  history.replaceState(null, "", next);
  search(q);
});
document.querySelectorAll("#suggest [data-q]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelector("#q").value = chip.dataset.q;
    document.querySelector("#search-form").requestSubmit();
  });
});
search(initial);
