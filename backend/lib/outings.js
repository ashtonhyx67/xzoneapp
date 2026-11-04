// Outings: leaders and regulars going out each week to make friends, and in time
// to bring them to church. A leader plans one and picks who goes from the people
// database, starts it, and ends it. Everyone on it is then asked how it went.
//
// This file holds the parts that are decisions rather than database work, so they
// can be tested without one. routes/outings.js does the rest.

const { decodePhoto } = require("./narnia");

const MAX_TYPE = 60;
const MAX_LOCATION = 160;
const MAX_LONG_TEXT = 2000;
const MAX_FRIENDS = 500;
const MAX_PEOPLE = 200;
const MAX_NAME = 80;
const MAX_SHORT = 200;
const MAX_AGE = 120;
// Each may carry a picture, and all of it arrives in one request.
const MAX_FRIENDS_PER_EVALUATION = 10;

function cleanLine(value, max) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Goals and evaluations keep their line breaks, since they may well be a list.
function cleanLong(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, MAX_LONG_TEXT);
}

function validDate(value) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
    ? text
    : null;
}

// "" means not decided yet. Anything else has to be a real 24-hour time.
function cleanTime(value) {
  const text = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "";
}

// Blank is "not sure yet", which is different from nobody.
function cleanCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 && count <= MAX_FRIENDS ? count : null;
}

function cleanPersonIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0 && id < 2 ** 31);
  return [...new Set(ids)].slice(0, MAX_PEOPLE);
}

// Everything a leader fills in. Answers { error } or { fields }.
function cleanOuting(body) {
  const type = cleanLine(body?.type, MAX_TYPE);
  if (!type) return { error: "Choose a type of hangout." };

  const heldOn = validDate(body?.heldOn);
  if (!heldOn) return { error: "Choose a date." };

  // Whoever plans it is always going, so picking nobody else is fine.
  const personIds = cleanPersonIds(body?.personIds);

  return {
    fields: {
      type,
      heldOn,
      startTime: cleanTime(body?.startTime),
      endTime: cleanTime(body?.endTime),
      location: cleanLine(body?.location, MAX_LOCATION),
      goals: cleanLong(body?.goals),
      friendsCount: cleanCount(body?.friendsCount),
      friendsWho: cleanLong(body?.friendsWho),
      personIds,
    },
  };
}

// One friend met on an outing, with the same details the people database keeps, plus
// stage of life. Only the name is needed, since often that is all anyone caught.
function cleanFriend(raw) {
  const name = cleanLine(raw?.name, MAX_NAME);
  if (!name) return { error: "Every friend needs a name." };

  const age = raw?.age === "" || raw?.age === null || raw?.age === undefined ? null : Number(raw.age);
  if (age !== null && (!Number.isInteger(age) || age < 0 || age > MAX_AGE)) {
    return { error: `${name}'s age doesn't look right.` };
  }

  const birthdayText = String(raw?.birthday ?? "").trim();
  const birthday = birthdayText ? validDate(birthdayText) : null;
  if (birthdayText && !birthday) return { error: `${name}'s birthday doesn't look right.` };

  let photo = null;
  if (raw?.image) {
    photo = decodePhoto(raw.image);
    if (!photo) return { error: `${name}'s picture couldn't be read. Try a different one.` };
  }

  const id = Number(raw?.id);

  return {
    fields: {
      id: Number.isInteger(id) && id > 0 && id < 2 ** 31 ? id : null,
      name,
      age,
      birthday,
      photo,
      removePhoto: raw?.removePhoto === true,
      stage: cleanLine(raw?.stage, MAX_NAME),
      school: cleanLine(raw?.school, MAX_SHORT),
      contact: cleanLine(raw?.contact, MAX_SHORT),
      telegram: cleanLine(raw?.telegram, MAX_SHORT),
      instagram: cleanLine(raw?.instagram, MAX_SHORT),
      religion: cleanLine(raw?.religion, MAX_SHORT),
      notes: cleanLong(raw?.notes),
    },
  };
}

// Answers { error } or { fields }. Saying yes to meeting someone unexpected asks who,
// because that is the part someone will want to follow up on.
function cleanEvaluation(body) {
  const how = cleanLong(body?.how);
  if (!how) return { error: "Tell us how the outing was." };

  if (typeof body?.metNf !== "boolean") {
    return { error: "Tell us if we met any unexpected NFs." };
  }

  if (!body.metNf) return { fields: { how, metNf: false, friends: [] } };

  const rawFriends = Array.isArray(body.friends) ? body.friends : [];
  if (rawFriends.length === 0) return { error: "Tell us who we met." };
  if (rawFriends.length > MAX_FRIENDS_PER_EVALUATION) {
    return { error: `At most ${MAX_FRIENDS_PER_EVALUATION} friends at a time.` };
  }

  const friends = [];
  for (const raw of rawFriends) {
    const { error, fields } = cleanFriend(raw);
    if (error) return { error };
    friends.push(fields);
  }

  return { fields: { how, metNf: true, friends } };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// What goes in a new person's General Information when a leader adds them. An age is
// kept as a note with its date rather than as a field, because the database works out
// age from a birthday, and a number on its own would be wrong in a year.
function friendNotes(friend, outing) {
  const [year, month, day] = String(outing.held_on).split("-");
  const when = `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
  const where = [outing.hangout_type, outing.location, when].filter(Boolean).join(", ");

  return [
    friend.notes,
    friend.age !== null && !friend.birthday ? `Age ${friend.age} in ${MONTHS[Number(month) - 1]} ${year}` : "",
    `Met on an outing: ${where}`,
  ]
    .filter(Boolean)
    .join("\n");
}

module.exports = { cleanOuting, cleanEvaluation, cleanFriend, friendNotes, cleanCount, cleanTime, validDate };
