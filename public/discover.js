"use strict";

function card(person) {
  const link = document.createElement("a");
  link.className = "person";
  link.href = person.url;
  const name = document.createElement("h2");
  name.textContent = person.name;
  const title = document.createElement("p");
  title.textContent = [person.title, person.city].filter(Boolean).join(" · ");
  link.append(name, title);
  if (person.example) {
    const flag = document.createElement("p");
    flag.className = "demo-note";
    flag.textContent = "示例";
    link.append(flag);
  }
  if (person.tags && person.tags.length) {
    const tags = document.createElement("p");
    tags.textContent = person.tags.join(" / ");
    link.append(tags);
  }
  if (person.services && person.services.length) {
    const services = document.createElement("p");
    services.textContent = person.services.map((item) => `${item.name}${item.price ? ` ${item.price}` : ""}`).join("；");
    link.append(services);
  }
  return link;
}

async function search(q) {
  const response = await fetch(`/api/discover?q=${encodeURIComponent(q)}`);
  const data = await response.json();
  const results = document.querySelector("#results");
  const empty = document.querySelector("#empty");
  results.replaceChildren();
  if (!data.results.length) {
    empty.classList.remove("hidden");
    empty.textContent = q
      ? `没有找到和「${q}」匹配的人。换个词试试，比如「民宿」或「双月湾」。`
      : "还没有已发布的网站。";
    return;
  }
  empty.classList.add("hidden");
  for (const person of data.results) results.append(card(person));
}

fetch("/api/config").then((response) => response.json()).then((config) => {
  document.querySelector("#model-notice").textContent = config.modelNotice || "";
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
search(initial);
