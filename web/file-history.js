// Vim-style jumplist over opened files, with jumpoptions=stack semantics.
// Entries are file paths; the current position is an index into them.
export function createFileHistory(initial = "") {
  const entries = initial ? [initial] : [];
  let index = entries.length - 1;
  const at = (position) =>
    position >= 0 && position < entries.length ? entries[position] : null;
  return {
    get current() {
      return at(index) ?? "";
    },
    // Records a newly opened file and drops the forward entries. Returns
    // false, and records nothing, for an empty path or the current file.
    visit(path) {
      if (!path || path === at(index)) return false;
      entries.splice(index + 1);
      entries.push(path);
      index = entries.length - 1;
      return true;
    },
    // The file one step away (-1 back, 1 forward), without moving.
    peek(step) {
      return at(index + step);
    },
    // Moves one step and returns the file reached, or null at an end.
    move(step) {
      const target = at(index + step);
      if (target !== null) index += step;
      return target;
    },
    // Removes every entry for a file that can no longer be opened. The
    // position stays on the same entry when it survives; when the current
    // entry itself is removed, it moves to the entry before it.
    drop(path) {
      const kept = [];
      let reached = 0;
      entries.forEach((entry, position) => {
        if (entry === path) return;
        kept.push(entry);
        if (position <= index) reached++;
      });
      entries.splice(0, entries.length, ...kept);
      index = reached - 1;
    },
  };
}
