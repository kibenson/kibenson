const SHANGHAI = "Asia/Shanghai";
const SEOUL = "Asia/Seoul";

const EVENT_TYPES = [
  "正规专辑",
  "迷你专辑",
  "单曲",
  "先行曲",
  "出道",
  "演唱会",
  "签售",
  "快闪",
  "其他",
];

function pad(value) {
  return String(value).padStart(2, "0");
}

function partsIn(date, timeZone) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(formatted.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function formatIn(date, timeZone) {
  const parts = partsIn(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatBeijing(date) {
  return formatIn(date, SHANGHAI);
}

function formatKorea(date) {
  return formatIn(date, SEOUL);
}

function shanghaiMidnight(now, offsetDays) {
  const parts = partsIn(now, SHANGHAI);
  const shifted = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offsetDays));
  return new Date(`${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T00:00:00+08:00`);
}

function windowBounds(now, name) {
  if (name === "today") return [shanghaiMidnight(now, 0), now];
  if (name === "7d") return [shanghaiMidnight(now, -6), now];
  if (name === "30d") return [shanghaiMidnight(now, -29), now];
  if (name === "yesterday") return [shanghaiMidnight(now, -1), shanghaiMidnight(now, 0)];
  if (name === "next7") return [shanghaiMidnight(now, 0), shanghaiMidnight(now, 7)];
  throw new Error(`unknown window ${name}`);
}

function birthdayKey(value) {
  if (!value) return null;
  const matched = String(value).match(/(\d{2})-(\d{2})$/);
  return matched ? `${matched[1]}-${matched[2]}` : null;
}

function peopleById(db) {
  return new Map(db.people.map((person) => [person.id, person]));
}

function isPublicPerson(person) {
  return Boolean(person) && person.published !== false;
}

function visiblePeople(db) {
  return db.people.filter(isPublicPerson);
}

function visibleEvents(db) {
  const people = peopleById(db);
  return db.events.filter((event) => {
    const person = people.get(event.person_id);
    return event.published !== false && isPublicPerson(person) && Array.isArray(event.sources) && event.sources.length > 0;
  });
}

function displayTitle(event) {
  return event.title ? event.title : "作品名未公布";
}

function eventView(db, event) {
  const person = peopleById(db).get(event.person_id);
  return {
    id: event.id,
    personId: event.person_id,
    personName: person.name_zh,
    title: displayTitle(event),
    rawTitle: event.title || "",
    type: event.type,
    status: event.status,
    startsAt: event.starts_at ? new Date(event.starts_at) : null,
    windowText: event.window_text || "",
    note: event.note || "",
    sources: event.sources,
  };
}

function matchesType(event, typeFilter) {
  return !typeFilter || typeFilter === "全部" || event.type === typeFilter;
}

function monthGroups(db, year, month, typeFilter) {
  const prefix = `${year}-${pad(month)}-`;
  const groups = new Map();
  visibleEvents(db)
    .filter((event) => event.status === "scheduled" && event.starts_at && matchesType(event, typeFilter))
    .map((event) => eventView(db, event))
    .filter((event) => formatBeijing(event.startsAt).startsWith(prefix))
    .sort((a, b) => a.startsAt - b.startsAt)
    .forEach((event) => {
      const day = formatBeijing(event.startsAt).slice(0, 10);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(event);
    });
  return [...groups.entries()];
}

function tentativeList(db, typeFilter) {
  return visibleEvents(db)
    .filter((event) => event.status === "tentative" && matchesType(event, typeFilter))
    .map((event) => eventView(db, event));
}

function getEvent(db, id) {
  const event = visibleEvents(db).find((item) => item.id === Number(id));
  return event ? eventView(db, event) : null;
}

function scopeIds(db, followedIds) {
  if (followedIds == null) return null;
  const allowed = new Set(followedIds.map(Number));
  visiblePeople(db).forEach((person) => {
    if (person.group_id != null && allowed.has(person.group_id)) allowed.add(person.id);
  });
  return allowed;
}

function upcomingForPeople(db, followedIds, now) {
  const [start, end] = windowBounds(now, "next7");
  const allowed = scopeIds(db, followedIds);
  return visibleEvents(db)
    .filter((event) => event.status === "scheduled" && event.starts_at)
    .map((event) => eventView(db, event))
    .filter((event) => event.startsAt >= start && event.startsAt < end)
    .filter((event) => allowed == null || allowed.has(event.personId))
    .sort((a, b) => a.startsAt - b.startsAt);
}

function birthdaysForPeople(db, followedIds, now) {
  const days = new Set();
  for (let offset = 0; offset < 7; offset += 1) {
    days.add(formatBeijing(shanghaiMidnight(now, offset)).slice(5, 10));
  }
  const allowed = followedIds == null ? null : new Set(followedIds.map(Number));
  return visiblePeople(db)
    .filter((person) => person.kind !== "group" && birthdayKey(person.birthday) && days.has(birthdayKey(person.birthday)))
    .filter((person) => {
      if (allowed == null) return true;
      if (person.kind === "solo") return allowed.has(person.id);
      return person.group_id != null && allowed.has(person.group_id);
    })
    .map((person) => ({ id: person.id, name: person.name_zh, birthday: birthdayKey(person.birthday) }));
}

function latestSnapshot(rows, atOrBefore) {
  return rows
    .filter((row) => new Date(row.taken_at) <= atOrBefore)
    .sort((a, b) => new Date(a.taken_at) - new Date(b.taken_at))
    .at(-1);
}

function board(db, { metric, window, now, personIds = null, limit = null }) {
  const [start, end] = windowBounds(now, window);
  const field = metric === "subscribers" ? "subscriber_count" : "view_count";
  const allowed = personIds == null ? null : new Set(personIds.map(Number));
  const rows = [];
  visiblePeople(db)
    .filter((person) => (person.kind === "group" || person.kind === "solo") && person.youtube_channel_id)
    .filter((person) => allowed == null || allowed.has(person.id))
    .forEach((person) => {
      const snaps = (db.snapshots || []).filter((row) => row.person_id === person.id);
      const opening = latestSnapshot(snaps, start);
      const closing = latestSnapshot(snaps, end);
      if (!opening || !closing) return;
      const delta = closing[field] - opening[field];
      if (delta === 0) return;
      rows.push({
        personId: person.id,
        name: person.name_zh,
        total: closing[field],
        delta,
        percent: opening[field] === 0 ? null : delta / opening[field],
      });
    });
  const gainers = rows.filter((row) => row.delta > 0).sort((a, b) => b.delta - a.delta);
  const losers = rows.filter((row) => row.delta < 0).sort((a, b) => a.delta - b.delta);
  return {
    gainers: limit == null ? gainers : gainers.slice(0, limit),
    losers: limit == null ? losers : losers.slice(0, limit),
  };
}

function homeFeed(db, now, followedIds) {
  const scoped = followedIds == null ? null : followedIds;
  return {
    events: upcomingForPeople(db, scoped, now),
    birthdays: birthdaysForPeople(db, scoped, now),
    ...board(db, { metric: "views", window: "yesterday", now, personIds: scoped, limit: 5 }),
  };
}

function getPerson(db, id) {
  const person = visiblePeople(db).find((item) => item.id === Number(id));
  if (!person) return null;
  const group = person.group_id == null ? null : visiblePeople(db).find((item) => item.id === person.group_id);
  const members = visiblePeople(db)
    .filter((item) => item.group_id === person.id)
    .map((item) => ({ id: item.id, name: item.name_zh, birthday: birthdayKey(item.birthday) }));
  const snaps = (db.snapshots || [])
    .filter((row) => row.person_id === person.id)
    .sort((a, b) => new Date(a.taken_at) - new Date(b.taken_at));
  return {
    id: person.id,
    kind: person.kind,
    name: person.name_zh,
    foreignNames: person.foreign_names || [],
    company: person.company || "",
    debutOn: person.debut_on || "",
    birthday: birthdayKey(person.birthday),
    links: person.links || [],
    channelId: person.kind === "member" ? "" : person.youtube_channel_id || "",
    groupId: group ? group.id : null,
    groupName: group ? group.name_zh : "",
    members,
    subscriberCount: snaps.length ? snaps.at(-1).subscriber_count : null,
    events: visibleEvents(db)
      .filter((event) => event.person_id === person.id)
      .map((event) => eventView(db, event))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "scheduled" ? -1 : 1;
        if (!a.startsAt) return 1;
        if (!b.startsAt) return -1;
        return a.startsAt - b.startsAt;
      }),
  };
}

function movementForPerson(db, personId, now) {
  const person = getPerson(db, personId);
  if (!person || !person.channelId) return null;
  return ["today", "7d", "30d"].map((window) => {
    const result = board(db, { metric: "views", window, now, personIds: [personId] });
    const subs = board(db, { metric: "subscribers", window, now, personIds: [personId] });
    const views = [...result.gainers, ...result.losers][0] || null;
    const subscribers = [...subs.gainers, ...subs.losers][0] || null;
    return { window, views, subscribers };
  });
}

function searchPeople(db, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [];
  return visiblePeople(db)
    .filter((person) => {
      const names = [person.name_zh, ...(person.foreign_names || [])];
      return names.some((name) => String(name).toLowerCase().includes(needle));
    })
    .map((person) => ({ id: person.id, name: person.name_zh, kind: person.kind }));
}

const api = {
  EVENT_TYPES,
  formatBeijing,
  formatKorea,
  windowBounds,
  monthGroups,
  tentativeList,
  getEvent,
  upcomingForPeople,
  birthdaysForPeople,
  board,
  homeFeed,
  getPerson,
  movementForPerson,
  searchPeople,
};

if (typeof module !== "undefined") module.exports = api;
if (typeof window !== "undefined") window.FanLogic = api;
