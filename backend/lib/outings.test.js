const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanOuting,
  cleanEvaluation,
  cleanFriend,
  friendNotes,
  cleanCount,
  cleanTime,
  validDate,
} = require("./outings");

const good = { type: "Sports", heldOn: "2026-11-07", personIds: [1, 2] };

test("an outing needs a type and a date", () => {
  assert.ok(cleanOuting(good).fields);
  assert.match(cleanOuting({ ...good, type: "  " }).error, /type/);
  assert.match(cleanOuting({ ...good, heldOn: "" }).error, /date/);
  assert.match(cleanOuting({ ...good, heldOn: "2026-02-31" }).error, /date/);
  // The organiser is added on the server, so nobody else is needed.
  assert.deepEqual(cleanOuting({ ...good, personIds: [] }).fields.personIds, []);
  assert.deepEqual(cleanOuting({ ...good, personIds: ["x", -1] }).fields.personIds, []);
  assert.match(cleanOuting(undefined).error, /type/);
});

test("people are de-duplicated, and anything that is not an id is dropped", () => {
  const { fields } = cleanOuting({ ...good, personIds: [3, "3", 4, "nope", 0, 99999999999] });
  assert.deepEqual(fields.personIds, [3, 4]);
});

test("the rest is optional, and tidied", () => {
  const { fields } = cleanOuting({
    ...good,
    type: "  Board   games ",
    location: "  Bishan   Park ",
    goals: " Meet 2 people\r\nGet numbers ",
    startTime: "19:30",
    endTime: "25:00",
    friendsCount: "3",
    friendsWho: " Ben's classmates ",
  });
  assert.equal(fields.type, "Board games");
  assert.equal(fields.location, "Bishan Park");
  assert.equal(fields.goals, "Meet 2 people\nGet numbers");
  assert.equal(fields.startTime, "19:30");
  assert.equal(fields.endTime, "");
  assert.equal(fields.friendsCount, 3);
  assert.equal(fields.friendsWho, "Ben's classmates");
});

test("blank friends means not sure yet, not nobody", () => {
  assert.equal(cleanCount(""), null);
  assert.equal(cleanCount(null), null);
  assert.equal(cleanCount(0), 0);
  assert.equal(cleanCount("12"), 12);
  assert.equal(cleanCount(-1), null);
  assert.equal(cleanCount(1.5), null);
  assert.equal(cleanCount(100000), null);
});

test("times and dates have to be real ones", () => {
  assert.equal(cleanTime("07:05"), "07:05");
  assert.equal(cleanTime("7pm"), "");
  assert.equal(cleanTime("24:00"), "");
  assert.equal(validDate("2028-02-29"), "2028-02-29");
  assert.equal(validDate("2027-02-29"), null);
  assert.equal(validDate(undefined), null);
});

test("an evaluation needs an answer to both questions", () => {
  assert.match(cleanEvaluation({ metNf: false }).error, /how/);
  assert.match(cleanEvaluation({ how: "Good" }).error, /NFs/);
  assert.match(cleanEvaluation({ how: "Good", metNf: "yes" }).error, /NFs/);
  assert.deepEqual(cleanEvaluation({ how: " Good ", metNf: false }).fields, {
    how: "Good",
    metNf: false,
    friends: [],
  });
});

test("saying yes to unexpected NFs asks who, and saying no clears them", () => {
  assert.match(cleanEvaluation({ how: "Good", metNf: true }).error, /who/);
  assert.match(cleanEvaluation({ how: "Good", metNf: true, friends: [] }).error, /who/);
  assert.match(cleanEvaluation({ how: "Good", metNf: true, friends: [{ name: " " }] }).error, /name/);
  assert.equal(cleanEvaluation({ how: "Good", metNf: true, friends: [{ name: "Sam" }] }).fields.friends[0].name, "Sam");
  assert.deepEqual(cleanEvaluation({ how: "Good", metNf: false, friends: [{ name: "Sam" }] }).fields.friends, []);
  const many = Array.from({ length: 11 }, (_, i) => ({ name: `Friend ${i}` }));
  assert.match(cleanEvaluation({ how: "Good", metNf: true, friends: many }).error, /At most/);
});

test("only a friend's name is needed, and the rest is tidied", () => {
  const { fields } = cleanFriend({
    name: "  Sam   Tan ",
    age: "17",
    birthday: "2009-03-14",
    stage: " JC ",
    school: " Raffles ",
    telegram: "@sam",
    notes: " Likes basketball\r\nFriend of Ben ",
  });
  assert.equal(fields.name, "Sam Tan");
  assert.equal(fields.age, 17);
  assert.equal(fields.birthday, "2009-03-14");
  assert.equal(fields.stage, "JC");
  assert.equal(fields.school, "Raffles");
  assert.equal(fields.notes, "Likes basketball\nFriend of Ben");
  const bare = cleanFriend({ name: "Jo" }).fields;
  assert.equal(bare.age, null);
  assert.equal(bare.birthday, null);
  assert.equal(bare.photo, null);
});

test("a friend's age, birthday and picture have to be real", () => {
  assert.match(cleanFriend({ name: "Jo", age: "abc" }).error, /age/);
  assert.match(cleanFriend({ name: "Jo", age: 200 }).error, /age/);
  assert.match(cleanFriend({ name: "Jo", age: -1 }).error, /age/);
  assert.match(cleanFriend({ name: "Jo", birthday: "2026-02-31" }).error, /birthday/);
  const html = Buffer.from("<script>alert(1)</script>").toString("base64");
  assert.match(cleanFriend({ name: "Jo", image: `data:image/png;base64,${html}` }).error, /picture/);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
  assert.equal(cleanFriend({ name: "Jo", image: `data:image/jpeg;base64,${jpeg}` }).fields.photo.mime, "image/jpeg");
});

test("a friend's notes say where we met them, and keep an age with its date", () => {
  const outing = { hangout_type: "Sports", location: "Bishan Park", held_on: "2026-11-14" };
  assert.equal(
    friendNotes({ notes: "Likes basketball", age: 17, birthday: null }, outing),
    "Likes basketball\nAge 17 in Nov 2026\nMet on an outing: Sports, Bishan Park, 14 Nov 2026"
  );
  // A birthday says it better, and keeps saying it next year.
  assert.equal(
    friendNotes({ notes: "", age: 17, birthday: "2009-03-14" }, outing),
    "Met on an outing: Sports, Bishan Park, 14 Nov 2026"
  );
  assert.equal(
    friendNotes({ notes: "", age: null, birthday: null }, { hangout_type: "Food", location: "", held_on: "2026-01-02" }),
    "Met on an outing: Food, 2 Jan 2026"
  );
});
