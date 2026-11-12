"use strict";

function icon(name) {
  return (window.QDIcons && window.QDIcons.icon(name)) || "";
}

function card(person, index) {
  const link = document.createElement("a");
  link.className = "person";
  link.href = person.url;
  link.setAttribute("data-reveal", "");
  link.style.setProperty("--i", String(Math.min(index, 6)));
  const head = document.createElement("div");
  head.className = "person-head";
  const name = document.createElement("h2");
  name.textContent = person.name;
  const go = document.createElement("span");
  go.className = "person-go";
  go.innerHTML = `打开网站${icon("arrow")}`;
  head.append(name, go);
  link.append(head);
  const title = document.createElement("p");
  title.className = "person-meta";
  title.textContent = [person.title, person.city].filter(Boolean).join(" · ");
  if (title.textContent) link.append(title);
  if (person.example) {
    const flag = document.createElement("p");
    flag.className = "person-flag";
    flag.textContent = "示例";
    link.append(flag);
  }
  if (person.tags && person.tags.length) {
    const tags = document.createElement("ul");
    tags.className = "tags";
    for (const tag of person.tags.slice(0, 6)) {
      const item = document.createElement("li");
      item.textContent = tag;
      tags.append(item);
    }
    link.append(tags);
  }
  if (person.services && person.services.length) {
    const services = document.createElement("p");
    services.className = "person-meta";
    services.textContent = person.services.map((item) => `${item.name}${item.price ? ` ${item.price}` : ""}`).join("；");
    link.append(services);
  }
  return link;
}

function setEmpty(node, text) {
  node.classList.remove("hidden");
  node.replaceChildren();
  node.insertAdjacentHTML("beforeend", icon("search"));
  const p = document.createElement("span");
  p.textContent = text;
  node.append(p);
}

async function search(q) {
  const response = await fetch(`/api/discover?q=${encodeURIComponent(q)}`);
  const data = await response.json();
  const results = document.querySelector("#results");
  const empty = document.querySelector("#empty");
  const count = document.querySelector("#result-count");
  results.replaceChildren();
  count.textContent = data.results.length
    ? (q ? `「${q}」找到 ${data.results.length} 位` : `已发布 ${data.results.length} 位`)
    : "";
  if (!data.results.length) {
    setEmpty(empty, q
      ? `没有找到和「${q}」匹配的人。换个词试试，比如「民宿」或「双月湾」。`
      : "还没有已发布的网站。");
    return;
  }
  empty.classList.add("hidden");
  data.results.forEach((person, index) => results.append(card(person, index)));
  if (window.QDMotion) window.QDMotion.observe(results);
}

fetch("/api/config").then((response) => response.json()).then((config) => {
  const notice = document.querySelector("#model-notice");
  if (notice) notice.textContent = config.modelNotice || "";
});

const initial = new URLSearchParams(location.search).get("q") || "";
document.querySelector("#q").value = initial;
document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const q = document.querySelector("#q").value.trim();
  const next = new URL(location.href);
  if (q) next.searchParams.set("q", q);
  else next.searchParams.delete("q");
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
