# KPOP 粉丝站 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个给国内粉丝群转发的简体中文站点，打开链接就能回答「这周谁回归、今天谁生日、最近谁在涨谁在掉」。

**Architecture:** 一个 FastAPI 进程渲染 HTML，SQLite 存人物、事件、YouTube 快照、账号和关注。时间窗、榜和首页是纯查询函数，页面只负责把它们画出来。YouTube 抓取是单独的命令，测试用注入的函数，不访问网络。

**Tech Stack:** Python 3.11+、FastAPI、Jinja2、sqlite3 标准库、pytest、httpx（仅作 TestClient）。密码用 `hashlib.pbkdf2_hmac`。会话是随机 token，存在 `sessions` 表，cookie 名 `session`。

**Spec:** `docs/superpowers/specs/2026-10-16-kpop-fan-site-design.md`

## Global Constraints

- 界面文案是简体中文。人名标题用中文名，常用外文名留在旁边。
- 时刻存 UTC。已定档的主时间是北京时间，副时间是韩国时间，格式 `YYYY-MM-DD HH:MM`。
- 「当天、近 7 天、近 30 天、昨天、未来七天」按北京时间自然日。当天是今天 0 点到现在。近 7 天从今天往前第 6 天的 0 点到现在。近 30 天从今天往前第 29 天的 0 点到现在。昨天是上一个完整自然日。未来七天是今天到往后第 6 天，含今天已经过去的发行。
- 看首页、日历、发行、人物、变化榜、搜索都不用登录。
- 登录用邮箱加密码。不用微信登录。不提供魔法链接。
- 关注对象只能是团体或 solo。关注团体时，首页包含成员生日和挂在成员身上的发行。成员即使填了频道 ID 也不进榜。
- 变化榜页是全站。首页变化只取昨天的播放增量，涨 5、跌 5。关注范围内不足 5 个时不拿全站补。
- 日历是按北京日期分组的列表，只含已定档。待定单独一节，只显示窗口原文，不显示钟点。
- 类型：正规专辑、迷你专辑、单曲、先行曲、出道、演唱会、签售、快闪、其他。筛选多一个「全部」。
- 未公开的人物或事件不出现在任何前台。事件没有至少一条官方出处时不公开，`get_event` 返回空。
- 作品名为空时，页面写「作品名未公布」。
- 增量为 0 不进榜。没有窗口开始时的快照不进榜，不显示 0。开始总量为 0 时不显示百分比，只显示增量。
- 页面正文不嵌 YouTube、X、Instagram 的播放器、图片或脚本。官方出处只是文字标签加链接。
- 第一版不收录「全部 KPOP」。没有事件也没有频道的已公开人物仍然有人物页。

## Review Focus

- 待定事件若出现在首页「未来七天」或日历的日期列表里，读者会把它当成已定档。它只能出现在待定区，且没有钟点。
- 关注范围内能上榜的人不足 5 个时，若用全站的人补满，首页就不再是「我关注的人」。有几个显示几个。
- 窗口没有开始快照时若把增量显示成 0，会把「还没开始记」说成「没有变化」。这种人不进榜。
- 未登录点了关注再完成登录，若关注丢失，登录就没有完成它唯一的工作。登录后这条关注还在。
- 发行页若靠 YouTube 的 iframe 或图片才看得到标题和时间，在微信里打不开 YouTube 时答案就没了。正文里的中文名、北京时间和出处标签必须在 HTML 文本里。

## File Structure

- `requirements.txt` — 运行和测试依赖
- `app/db.py` — 连接和建表
- `app/clock.py` — 北京时间窗和两种时区的格式
- `app/people.py` — 人物查询和搜索
- `app/events.py` — 日历、待定、发行可见性、未来七天、生日
- `app/rankings.py` — 由快照算涨跌
- `app/home.py` — 首页三段
- `app/auth.py` — 注册、登录、会话
- `app/follows.py` — 关注规则
- `app/admin.py` — 编辑用的写入
- `app/youtube_sync.py` — 写入快照，可注入抓取函数
- `app/web.py` — 路由
- `app/templates/` — 每个页一个模板
- `app/static/site.css` — 手机优先的样式
- `tests/conftest.py` — 内存库和样例数据
- `tests/test_*.py` — 与上面模块对应

