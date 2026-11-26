// Separate from the existing research library so upgrades preserve saved briefs.
const key = "ungai-study-notes";
export function readNotes(storage) {
  try {
    const value = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value
          .filter(
            (note) =>
              note &&
              typeof note.id === "string" &&
              typeof note.title === "string" &&
              typeof note.body === "string" &&
              typeof note.updatedAt === "string",
          )
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
export function saveNote(storage, notes, note) {
  const title = note.title.trim();
  const body = note.body.trim();
  if (!title || title.length > 120 || !body || body.length > 12000)
    throw new Error(
      "Add a title (up to 120 characters) and notes (up to 12,000 characters).",
    );
  const existing = notes.some((item) => item.id === note.id);
  if (!existing && notes.length >= 100)
    throw new Error("You have 100 notes. Remove one before adding another.");
  const next = [
    { ...note, title, body },
    ...notes.filter((item) => item.id !== note.id),
  ];
  storage.setItem(key, JSON.stringify(next));
  return next;
}
export function deleteNote(storage, notes, id) {
  const next = notes.filter((note) => note.id !== id);
  storage.setItem(key, JSON.stringify(next));
  return next;
}
