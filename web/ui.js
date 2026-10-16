const logic = window.FanLogic;
const db = window.FAN_DB;
const FOLLOW_KEY = "fan-follows";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function readFollows() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLLOW_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(Number).filter((id) => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

function writeFollows(ids) {
  localStorage.setItem(FOLLOW_KEY, JSON.stringify([...new Set(ids)]));
}

function params() {
  return new URLSearchParams(location.search);
}

function formatCount(value) {
  return Number(value).toLocaleString("zh-CN");
}

function formatDelta(value) {
  const sign = value > 0 ? "+" : "";
  return sign + formatCount(value);
}

function formatPercent(ratio) {
  if (ratio == null) return "";
  const pct = ratio * 100;
  const digits = Math.abs(pct) >= 10 ? 1 : 2;
  const text = pct.toFixed(digits);
  return `${pct > 0 ? "+" : ""}${text}%`;
}

function eventLine(event) {
  const time = event.startsAt ? logic.formatBeijing(event.startsAt).slice(11) : event.windowText;
  return `<a class="row" href="event.html?id=${event.id}">
    <span class="when">${esc(time)}</span>
    <span><span class="name">${esc(event.personName)}</span>
    <span class="meta">${esc(event.type)} · ${esc(event.title)}</span></span>
  </a>`;
}

function renderHome(root) {
  const query = params();
  const follows = readFollows();
  const scope = query.get("scope") || (follows.length ? "following" : "all");
  const followedIds = scope === "following" ? follows : null;
  const feed = logic.homeFeed(db, new Date(), followedIds);
  const switcher = follows.length
    ? `<p class="switch">
        <a href="index.html"${scope === "following" ? ' aria-current="page"' : ""}>只看关注</a>
        <a href="index.html?scope=all"${scope === "all" ? ' aria-current="page"' : ""}>看全部</a>
      </p>`
    : "";
  const events = feed.events.length ? feed.events.map(eventLine).join("") : `<p class="empty">这七天没有已定档。</p>`;
  const birthdays = feed.birthdays.length
    ? feed.birthdays.map((person) => `<a class="row" href="person.html?id=${person.id}"><span class="when">${esc(person.birthday)}</span><span class="name">${esc(person.name)}</span></a>`).join("")
    : `<p class="empty">这七天没有生日。</p>`;
  const movers = (rows, direction) => {
    if (!rows.length) return `<p class="empty">${direction === "up" ? "没有上涨。" : "没有下跌。"}</p>`;
    return rows.map((row) => `<a class="row" href="person.html?id=${row.personId}">
      <span class="when">${direction === "up" ? "涨" : "跌"}</span>
      <span><span class="name">${esc(row.name)}</span>
      <span class="delta ${direction}">${esc(formatDelta(row.delta))} ${esc(formatPercent(row.percent))}</span></span>
    </a>`).join("");
  };
  root.innerHTML = `
    <h1>这周</h1>
    <p class="lede">回归、生日、昨天的播放增量。</p>
    ${switcher}
    <section><h2>未来七天</h2><div class="card">${events}</div></section>
    <section><h2>即将生日</h2><div class="card">${birthdays}</div></section>
    <section><h2>昨天播放增量</h2>
      <div class="card">${movers(feed.gainers, "up")}${movers(feed.losers, "down")}</div>
    </section>`;
}

function renderCalendar(root) {
  const now = new Date();
  const current = logic.formatBeijing(now).slice(0, 7);
  const month = params().get("month") || current;
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const type = params().get("type") || "";
  const groups = logic.monthGroups(db, year, monthNumber, type || null);
  const tentative = logic.tentativeList(db, type || null);
  const shift = (delta) => {
    const moved = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
    const next = `${moved.getUTCFullYear()}-${String(moved.getUTCMonth() + 1).padStart(2, "0")}`;
    const typeQuery = type ? `&type=${encodeURIComponent(type)}` : "";
    return `calendar.html?month=${next}${typeQuery}`;
  };
  const days = groups.length
    ? groups.map(([day, events]) => `<div class="day"><h3>${esc(day)}</h3>${events.map(eventLine).join("")}</div>`).join("")
    : `<p class="empty">这个月没有已定档。</p>`;
  const pending = tentative.length
    ? tentative.map((event) => `<a class="row" href="event.html?id=${event.id}"><span class="when">待定</span><span><span class="name">${esc(event.personName)}</span> <span class="meta">${esc(event.windowText)} · ${esc(event.title)}</span></span></a>`).join("")
    : `<p class="empty">没有待定。</p>`;
  const filters = ["全部", ...logic.EVENT_TYPES].map((item) => {
    const href = item === "全部" ? `calendar.html?month=${month}` : `calendar.html?month=${month}&type=${encodeURIComponent(item)}`;
    const currentType = type || "全部";
    return `<a href="${href}"${currentType === item ? ' aria-current="page"' : ""}>${esc(item)}</a>`;
  }).join("");
  root.innerHTML = `
    <h1>${esc(month)}</h1>
    <p class="months"><a href="${shift(-1)}">上个月</a><a href="${shift(1)}">下个月</a></p>
    <p class="filters">${filters}</p>
    ${days}
    <section><h2>待定</h2><div class="card">${pending}</div></section>`;
}

function renderEvent(root) {
  const event = logic.getEvent(db, params().get("id"));
  if (!event) {
    root.innerHTML = `<h1>找不到这条发行</h1>`;
    return;
  }
  const clocks = event.status === "scheduled" && event.startsAt
    ? `<p class="clock"><span>北京时间</span> ${esc(logic.formatBeijing(event.startsAt))}</p>
       <p class="clock"><span>韩国时间</span> ${esc(logic.formatKorea(event.startsAt))}</p>`
    : `<p class="clock"><span>待定</span> ${esc(event.windowText)}</p>`;
  const note = event.note ? `<p>${esc(event.note)}</p>` : "";
  const sources = event.sources.map((source) => `<a href="${esc(source.url)}">${esc(source.label)}</a>`).join("");
  root.innerHTML = `
    <p class="meta"><span class="pill">${esc(event.type)}</span>${event.status === "scheduled" ? "已定档" : "待定"}</p>
    <h1>${esc(event.title)}</h1>
    <p><a class="name" href="person.html?id=${event.personId}">${esc(event.personName)}</a></p>
    ${clocks}
    ${note}
    <p class="sources">${sources}</p>`;
}

function renderPerson(root) {
  const person = logic.getPerson(db, params().get("id"));
  if (!person) {
    root.innerHTML = `<h1>找不到这个人</h1>`;
    return;
  }
  const follows = readFollows();
  const followed = follows.includes(person.id);
  const follow = person.kind === "member"
    ? ""
    : `<p><button type="button" id="follow" aria-pressed="${followed ? "true" : "false"}">${followed ? "已关注" : "关注"}</button></p>`;
  const group = person.groupId ? `<p>团体 <a href="person.html?id=${person.groupId}">${esc(person.groupName)}</a></p>` : "";
  const members = person.members.length
    ? `<section><h2>成员</h2><div class="card">${person.members.map((member) => `<a class="row" href="person.html?id=${member.id}"><span class="when">${esc(member.birthday || "")}</span><span class="name">${esc(member.name)}</span></a>`).join("")}</div></section>`
    : "";
  const links = person.links.map((link) => `<a href="${esc(link.url)}">${esc(link.label)}</a>`).join(" ");
  const facts = [
    person.company ? `公司 ${esc(person.company)}` : "",
    person.debutOn ? `出道 ${esc(person.debutOn)}` : "",
    person.birthday ? `生日 ${esc(person.birthday)}` : "",
  ].filter(Boolean).join(" · ");
  const upcoming = person.events.filter((event) => event.status === "scheduled");
  const pending = person.events.filter((event) => event.status === "tentative");
  const now = new Date();
  const movements = logic.movementForPerson(db, person.id, now);
  const labels = { today: "当天", "7d": "近 7 天", "30d": "近 30 天" };
  let stats = "";
  if (person.channelId && (person.subscriberCount != null || (movements || []).some((item) => item.views || item.subscribers))) {
    const rows = (movements || []).map((item) => {
      const viewText = item.views ? `${formatDelta(item.views.delta)} ${formatPercent(item.views.percent)}` : "暂无";
      const subText = item.subscribers ? `${formatDelta(item.subscribers.delta)} ${formatPercent(item.subscribers.percent)}` : "暂无";
      return `<tr><th>${labels[item.window]}</th><td>${esc(viewText)}</td><td>${esc(subText)}</td></tr>`;
    }).join("");
    stats = `<section><h2>频道</h2><p>订阅 ${esc(formatCount(person.subscriberCount))}</p>
      <table><thead><tr><th></th><th>播放增量</th><th>订阅增量</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }
  root.innerHTML = `
    <h1>${esc(person.name)} <span class="foreign">${esc(person.foreignNames.join(" / "))}</span></h1>
    ${follow}
    <p class="meta">${facts}</p>
    ${group}
    <p class="sources">${links}</p>
    ${members}
    <section><h2>发行</h2><div class="card">${upcoming.length ? upcoming.map(eventLine).join("") : `<p class="empty">没有已定档。</p>`}</div></section>
    <section><h2>待定</h2><div class="card">${pending.length ? pending.map((event) => `<a class="row" href="event.html?id=${event.id}"><span class="when">待定</span><span>${esc(event.windowText)} · ${esc(event.title)}</span></a>`).join("") : `<p class="empty">没有待定。</p>`}</div></section>
    ${stats}`;
  const button = document.getElementById("follow");
  if (button) {
    button.addEventListener("click", () => {
      const next = readFollows().filter((id) => id !== person.id);
      if (!follows.includes(person.id)) next.push(person.id);
      writeFollows(next);
      renderPerson(root);
    });
  }
}

function renderRankings(root) {
  const windowName = params().get("window") || "today";
  const metric = params().get("metric") || "views";
  const result = logic.board(db, { metric, window: windowName, now: new Date(), personIds: null, limit: null });
  const windows = [["today", "当天"], ["7d", "近 7 天"], ["30d", "近 30 天"]];
  const metrics = [["views", "播放增量"], ["subscribers", "订阅增量"]];
  const links = (items, key) => items.map(([value, label]) => {
    const query = new URLSearchParams({ window: windowName, metric });
    query.set(key, value);
    const current = key === "window" ? windowName : metric;
    return `<a href="rankings.html?${query.toString()}"${current === value ? ' aria-current="page"' : ""}>${label}</a>`;
  }).join("");
  const list = (rows, direction) => rows.length
    ? rows.map((row, index) => `<a class="rank" href="person.html?id=${row.personId}"><span>${index + 1}</span><span class="name">${esc(row.name)}</span><span class="delta ${direction}">${direction === "up" ? "涨" : "跌"} ${esc(formatDelta(row.delta))} ${esc(formatPercent(row.percent))}<br><span class="meta">现在 ${esc(formatCount(row.total))}</span></span></a>`).join("")
    : `<p class="empty">这张榜是空的。</p>`;
  root.innerHTML = `
    <h1>变化榜</h1>
    <p class="filters">${links(windows, "window")}</p>
    <p class="filters">${links(metrics, "metric")}</p>
    <section><h2>涨</h2><div class="card">${list(result.gainers, "up")}</div></section>
    <section><h2>跌</h2><div class="card">${list(result.losers, "down")}</div></section>`;
}

function renderSearch(root) {
  const query = params().get("q") || "";
  const results = logic.searchPeople(db, query);
  const list = query && results.length
    ? results.map((person) => `<a class="row" href="person.html?id=${person.id}"><span class="name">${esc(person.name)}</span></a>`).join("")
    : query ? `<p class="empty">没有叫这个的人。</p>` : "";
  root.innerHTML = `
    <h1>搜索</h1>
    <form class="search" action="search.html">
      <input type="search" name="q" value="${esc(query)}" placeholder="中文名或外文名">
      <button type="submit">查找</button>
    </form>
    <div class="card">${list}</div>`;
}

const pages = {
  home: renderHome,
  calendar: renderCalendar,
  event: renderEvent,
  person: renderPerson,
  rankings: renderRankings,
  search: renderSearch,
};

const root = document.getElementById("app");
const page = document.body.dataset.page;
if (root && pages[page]) pages[page](root);
