// Narnia BM: the two big rooms, cleaned together, to a known standard.
//
// Two things live side by side. The *standard* is permanent: the rooms, what has
// to be done in each, what to use for it, and photos of how it looks when it is
// done excellently. A *session* is one clean-up: who turned up (by scanning a QR
// code) and which room and tasks each of them was given.
//
// This file holds the parts that are decisions rather than database work, so they
// can be tested without one. routes/narnia.js does the rest.

const crypto = require("crypto");

const MAX_NAME = 80;
const MAX_TITLE = 120;
const MAX_NOTE = 500;
const MAX_LOGISTIC = 60;
const MAX_LOGISTICS = 30;
const MAX_CAPTION = 160;
const MAX_ROOMS = 12;
const MAX_TASKS_PER_ROOM = 60;
const MAX_PHOTOS_PER_ROOM = 40;
// The app shrinks a photo well below this before sending it, so anything larger
// did not come from the app.
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

// What a new installation opens with, to be renamed and added to.
const STARTER_ROOMS = ["Outer Room", "Inner Room"].map((name) => ({
  name,
  tasks: [
    { title: "Sweep the floor", logistics: ["Broom", "Dustpan"] },
    { title: "Mop the floor", logistics: ["Mop", "Bucket", "Floor cleaner"] },
    { title: "Clean the sofas", logistics: ["Cloth", "Vacuum"] },
  ],
}));

// Read off a poster across a room if the camera will not cooperate, so nothing
// that looks like anything else: no 0/O, 1/I/L.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;

function newCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

// Random rather than a counter, because an <img> cannot send a sign-in: holding
// the address is what lets someone who only scanned a QR code see the photo.
function newPhotoId() {
  return crypto.randomBytes(16).toString("hex");
}

// What a phone keeps to prove it is the one that checked in, so reopening the
// page does not ask for a name again.
function newCheckinKey() {
  return crypto.randomBytes(24).toString("base64url");
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// A note keeps its line breaks, since it may well be a list of steps.
function cleanNote(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, MAX_NOTE);
}

// Typed as "Mop, Bucket, Floor cleaner", or sent as a list that may have such a line
// in it. Repeats collapse, so the same thing added twice is not listed twice on
// someone's phone.
function cleanLogistics(raw) {
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((part) =>
    String(part ?? "").split(/[,\n]/)
  );
  const seen = new Set();
  const items = [];
  for (const part of parts) {
    const item = cleanText(part, MAX_LOGISTIC);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length === MAX_LOGISTICS) break;
  }
  return items;
}

// A task uses things from its room's list, and only those: the room's list is the
// one place an item is added, spelled or removed.
function pickLogistics(roomItems, picks) {
  const wanted = new Set(cleanLogistics(picks).map((item) => item.toLowerCase()));
  return roomItems.filter((item) => wanted.has(item.toLowerCase()));
}

// The bytes decide the type, not what the upload claimed. These are served back
// from this site's own address, so nothing that is not plainly an image may get
// through and be handed to a browser.
function imageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

// A photo arrives as a data URL. Null for anything unusable.
function decodePhoto(dataUrl) {
  const match = /^data:[\w/+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
  if (!match) return null;
  const data = Buffer.from(match[1], "base64");
  if (data.length === 0 || data.length > MAX_PHOTO_BYTES) return null;
  const mime = imageType(data);
  return mime ? { mime, data } : null;
}

// One press to get everybody a job. Only fills gaps: anyone already given a task
// keeps it, so it can be used after placing the few people who matter by hand.
//
//   people: [{ id, roomId, taskIds }]
//   tasks:  [{ id, roomId, done }]
//
// Returns [{ checkinId, taskId }] to add. Works in two passes:
//
//   1. Everyone without a task gets one. The task with the fewest people wins,
//      and between those the room with the fewest people, so the rooms fill
//      evenly rather than the first room filling before the second gets anyone.
//   2. With more tasks than people, whatever nobody has yet goes to whoever has
//      the fewest, from that room if anyone is in it. Nothing is left undone
//      because of who happened to turn up.
//
// A task already finished needs nobody.
function shareOut({ people, tasks }) {
  const open = tasks.filter((task) => !task.done);
  const added = [];

  const peopleOn = new Map(open.map((task) => [task.id, 0]));
  const roomLoad = new Map();
  const state = people.map((person) => ({
    id: person.id,
    roomId: person.roomId ?? null,
    taskCount: person.taskIds.length,
  }));

  for (const person of people) {
    for (const taskId of person.taskIds) {
      if (peopleOn.has(taskId)) peopleOn.set(taskId, peopleOn.get(taskId) + 1);
    }
  }
  for (const person of state) {
    if (person.roomId !== null) roomLoad.set(person.roomId, (roomLoad.get(person.roomId) || 0) + 1);
  }

  const give = (person, task) => {
    added.push({ checkinId: person.id, taskId: task.id });
    peopleOn.set(task.id, peopleOn.get(task.id) + 1);
    person.taskCount += 1;
    if (person.roomId === null) {
      person.roomId = task.roomId;
      roomLoad.set(task.roomId, (roomLoad.get(task.roomId) || 0) + 1);
    }
  };

  for (const person of state) {
    if (person.taskCount > 0) continue;
    // Someone already sent to a room stays in it.
    const choices =
      person.roomId === null ? open : open.filter((task) => task.roomId === person.roomId);

    let best = null;
    for (const task of choices) {
      if (
        !best ||
        peopleOn.get(task.id) < peopleOn.get(best.id) ||
        (peopleOn.get(task.id) === peopleOn.get(best.id) &&
          (roomLoad.get(task.roomId) || 0) < (roomLoad.get(best.roomId) || 0))
      ) {
        best = task;
      }
    }
    if (best) give(person, best);
  }

  if (state.length > 0) {
    for (const task of open) {
      if (peopleOn.get(task.id) > 0) continue;
      const inRoom = state.filter((person) => person.roomId === task.roomId);
      const pool = inRoom.length > 0 ? inRoom : state;
      const person = pool.reduce((a, b) => (b.taskCount < a.taskCount ? b : a));
      give(person, task);
    }
  }

  return added;
}

module.exports = {
  MAX_NAME,
  MAX_TITLE,
  MAX_CAPTION,
  MAX_ROOMS,
  MAX_TASKS_PER_ROOM,
  MAX_PHOTOS_PER_ROOM,
  STARTER_ROOMS,
  newCode,
  newPhotoId,
  newCheckinKey,
  cleanText,
  cleanNote,
  cleanLogistics,
  pickLogistics,
  imageType,
  decodePhoto,
  shareOut,
};
