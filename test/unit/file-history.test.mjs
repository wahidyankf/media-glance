import assert from "node:assert/strict";
import test from "node:test";
import { createFileHistory } from "../../web/file-history.js";

test("a new history starts on the initial file, or on nothing when no file is selected", () => {
  const selected = createFileHistory("a.md");
  assert.equal(selected.current, "a.md");
  assert.equal(selected.peek(-1), null);
  assert.equal(selected.peek(1), null);

  const empty = createFileHistory("");
  assert.equal(empty.current, "");
  assert.equal(empty.peek(-1), null);
  assert.equal(empty.peek(1), null);
  assert.equal(createFileHistory().current, "");
});

test("visiting records a file and makes it current, and the first real file is recorded from an empty history", () => {
  const history = createFileHistory("");
  assert.equal(history.visit("a.md"), true);
  assert.equal(history.current, "a.md");
  assert.equal(history.visit("b.md"), true);
  assert.equal(history.current, "b.md");
  assert.equal(history.peek(-1), "a.md");
  assert.equal(history.peek(1), null);
});

test("A to B to C: stepping back twice reaches A, and stepping forward twice returns to C", () => {
  const history = createFileHistory("a.md");
  history.visit("b.md");
  history.visit("c.md");
  assert.equal(history.move(-1), "b.md");
  assert.equal(history.move(-1), "a.md");
  assert.equal(history.current, "a.md");
  assert.equal(history.move(1), "b.md");
  assert.equal(history.move(1), "c.md");
  assert.equal(history.current, "c.md");
});

test("stepping past either end returns null and leaves the current file unchanged", () => {
  const history = createFileHistory("a.md");
  history.visit("b.md");
  assert.equal(history.move(1), null);
  assert.equal(history.current, "b.md");
  assert.equal(history.move(-1), "a.md");
  assert.equal(history.move(-1), null);
  assert.equal(history.current, "a.md");
  assert.equal(history.peek(-1), null);
});

test("peek shows the neighbouring file in either direction without moving", () => {
  const history = createFileHistory("a.md");
  history.visit("b.md");
  history.visit("c.md");
  history.move(-1);
  assert.equal(history.peek(-1), "a.md");
  assert.equal(history.peek(1), "c.md");
  assert.equal(history.current, "b.md");
});

test("going back and then visiting a new file drops every forward entry", () => {
  const history = createFileHistory("a.md");
  history.visit("b.md");
  history.visit("c.md");
  history.move(-1);
  history.move(-1);
  assert.equal(history.visit("d.md"), true);
  assert.equal(history.current, "d.md");
  assert.equal(history.peek(1), null);
  assert.equal(history.move(-1), "a.md");
  assert.equal(history.move(1), "d.md");
  assert.equal(history.move(1), null);
});

test("revisiting the current file records nothing", () => {
  const history = createFileHistory("a.md");
  assert.equal(history.visit("a.md"), false);
  assert.equal(history.peek(-1), null);
  history.visit("b.md");
  assert.equal(history.visit("b.md"), false);
  assert.equal(history.move(-1), "a.md");
  assert.equal(history.move(1), "b.md");
  assert.equal(history.move(1), null);
});

test("an empty path is never recorded", () => {
  const history = createFileHistory("a.md");
  assert.equal(history.visit(""), false);
  assert.equal(history.current, "a.md");
  assert.equal(history.peek(-1), null);
  assert.equal(history.peek(1), null);
});

test("dropping an entry before the current file keeps the current file and its neighbours", () => {
  const history = createFileHistory("a.md");
  history.visit("b.md");
  history.visit("c.md");
  history.move(-1);
  history.drop("a.md");
  assert.equal(history.current, "b.md");
  assert.equal(history.peek(-1), null);
  assert.equal(history.move(1), "c.md");
});

test("dropping the current entry moves the position to the entry before it", () => {
  const history = createFileHistory("a.md");
  history.visit("b.md");
  history.visit("c.md");
  history.move(-1);
  history.drop("b.md");
  assert.equal(history.current, "a.md");
  assert.equal(history.peek(1), "c.md");
  assert.equal(history.move(1), "c.md");
});

test("dropping an entry after the current file leaves the current file in place", () => {
  const history = createFileHistory("a.md");
  history.visit("b.md");
  history.visit("c.md");
  history.drop("c.md");
  assert.equal(history.current, "b.md");
  assert.equal(history.peek(1), null);
  assert.equal(history.move(-1), "a.md");
});

test("dropping removes every occurrence of a path, and an absent or empty path changes nothing", () => {
  const history = createFileHistory("a.md");
  history.visit("b.md");
  history.visit("a.md");
  history.visit("c.md");
  history.move(-1);
  history.drop("a.md");
  assert.equal(history.current, "b.md");
  assert.equal(history.move(-1), null);
  assert.equal(history.move(1), "c.md");
  history.drop("missing.md");
  history.drop("");
  assert.equal(history.current, "c.md");
  assert.equal(history.move(-1), "b.md");
});

test("dropping every entry leaves no current file and a later visit starts a fresh history", () => {
  const history = createFileHistory("a.md");
  history.visit("b.md");
  history.drop("a.md");
  history.drop("b.md");
  assert.equal(history.current, "");
  assert.equal(history.peek(-1), null);
  assert.equal(history.peek(1), null);
  assert.equal(history.visit("c.md"), true);
  assert.equal(history.current, "c.md");
  assert.equal(history.peek(-1), null);
  assert.equal(history.move(-1), null);
});
