import { test } from "node:test";
import assert from "node:assert/strict";
import { readNotes, saveNote, deleteNote } from "../public/notes.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
}
const note = {
  id: "note-1",
  title: " Biology ",
  body: " Cells contain DNA. ",
  updatedAt: "2026-11-25T00:00:00Z",
};
test("notes persist across reloads, edit without duplicates, and delete independently of research", () => {
  const store = storage();
  store.setItem("folio-library", "existing-research");
  const first = saveNote(store, [], note);
  assert.equal(first[0].title, "Biology");
  assert.equal(first[0].body, "Cells contain DNA.");
  assert.deepEqual(readNotes(store), first);
  const edited = saveNote(store, readNotes(store), {
    ...note,
    body: "Revised class notes",
  });
  assert.equal(edited.length, 1);
  assert.equal(readNotes(store)[0].body, "Revised class notes");
  assert.deepEqual(deleteNote(store, edited, note.id), []);
  assert.deepEqual(readNotes(store), []);
  assert.equal(store.getItem("folio-library"), "existing-research");
});
test("invalid data and storage failures cannot silently replace saved notes", () => {
  const store = storage();
  for (const value of ["{", "null", "{}", '[{"id":"broken"}]']) {
    store.setItem("ungai-study-notes", value);
    assert.deepEqual(readNotes(store), []);
  }
  assert.throws(
    () => saveNote(store, [], { ...note, body: "   " }),
    /Add a title/,
  );
  const full = Array.from({ length: 100 }, (_, i) => ({
    ...note,
    id: String(i),
  }));
  assert.throws(() => saveNote(store, full, note), /100 notes/);
  assert.equal(saveNote(store, full, { ...note, id: "0" }).length, 100);
  const failing = {
    setItem: () => {
      throw new Error("Quota exceeded");
    },
  };
  assert.throws(
    () => saveNote(failing, [note], { ...note, body: "Changed" }),
    /Quota/,
  );
  assert.throws(() => deleteNote(failing, [note], note.id), /Quota/);
  assert.equal(note.body, " Cells contain DNA. ");
});
