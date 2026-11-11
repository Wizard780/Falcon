// Search cards' index (cards.cjs) in a process of its own, started on the first search. A big backfile's index is a
// gigabyte or more, and only an exit is sure to give all of it back: once macOS has compressed pages a GC frees,
// it keeps counting them. So a few minutes without a search, this exits; the next search starts it again.
// Main owns the allowed folders, so the list of files to read is asked of it.
const { createCardIndex } = require('./cards.cjs');

const port = process.parentPort;
const asks = new Map();
let next = 0;
const listFiles = () => new Promise((resolve, reject) => {
  const id = ++next;
  asks.set(id, { resolve, reject });
  port.postMessage({ files: id });
});
// a scan that couldn't get the file list just doesn't happen; it must not take the searches down with it
process.on('unhandledRejection', () => {});

const index = createCardIndex(process.argv[2], listFiles, { onRelease: () => process.exit(0) });
port.on('message', ({ data: m }) => {
  if (m.files) {
    const a = asks.get(m.files);
    asks.delete(m.files);
    if (m.error) a?.reject(new Error(m.error)); else a?.resolve(m.list);
    return;
  }
  index.search(m.query, m.limit, m.hide).then((r) => port.postMessage({ id: m.id, r }), (e) => port.postMessage({ id: m.id, error: String(e?.message ?? e) }));
});
