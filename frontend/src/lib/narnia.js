// The placements a leader makes on the board, applied on the spot rather than
// after the server answers, so a dropped name lands where it was dropped. The
// server's answer replaces this a moment later. Kept in step with the assign and
// room routes in backend/routes/narnia.js.

function updatePerson(board, checkinId, change) {
  return {
    ...board,
    people: board.people.map((person) =>
      person.id === checkinId ? { ...person, ...change(person) } : person
    ),
  };
}

export function roomOfTask(board, taskId) {
  return board.rooms.find((room) => room.tasks.some((task) => task.id === taskId))?.id ?? null;
}

export function assignToTask(board, checkinId, taskId, fromTaskId = null) {
  return updatePerson(board, checkinId, (person) => ({
    roomId: roomOfTask(board, taskId),
    taskIds: [...new Set([...person.taskIds.filter((id) => id !== fromTaskId), taskId])],
  }));
}

export function takeOffTask(board, checkinId, taskId) {
  return updatePerson(board, checkinId, (person) => ({
    taskIds: person.taskIds.filter((id) => id !== taskId),
  }));
}

// Being sent to a room drops any tasks elsewhere, and null sends them back to the
// list with no room and no tasks.
export function sendToRoom(board, checkinId, roomId) {
  return updatePerson(board, checkinId, (person) => ({
    roomId,
    taskIds: person.taskIds.filter((id) => roomId !== null && roomOfTask(board, id) === roomId),
  }));
}

export function setTaskDone(board, taskId, done) {
  return {
    ...board,
    rooms: board.rooms.map((room) => ({
      ...room,
      tasks: room.tasks.map((task) => (task.id === taskId ? { ...task, done } : task)),
    })),
  };
}

// The day on the phone, not in UTC, which is yesterday for a Sunday morning in
// Singapore until 8am.
export function localDay(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(value) {
  const [year, month, day] = String(value).split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}
