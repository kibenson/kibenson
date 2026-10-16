const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatBeijing,
  formatKorea,
  windowBounds,
  monthGroups,
  tentativeList,
  getEvent,
  homeFeed,
  board,
  getPerson,
  searchPeople,
} = require("../web/logic.js");

const NOW = new Date("2026-10-16T07:30:00Z");

function sample() {
  return {
    people: [
      { id: 1, kind: "group", name_zh: "测试团", foreign_names: ["IVE"], youtube_channel_id: "UCgroup", published: true },
      { id: 2, kind: "member", name_zh: "成员甲", birthday: "10-16", group_id: 1, youtube_channel_id: "UCmember", published: true },
      { id: 3, kind: "group", name_zh: "别的团", youtube_channel_id: "UCother", published: true },
      { id: 4, kind: "group", name_zh: "未公开团", published: false },
      { id: 5, kind: "solo", name_zh: "零底", youtube_channel_id: "UCzero", published: true },
      { id: 6, kind: "group", name_zh: "没起点", youtube_channel_id: "UCnostart", published: true },
      { id: 7, kind: "group", name_zh: "没变化", youtube_channel_id: "UCflat", published: true },
    ],
    events: [
      {
        id: 1,
        person_id: 1,
        title: "已定单曲",
        type: "单曲",
        status: "scheduled",
        starts_at: "2026-10-16T10:00:00Z",
        sources: [{ label: "官方 X", url: "https://example.com/x" }],
        published: true,
      },
      {
        id: 2,
        person_id: 1,
        title: "待定专辑",
        type: "正规专辑",
        status: "tentative",
        window_text: "2026 年第四季度",
        sources: [{ label: "官方公告", url: "https://example.com/notice" }],
        published: true,
      },
      { id: 3, person_id: 1, title: "隐藏", type: "单曲", status: "scheduled", starts_at: "2026-10-16T10:00:00Z", sources: [{ label: "官", url: "https://example.com/h" }], published: false },
      { id: 4, person_id: 1, title: "无出处", type: "单曲", status: "scheduled", starts_at: "2026-10-16T10:00:00Z", sources: [], published: true },
      {
        id: 5,
        person_id: 3,
        title: "别人的演唱会",
        type: "演唱会",
        status: "scheduled",
        starts_at: "2026-10-18T12:00:00Z",
        sources: [{ label: "官", url: "https://example.com/c" }],
        published: true,
      },
      {
        id: 6,
        person_id: 2,
        title: "成员单曲",
        type: "单曲",
        status: "scheduled",
        starts_at: "2026-10-17T10:00:00Z",
        sources: [{ label: "官", url: "https://example.com/m" }],
        published: true,
      },
    ],
    snapshots: [
      { person_id: 1, taken_at: "2026-10-14T16:00:00Z", view_count: 10000, subscriber_count: 100 },
      { person_id: 1, taken_at: "2026-10-15T16:00:00Z", view_count: 11000, subscriber_count: 110 },
      { person_id: 3, taken_at: "2026-10-14T16:00:00Z", view_count: 50000, subscriber_count: 500 },
      { person_id: 3, taken_at: "2026-10-15T16:00:00Z", view_count: 80000, subscriber_count: 800 },
      { person_id: 5, taken_at: "2026-10-14T16:00:00Z", view_count: 0, subscriber_count: 0 },
      { person_id: 5, taken_at: "2026-10-15T16:00:00Z", view_count: 20, subscriber_count: 1 },
      { person_id: 6, taken_at: "2026-10-15T16:00:00Z", view_count: 10, subscriber_count: 10 },
      { person_id: 7, taken_at: "2026-10-14T16:00:00Z", view_count: 40, subscriber_count: 40 },
      { person_id: 7, taken_at: "2026-10-15T16:00:00Z", view_count: 40, subscriber_count: 40 },
      { person_id: 2, taken_at: "2026-10-14T16:00:00Z", view_count: 1, subscriber_count: 1 },
      { person_id: 2, taken_at: "2026-10-15T16:00:00Z", view_count: 999, subscriber_count: 999 },
    ],
  };
}

test("beijing windows and both clocks", () => {
  assert.equal(windowBounds(NOW, "7d")[0].toISOString(), "2026-10-09T16:00:00.000Z");
  assert.equal(windowBounds(NOW, "30d")[0].toISOString(), "2026-09-16T16:00:00.000Z");
  assert.equal(windowBounds(NOW, "yesterday")[0].toISOString(), "2026-10-14T16:00:00.000Z");
  assert.equal(windowBounds(NOW, "yesterday")[1].toISOString(), "2026-10-15T16:00:00.000Z");
  assert.equal(windowBounds(NOW, "next7")[1].toISOString(), "2026-10-22T16:00:00.000Z");
  assert.equal(formatBeijing(new Date("2026-10-16T10:00:00Z")), "2026-10-16 18:00");
  assert.equal(formatKorea(new Date("2026-10-16T10:00:00Z")), "2026-10-16 19:00");
});

test("tentative stays out of the dated calendar and hidden events stay hidden", () => {
  const db = sample();
  const titles = monthGroups(db, 2026, 10, null).flatMap(([, events]) => events.map((event) => event.title));
  assert.deepEqual(titles, ["已定单曲", "成员单曲", "别人的演唱会"]);
  assert.deepEqual(monthGroups(db, 2026, 10, "演唱会").flatMap(([, events]) => events.map((event) => event.title)), ["别人的演唱会"]);
  assert.equal(tentativeList(db, null)[0].title, "待定专辑");
  assert.equal(tentativeList(db, null)[0].startsAt, null);
  assert.equal(getEvent(db, 3), null);
  assert.equal(getEvent(db, 4), null);
});

test("missing start, zero delta, members, and zero base are handled", () => {
  const result = board(sample(), { metric: "views", window: "yesterday", now: NOW, personIds: null, limit: 5 });
  const ids = [...result.gainers, ...result.losers].map((row) => row.personId);
  assert.ok(!ids.includes(6));
  assert.ok(!ids.includes(7));
  assert.ok(!ids.includes(2));
  const gainer = result.gainers.find((row) => row.personId === 1);
  assert.equal(gainer.delta, 1000);
  assert.equal(gainer.percent, 0.1);
  assert.equal(result.gainers.find((row) => row.personId === 5).percent, null);
});

test("following scope does not backfill rankings", () => {
  const db = sample();
  const feed = homeFeed(db, NOW, [1]);
  assert.deepEqual(feed.gainers.map((row) => row.personId), [1]);
  assert.deepEqual(feed.events.map((event) => event.title), ["已定单曲", "成员单曲"]);
  assert.deepEqual(feed.birthdays.map((person) => person.name), ["成员甲"]);
  assert.deepEqual(homeFeed(db, NOW, []).gainers, []);
  assert.ok(homeFeed(db, NOW, null).gainers.some((row) => row.personId === 3));
});

test("search and person page skip unpublished and member channels", () => {
  const db = sample();
  assert.deepEqual(searchPeople(db, ""), []);
  assert.deepEqual(searchPeople(db, "ive"), [{ id: 1, name: "测试团", kind: "group" }]);
  assert.equal(searchPeople(db, "未公开").length, 0);
  const person = getPerson(db, 1);
  assert.equal(person.members[0].name, "成员甲");
  assert.equal(person.channelId, "UCgroup");
  assert.equal(getPerson(db, 2).channelId, "");
  assert.equal(getPerson(db, 4), null);
});