路由定死：

- `GET /` 首页。`?scope=following` 只在已登录且有关注时收窄；否则是全部。
- `GET /calendar?month=YYYY-MM&type=单曲`
- `GET /events/{id}`
- `GET /people/{id}`
- `GET /rankings?window=today|7d|30d&metric=views|subscribers`
- `GET /search?q=`
- `GET /login`、`POST /login`、`POST /register`、`POST /logout`
- `POST /follow/{person_id}`、`POST /unfollow/{person_id}`
- `GET /admin` 以及 `POST /admin/people`、`POST /admin/events`、`POST /admin/publish`

---

### Task 1: 数据库

**Files:**
- Create: `requirements.txt`
- Create: `app/db.py`
- Create: `app/__init__.py`
- Create: `tests/conftest.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Consumes: 无
- Produces: `connect(path: str) -> sqlite3.Connection` 开启外键。`migrate(conn) -> None` 可重复执行。表：`people`、`person_names`、`person_links`、`events`、`event_sources`、`snapshots`、`users`、`sessions`、`follows`。`users.is_editor` 是 0 或 1，默认 0。`people.kind` 为 `group`、`solo`、`member`。`people.published` 和 `events.published` 是 0 或 1。`events.status` 为 `scheduled` 或 `tentative`。`events.starts_at` 存 UTC 的 ISO 文本，待定为空。`follows` 的主键是 `(user_id, person_id)`。

- [ ] **Step 1: Write the failing test**

```python
def test_migrate_is_repeatable_and_enforces_foreign_keys():
    conn = connect(":memory:")
    migrate(conn)
    migrate(conn)
    conn.execute("INSERT INTO people (kind, name_zh, published) VALUES ('group', '测试团', 1)")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO events (person_id, type, status, published) VALUES (99, '单曲', 'scheduled', 1)")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_db.py::test_migrate_is_repeatable_and_enforces_foreign_keys -v`
Expected: FAIL，`connect` 或 `migrate` 不存在

- [ ] **Step 3: Implement `connect` and `migrate` in `app/db.py`**

