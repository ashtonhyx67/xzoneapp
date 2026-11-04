import { formatDay } from "./narnia.js";

export const HANGOUT_TYPES = ["Sports", "Studying", "Food", "Games"];

export const STATUS_LABELS = { planned: "Planned", active: "Running", ended: "Ended" };

export function whenText(outing) {
  const times = [outing.startTime, outing.endTime].filter(Boolean).join(" – ");
  return [formatDay(outing.heldOn), times].filter(Boolean).join(" · ");
}

export function friendsText(outing) {
  const parts = [];
  if (outing.friendsCount !== null) parts.push(String(outing.friendsCount));
  if (outing.friendsWho) parts.push(outing.friendsWho);
  return parts.join(" · ");
}
