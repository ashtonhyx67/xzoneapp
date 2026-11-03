const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STARTER_ROOMS,
  newCode,
  cleanLogistics,
  pickLogistics,
  cleanNote,
  cleanText,
  decodePhoto,
  shareOut,
} = require("./narnia");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const dataUrl = (buffer, type = "image/jpeg") => `data:${type};base64,${buffer.toString("base64")}`;

// Two rooms of three tasks, tasks 1-3 in room 1 and 4-6 in room 2.
const sixTasks = () =>
  [1, 2, 3, 4, 5, 6].map((id) => ({ id, roomId: id <= 3 ? 1 : 2, done: false }));

const person = (id, extra = {}) => ({ id, roomId: null, taskIds: [], ...extra });

function tasksOf(added, id) {
  return added.filter((a) => a.checkinId === id).map((a) => a.taskId);
}

test("the starter standard has the two rooms, each with tasks and logistics", () => {
  assert.deepEqual(
    STARTER_ROOMS.map((room) => room.name),
    ["Outer Room", "Inner Room"]
  );
  for (const room of STARTER_ROOMS) {
    assert.ok(room.tasks.length > 0);
    for (const task of room.tasks) assert.ok(task.title && task.logistics.length > 0);
  }
});

test("a code has no characters that look like other characters", () => {
  for (let i = 0; i < 200; i++) assert.match(newCode(), /^[A-HJKMNP-Z2-9]{10}$/);
});

test("logistics split on commas and lines, and repeats collapse", () => {
  assert.deepEqual(cleanLogistics("Mop, bucket\nFloor  cleaner,, MOP"), [
    "Mop",
    "bucket",
    "Floor cleaner",
  ]);
  assert.deepEqual(cleanLogistics(["Broom", " ", "broom"]), ["Broom"]);
  // Adding "Bin bag, Gloves" to a list that already has things on it.
  assert.deepEqual(cleanLogistics(["Mop", "Bin bag, Gloves"]), ["Mop", "Bin bag", "Gloves"]);
  assert.deepEqual(cleanLogistics(undefined), []);
});

test("a task can only use what is on its room's list, spelled the room's way", () => {
  const room = ["Mop", "Bucket", "Floor cleaner"];
  assert.deepEqual(pickLogistics(room, ["bucket", "MOP", "Ladder"]), ["Mop", "Bucket"]);
  assert.deepEqual(pickLogistics(room, []), []);
  assert.deepEqual(pickLogistics([], ["Mop"]), []);
});

test("text is tidied and capped", () => {
  assert.equal(cleanText("  Sweep   the\nfloor ", 80), "Sweep the floor");
  assert.equal(cleanText("abcdef", 3), "abc");
  assert.equal(cleanText(null, 3), "");
  assert.equal(cleanNote(" one\r\ntwo "), "one\ntwo");
});

test("a photo's type comes from its bytes, not what it claims to be", () => {
  assert.equal(decodePhoto(dataUrl(JPEG)).mime, "image/jpeg");
  assert.equal(decodePhoto(dataUrl(JPEG, "image/png")).mime, "image/jpeg");

  const html = Buffer.from("<script>alert(1)</script>");
  assert.equal(decodePhoto(dataUrl(html)), null);
  assert.equal(decodePhoto(dataUrl(html, "text/html")), null);
  assert.equal(decodePhoto("https://example.com/a.jpg"), null);
  assert.equal(decodePhoto(""), null);
  assert.equal(decodePhoto(undefined), null);
});

test("a photo over the size limit is refused", () => {
  const huge = Buffer.concat([JPEG, Buffer.alloc(3 * 1024 * 1024)]);
  assert.equal(decodePhoto(dataUrl(huge)), null);
});

test("sharing out fills the two rooms evenly rather than one after the other", () => {
  const added = shareOut({ people: [person(1), person(2), person(3), person(4)], tasks: sixTasks() });
  const rooms = [1, 2, 3, 4].map((id) => (tasksOf(added, id)[0] <= 3 ? 1 : 2));
  assert.equal(rooms.filter((room) => room === 1).length, 2);
  assert.equal(rooms.filter((room) => room === 2).length, 2);
});

test("everyone gets something, and every task gets someone", () => {
  for (const count of [1, 2, 3, 5, 6, 7, 20]) {
    const people = Array.from({ length: count }, (_, i) => person(i + 1));
    const added = shareOut({ people, tasks: sixTasks() });
    for (const p of people) assert.ok(tasksOf(added, p.id).length > 0, `${count} people`);
    for (const task of sixTasks()) {
      assert.ok(added.some((a) => a.taskId === task.id), `${count} people, task ${task.id}`);
    }
    assert.equal(new Set(added.map((a) => `${a.checkinId}-${a.taskId}`)).size, added.length);
  }
});

test("with too few people, each works in the room they were sent to", () => {
  const added = shareOut({ people: [person(1), person(2)], tasks: sixTasks() });
  const rooms = (id) => new Set(tasksOf(added, id).map((taskId) => (taskId <= 3 ? 1 : 2)));
  assert.equal(rooms(1).size, 1);
  assert.equal(rooms(2).size, 1);
  assert.notDeepEqual([...rooms(1)], [...rooms(2)]);
});

test("nobody already placed is moved, and a task with someone on it gets no extra", () => {
  const added = shareOut({
    people: [person(1, { roomId: 1, taskIds: [1] }), person(2, { roomId: 2 })],
    tasks: [
      { id: 1, roomId: 1, done: false },
      { id: 4, roomId: 2, done: false },
    ],
  });
  assert.deepEqual(added, [{ checkinId: 2, taskId: 4 }]);
});

test("someone sent to a room stays in it", () => {
  const added = shareOut({ people: [person(1, { roomId: 2 })], tasks: sixTasks() });
  assert.equal(tasksOf(added, 1)[0] > 3, true);
});

test("finished tasks need nobody", () => {
  const tasks = sixTasks().map((task) => ({ ...task, done: task.id !== 6 }));
  assert.deepEqual(shareOut({ people: [person(1)], tasks }), [{ checkinId: 1, taskId: 6 }]);
});

test("nothing to do, or nobody to do it, changes nothing", () => {
  assert.deepEqual(shareOut({ people: [person(1)], tasks: [] }), []);
  assert.deepEqual(shareOut({ people: [], tasks: sixTasks() }), []);
});