建上面列出的表。`events.type` 不在数据库里做中文枚举约束，由调用方保证。`conftest.py` 提供 `db` fixture，返回已迁移的内存连接。

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_db.py::test_migrate_is_repeatable_and_enforces_foreign_keys -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add requirements.txt app/db.py app/__init__.py tests/conftest.py tests/test_db.py
git commit -m "feat: add sqlite schema for the fan site"
```

### Task 2: 北京时间

**Files:**
- Create: `app/clock.py`
- Test: `tests/test_clock.py`

**Interfaces:**
- Consumes: 无
- Produces: `window_bounds(now: datetime, name: str) -> tuple[datetime, datetime]`，`name` 为 `today`、`7d`、`30d`、`yesterday`、`next7`。返回值是带 `Asia/Shanghai` 时区的边界，结束边界对 `today`、`7d`、`30d` 是 `now` 本身，对 `yesterday` 和 `next7` 是当天或区间最后一天的次日 0 点。`format_beijing(dt) -> str`、`format_korea(dt) -> str` 返回 `YYYY-MM-DD HH:MM`。

- [ ] **Step 1: Write the failing test**

```python
def test_windows_use_beijing_calendar_days():
    now = datetime(2026, 10, 16, 7, 30, tzinfo=ZoneInfo("UTC"))  # 北京时间 15:30
    assert window_bounds(now, "today")[0].hour == 0
    assert window_bounds(now, "today")[0].day == 16
    assert window_bounds(now, "7d")[0] == datetime(2026, 10, 10, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
    assert window_bounds(now, "30d")[0] == datetime(2026, 9, 17, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
    assert window_bounds(now, "yesterday") == (
        datetime(2026, 10, 15, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai")),
        datetime(2026, 10, 16, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai")),
    )
    assert window_bounds(now, "next7")[0] == datetime(2026, 10, 16, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
    assert window_bounds(now, "next7")[1] == datetime(2026, 10, 23, 0, 0, tzinfo=ZoneInfo("Asia/Shanghai"))
    sixteen_utc = datetime(2026, 10, 16, 10, 0, tzinfo=ZoneInfo("UTC"))
    assert format_beijing(sixteen_utc) == "2026-10-16 18:00"
    assert format_korea(sixteen_utc) == "2026-10-16 19:00"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_clock.py::test_windows_use_beijing_calendar_days -v`
Expected: FAIL，`window_bounds` 不存在

- [ ] **Step 3: Implement the two formatters and `window_bounds` in `app/clock.py`**

朴素的 `datetime` 按 UTC 理解。近 7 天含 10 月 10 日到 16 日，近 30 天含 9 月 17 日到 10 月 16 日。

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_clock.py::test_windows_use_beijing_calendar_days -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/clock.py tests/test_clock.py
git commit -m "feat: calculate fan-site windows in Beijing time"
```

### Task 3: 人物和搜索

**Files:**
- Create: `app/people.py`
- Test: `tests/test_people.py`

**Interfaces:**
- Consumes: `connect`、`migrate`
- Produces: `PersonView`，字段 `id, kind, name_zh, foreign_names, company, debut_on, birthday, links, youtube_channel_id, group_id, group_name, members`。`members` 是 `(id, name_zh, birthday)`。`get_person(conn, person_id: int) -> PersonView | None`，未公开或不存在返回 `None`。`search_people(conn, query: str) -> list[tuple[int, str, str]]` 返回已公开人物的 `(id, name_zh, kind)`，空查询返回 `[]`，中文名和外文名按包含匹配，外文名忽略大小写。

- [ ] **Step 1: Write the failing test**

```python
def test_search_matches_chinese_and_foreign_names_and_hides_unpublished(db):
    _insert_group_with_member(db)
    assert search_people(db, "") == []
    assert search_people(db, "ive") == [(1, "测试团", "group")]
    assert search_people(db, "成员甲") == [(2, "成员甲", "member")]
    assert get_person(db, 1).members == ((2, "成员甲", "10-16"),)
    assert get_person(db, 2).group_name == "测试团"
    assert get_person(db, 3) is None
```

`_insert_group_with_member` 插入已公开团体 id 1、外文名 `IVE`、已公开成员 id 2、生日 `10-16`、未公开人物 id 3。

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_people.py::test_search_matches_chinese_and_foreign_names_and_hides_unpublished -v`
Expected: FAIL，`search_people` 不存在

- [ ] **Step 3: Implement `PersonView`、`get_person`、`search_people`**

团体页的成员只含已公开成员。

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_people.py::test_search_matches_chinese_and_foreign_names_and_hides_unpublished -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/people.py tests/test_people.py
git commit -m "feat: search published people by Chinese and foreign names"
```

### Task 4: 发行、日历和可见性

**Files:**
- Create: `app/events.py`
- Test: `tests/test_events.py`

**Interfaces:**
- Consumes: `window_bounds`
- Produces: `EventView`，字段 `id, person_id, person_name, title, type, status, starts_at, window_text, note, sources`。`sources` 是 `(label, url)`。`month_groups(conn, year, month, type_filter: str | None) -> list[tuple[str, list[EventView]]]`。`tentative_list(conn, type_filter: str | None) -> list[EventView]`。`get_event(conn, event_id: int) -> EventView | None`。`upcoming_for_people(conn, person_ids: list[int] | None, now: datetime) -> list[EventView]`。`birthdays_for_people(conn, person_ids: list[int] | None, now: datetime) -> list[tuple[int, str, str]]`，元组是 `(person_id, name_zh, birthday)`。`person_ids is None` 表示全部已公开主体。传入 id 时，主体本人和这些团体的已公开成员都算在内。

- [ ] **Step 1: Write the failing test**

```python
def test_tentative_stays_out_of_dated_calendar_and_unpublished_event_is_hidden(db):
    _insert_scheduled_and_tentative(db)
    groups = month_groups(db, 2026, 10, None)
    titles = [event.title for _, events in groups for event in events]
    assert titles == ["已定单曲"]
    assert month_groups(db, 2026, 10, "演唱会") == []
    assert [event.title for event in tentative_list(db, None)] == ["待定专辑"]
    assert tentative_list(db, None)[0].starts_at is None
    assert get_event(db, 3) is None  # 未公开
    assert get_event(db, 4) is None  # 已公开但没有出处
    now = datetime(2026, 10, 16, 7, 30, tzinfo=ZoneInfo("UTC"))
    assert [event.title for event in upcoming_for_people(db, None, now)] == ["已定单曲"]
    assert (2, "成员甲", "10-16") in birthdays_for_people(db, [1], now)
```

样例 id：1 已定档单曲，北京时间 2026-10-16 18:00，有出处，挂在团体 1；2 待定专辑，窗口「2026 年第四季度」；3 未公开；4 已公开但无出处。成员 id 2 生日 `10-16`，所属团体 id 1。`month_groups` 的日期键是 `2026-10-16`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_events.py::test_tentative_stays_out_of_dated_calendar_and_unpublished_event_is_hidden -v`
Expected: FAIL，`month_groups` 不存在

- [ ] **Step 3: Implement the event queries**

已定档按 `starts_at` 转成北京日期分组。待定不进入 `month_groups` 和 `upcoming_for_people`。`type_filter` 为 `None` 时不过滤类型。

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_events.py::test_tentative_stays_out_of_dated_calendar_and_unpublished_event_is_hidden -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/events.py tests/test_events.py
git commit -m "feat: separate scheduled releases from tentative windows"
```

### Task 5: 变化榜

**Files:**
- Create: `app/rankings.py`
- Test: `tests/test_rankings.py`

**Interfaces:**
- Consumes: `window_bounds`
- Produces: `RankRow(person_id, name_zh, total, delta, percent)`。`Board(gainers, losers)`。`board(conn, *, metric: str, window: str, now: datetime, person_ids: list[int] | None, limit: int | None = None) -> Board`。`metric` 为 `views` 或 `subscribers`。`window` 用 Task 2 的名字，首页传 `yesterday`。`person_ids is None` 表示全站团体和 solo。成员永远排除。涨按 `delta` 从大到小，跌按 `delta` 从小到大。

- [ ] **Step 1: Write the failing test**

```python
def test_missing_start_snapshot_is_absent_and_zero_delta_is_absent(db):
    _insert_channels_and_snapshots(db)
    result = board(db, metric="views", window="yesterday", now=NOW, person_ids=None, limit=5)
    ids = [row.person_id for row in result.gainers + result.losers]
    assert no_start_id not in ids
    assert zero_delta_id not in ids
    assert member_with_channel_id not in ids
    gainer = next(row for row in result.gainers if row.person_id == gainer_id)
    assert gainer.delta == 1000
    assert gainer.percent == pytest.approx(0.1)
    zero_base = next(row for row in result.gainers if row.person_id == zero_base_id)
    assert zero_base.percent is None
    subs = board(db, metric="subscribers", window="yesterday", now=NOW, person_ids=None, limit=5)
    assert any(row.person_id == gainer_id and row.delta == 10 for row in subs.gainers)
```

`NOW` 是 2026-10-16 07:30 UTC。涨的频道播放从 10000 到 11000，订阅从 100 到 110。`zero_base_id` 的播放从 0 到一个正数。`gainer_id`、`zero_base_id`、`no_start_id`、`zero_delta_id` 都是团体或 solo。`member_with_channel_id` 是成员。

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_rankings.py::test_missing_start_snapshot_is_absent_and_zero_delta_is_absent -v`
Expected: FAIL，`board` 不存在

- [ ] **Step 3: Implement `board`**

开始快照是 `taken_at <= 窗口开始` 的最后一条。结束快照是 `taken_at <= 窗口结束` 的最后一条。播放看 `view_count`，订阅看 `subscriber_count`。`limit` 分别截涨和跌。

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_rankings.py::test_missing_start_snapshot_is_absent_and_zero_delta_is_absent -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/rankings.py tests/test_rankings.py
git commit -m "feat: rank YouTube movement without inventing zeroes"
```

### Task 6: 首页三段

**Files:**
- Create: `app/home.py`
- Test: `tests/test_home.py`

**Interfaces:**
- Consumes: `upcoming_for_people`、`birthdays_for_people`、`board`
- Produces: `HomeFeed(events, birthdays, gainers, losers)`。`home_feed(conn, *, now: datetime, followed_ids: list[int] | None) -> HomeFeed`。`None` 是全部。空列表三部分都空，不回退到全站。涨跌只来自 `board(..., metric="views", window="yesterday", limit=5)`。

- [ ] **Step 1: Write the failing test**

```python
def test_following_scope_does_not_backfill_rankings_from_global(db):
    _insert_two_groups(db)
    feed = home_feed(db, now=NOW, followed_ids=[small_group_id])
    assert [row.person_id for row in feed.gainers + feed.losers] == [small_group_id]
    assert all(event.person_id in {small_group_id, *its_member_ids} for event in feed.events)
    assert home_feed(db, now=NOW, followed_ids=[]).gainers == []
```

小团只有 1 个有数据的频道。全站另有一个增量更大的团。

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_home.py::test_following_scope_does_not_backfill_rankings_from_global -v`
Expected: FAIL，`home_feed` 不存在

- [ ] **Step 3: Implement `home_feed`**

三段顺序由字段表达：`events`、`birthdays`、然后涨跌。不在这里查询订阅增量。

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_home.py::test_following_scope_does_not_backfill_rankings_from_global -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/home.py tests/test_home.py
git commit -m "feat: build the home feed from follows without backfill"
```

### Task 7: 前台页面

**Files:**
- Create: `app/web.py`
- Create: `app/templates/base.html`
- Create: `app/templates/home.html`
- Create: `app/templates/calendar.html`
- Create: `app/templates/event.html`
- Create: `app/templates/person.html`
- Create: `app/templates/rankings.html`
- Create: `app/templates/search.html`
- Create: `app/static/site.css`
- Test: `tests/test_pages.py`

**Interfaces:**
- Consumes: `home_feed`、`month_groups`、`tentative_list`、`get_event`、`get_person`、`board`、`search_people`、`format_beijing`、`format_korea`
- Produces: `create_app(conn) -> FastAPI`。上面 Global Constraints 里的路由。发行页和人物页缺数据时 404。`/rankings` 不读会话里的关注，永远是全站，默认一页列完全部上榜行。模板里可见的标题文字：首页三段是「未来七天」「即将生日」「昨天播放增量」；待定区标题是「待定」。有频道的人物页写出当前订阅数，以及一天、七天、三十天的播放增量和订阅增量；没有频道时这些标签都不出现，页面上也不出现「0」。

- [ ] **Step 1: Write the failing test**

```python
def test_event_page_is_readable_without_youtube_embeds(db):
    client = TestClient(create_app(db))
    response = client.get(f"/events/{scheduled_id}")
    assert response.status_code == 200
    assert "测试团" in response.text
    assert "2026-10-16 18:00" in response.text
    assert "官方 X" in response.text
    assert "<iframe" not in response.text
    assert "youtube.com/embed" not in response.text
    tentative = client.get(f"/events/{tentative_id}")
    assert "2026 年第四季度" in tentative.text
    assert "18:00" not in tentative.text
    assert client.get("/events/999").status_code == 404
    person = client.get(f"/people/{group_with_channel_id}")
    assert "订阅" in person.text
    assert "近 7 天" in person.text
    assert "订阅" not in client.get(f"/people/{group_without_channel_id}").text
```

`scheduled_id` 的北京时间是 `2026-10-16 18:00`，出处标签是「官方 X」。`tentative_id` 没有钟点。作品名为空的发行正文包含「作品名未公布」。无频道人物的页面整段不含「订阅」「播放增量」。

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_pages.py::test_event_page_is_readable_without_youtube_embeds -v`
Expected: FAIL，`create_app` 不存在

- [ ] **Step 3: Implement the public routes and templates**

CSS 用单列，最大宽度 40rem，正文字号不小于 16px。链接颜色不要只靠颜色区分，下划线保留。不请求任何外部字体或图片。

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_pages.py::test_event_page_is_readable_without_youtube_embeds -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/web.py app/templates app/static tests/test_pages.py
git commit -m "feat: render public pages that read without a login"
```

### Task 8: 登录和关注

**Files:**
- Create: `app/auth.py`
- Create: `app/follows.py`
- Modify: `app/web.py`
- Create: `app/templates/login.html`
- Test: `tests/test_auth.py`

**Interfaces:**
- Consumes: `create_app`、`people.kind`
- Produces: `create_user(conn, email: str, password: str) -> int`。`login(conn, email: str, password: str) -> str | None` 返回会话 token。`user_from_token(conn, token: str) -> int | None`。`follow(conn, user_id: int, person_id: int) -> None`，对象是成员时抛 `ValueError`。`followed_ids(conn, user_id: int) -> list[int]`。未登录 `POST /follow/{id}` 把 id 写入 cookie `pending_follow`，并 303 到 `/login`。登录或注册成功后若 cookie 里是团体或 solo，写入关注并清掉 cookie。

- [ ] **Step 1: Write the failing test**

```python
def test_follow_clicked_before_login_survives_registration(db):
    client = TestClient(create_app(db))
    client.post(f"/follow/{group_id}", follow_redirects=False)
    client.post("/register", data={"email": "fan@example.com", "password": "correct-horse"}, follow_redirects=False)
    home = client.get("/")
    assert "测试团" in home.text
    assert "别的团" not in home.text
    assert "全部" in home.text
    client.post("/logout")
    assert "别的团" in client.get("/").text
```

样例里「别的团」有一条未来七天的发行。注册前的匿名首页能看到它。注册完成并收下关注后，`GET /` 默认是关注范围，看不到它，页面上仍有换到「全部」的入口。退出后再看首页，它回来。已有账号走 `POST /login` 时同样消费 `pending_follow`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_auth.py::test_follow_clicked_before_login_survives_registration -v`
Expected: FAIL，路由 404

- [ ] **Step 3: Implement auth, follows, and the pending cookie**

密码错误的登录回到登录页，HTTP 400，正文含「邮箱或密码不对」。重复注册同一邮箱同样 400，正文含「这个邮箱已经注册」。退出用 `POST /logout`，清会话 cookie。

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_auth.py::test_follow_clicked_before_login_survives_registration -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/auth.py app/follows.py app/web.py app/templates/login.html tests/test_auth.py
git commit -m "feat: keep a follow that started before login"
```

### Task 9: 后台

**Files:**
- Create: `app/admin.py`
- Modify: `app/web.py`
- Create: `app/templates/admin.html`
- Test: `tests/test_admin.py`

**Interfaces:**
- Consumes: 已有各表
- Produces: `save_person(conn, fields: dict) -> int`、`save_event(conn, fields: dict) -> int`、`set_published(conn, table: str, row_id: int, published: bool) -> None`。`table` 只接受 `people` 和 `events`。人物字段：`kind`、`name_zh`、`foreign_names`（换行分隔）、`company`、`debut_on`、`birthday`、`youtube_channel_id`、`group_id`、`links`（每行 `标签 URL`）、`published`。事件字段：`person_id`、`title`、`type`、`status`、`starts_at`（表单按北京时间 `YYYY-MM-DD HH:MM` 填写，入库转 UTC）、`window_text`、`note`、`source_label`、`source_url`、`published`。`save_event` 在状态为 `scheduled` 且没有 `starts_at`、状态为 `tentative` 且没有 `window_text`、或出处为空时抛 `ValueError`。环境变量 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 在 `create_app` 启动时保证这个编辑账号存在，且 `users.is_editor = 1`。非编辑访问 `GET /admin` 得到 404。

- [ ] **Step 1: Write the failing test**

```python
def test_editor_can_publish_an_event_and_visitors_cannot_open_admin(db, monkeypatch):
    monkeypatch.setenv("ADMIN_EMAIL", "editor@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "editor-secret")
    client = TestClient(create_app(db))
    assert client.get("/admin").status_code == 404
    client.post("/login", data={"email": "editor@example.com", "password": "editor-secret"})
    client.post("/admin/people", data={"kind": "group", "name_zh": "新团", "published": "1"})
    client.post("/admin/events", data={
        "person_id": "1", "title": "", "type": "单曲", "status": "tentative",
        "window_text": "2026 年第四季度", "source_label": "官方 X", "source_url": "https://example.com/x",
        "published": "1",
    })
    assert "作品名未公布" in client.get("/events/1").text
    client.post("/admin/publish", data={"table": "events", "id": "1", "published": "0"})
    assert client.get("/events/1").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_admin.py::test_editor_can_publish_an_event_and_visitors_cannot_open_admin -v`
Expected: FAIL，`/admin` 不是 404 的那种缺路由，或登录后写不进去

- [ ] **Step 3: Implement admin writes and the editor gate**

后台是一个页：人物表单、事件表单、公开开关。不公开后，原发行 URL 变为 404。

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_admin.py::test_editor_can_publish_an_event_and_visitors_cannot_open_admin -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/admin.py app/web.py app/templates/admin.html tests/test_admin.py
git commit -m "feat: let an editor publish people and events"
```

### Task 10: YouTube 快照

**Files:**
- Create: `app/youtube_sync.py`
- Test: `tests/test_youtube_sync.py`

**Interfaces:**
- Consumes: `people.kind`、`people.youtube_channel_id`
- Produces: `record_snapshot(conn, person_id: int, taken_at: datetime, views: int, subscribers: int) -> None`。`sync(conn, now: datetime, fetch) -> int`，`fetch(channel_id: str) -> tuple[int, int]` 返回 `(views, subscribers)`，返回值是写入的快照条数。只处理已公开的团体和 solo。成员、没有频道 ID 的人跳过。`python -m app.youtube_sync` 在有 `YOUTUBE_API_KEY` 时用 Data API v3 的 `channels.list?part=statistics`，没有钥匙时退出码 0 且不写快照。

- [ ] **Step 1: Write the failing test**

```python
def test_sync_skips_members_and_records_group_channels(db):
    calls = []
    def fetch(channel_id):
        calls.append(channel_id)
        return (11000, 200)
    written = sync(db, NOW, fetch)
    assert calls == ["UCgroup"]
    assert written == 1
    result = board(db, metric="views", window="today", now=NOW, person_ids=None)
    assert result.gainers == [] or result.gainers[0].person_id != member_id
```

成员的频道 ID 设成 `UCmember`。团体在窗口开始前已有一条快照，这样今天的增量可以计算；本测试只强制 `fetch` 没被成员调用。

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_youtube_sync.py::test_sync_skips_members_and_records_group_channels -v`
Expected: FAIL，`sync` 不存在

- [ ] **Step 3: Implement `record_snapshot`、`sync`，以及 `python -m app.youtube_sync`**

API 失败的频道跳过，继续下一个，最后仍返回实际写入数。不在请求失败时写 0。

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_youtube_sync.py::test_sync_skips_members_and_records_group_channels -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/youtube_sync.py tests/test_youtube_sync.py
git commit -m "feat: record YouTube snapshots for group and solo channels"
```

### Task 11: 整站回归

**Files:**
- Modify: `tests/test_pages.py`
- Modify: `README.md` 只加一节「本地运行」，不改个人简介

**Interfaces:**
- Consumes: 前面所有路由
- Produces: 无新接口。`pytest` 全绿。README 写明 `pip install -r requirements.txt`、`ADMIN_EMAIL`、`ADMIN_PASSWORD`、`uvicorn app.web:app`，以及每天跑一次 `python -m app.youtube_sync`。

- [ ] **Step 1: Write the failing test**

```python
def test_home_shows_three_sections_in_order_for_anonymous_visitors(db):
    client = TestClient(create_app(db))
    text = client.get("/").text
    assert text.index("未来七天") < text.index("即将生日") < text.index("昨天播放增量")
    assert "登录" not in text[text.index("未来七天"):text.index("昨天播放增量")]
```

用已公开的已定档、一个今天生日的成员、一组昨天的播放快照。匿名首页是全部，三段都有内容。

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_pages.py::test_home_shows_three_sections_in_order_for_anonymous_visitors -v`
Expected: FAIL，若 Task 7 已让它通过，就先把三段标题改成测试要求的文字再确认这条是绿的；不允许为了让它失败去拆掉已完成的页面。已经是绿的就记下来并继续。

- [ ] **Step 3: 补齐首页模板的三段顺序，并写 README 的运行一节**

- [ ] **Step 4: Run the whole suite**

Run: `pytest -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_pages.py README.md
git commit -m "docs: explain how to run the fan site locally"
```
