import { formatDay } from "./narnia.js";

export const HANGOUT_TYPES = ["Sports", "Studying", "Food", "Games"];

export const STATUS_LABELS = { planned: "Planned", active: "Running", ended: "Ended" };

// "18:30" as an iPhone shows it: "6:30 PM".
export function formatTime(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return value || "";
  const suffix = hours < 12 ? "AM" : "PM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

export function timesText(outing) {
  return [outing.startTime, outing.endTime].filter(Boolean).map(formatTime).join(" – ");
}

// "Sat, 7 Nov" — the weekday is what people actually plan around.
export function dayText(heldOn) {
  const [year, month, day] = String(heldOn).split("-").map(Number);
  if (!year) return "";
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function whenText(outing) {
  return [formatDay(outing.heldOn), timesText(outing)].filter(Boolean).join(" · ");
}

export function friendsText(outing) {
  const parts = [];
  if (outing.friendsCount !== null) parts.push(String(outing.friendsCount));
  if (outing.friendsWho) parts.push(outing.friendsWho);
  return parts.join(" · ");
}
