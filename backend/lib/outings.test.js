const test = require("node:test");
const assert = require("node:assert/strict");

const { cleanOuting, cleanEvaluation, cleanCount, cleanTime, validDate } = require("./outings");

const good = { type: "Sports", heldOn: "2026-11-07", personIds: [1, 2] };

test("an outing needs a type, a date and someone going", () => {
  assert.ok(cleanOuting(good).fields);
  assert.match(cleanOuting({ ...good, type: "  " }).error, /type/);
  assert.match(cleanOuting({ ...good, heldOn: "" }).error, /date/);
  assert.match(cleanOuting({ ...good, heldOn: "2026-02-31" }).error, /date/);
  assert.match(cleanOuting({ ...good, personIds: [] }).error, /going/);
  assert.match(cleanOuting({ ...good, personIds: ["x", -1] }).error, /going/);
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
    nfDetails: "",
  });
});

test("saying yes to unexpected NFs asks who, and saying no clears it", () => {
  assert.match(cleanEvaluation({ how: "Good", metNf: true, nfDetails: " " }).error, /who/);
  assert.equal(
    cleanEvaluation({ how: "Good", metNf: true, nfDetails: "Sam, Jo" }).fields.nfDetails,
    "Sam, Jo"
  );
  assert.equal(
    cleanEvaluation({ how: "Good", metNf: false, nfDetails: "Sam" }).fields.nfDetails,
    ""
  );
});
