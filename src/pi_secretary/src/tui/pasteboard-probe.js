ObjC.import('AppKit');
function run() {
  const board = $.NSPasteboard.generalPasteboard;
  return JSON.stringify({types: ObjC.deepUnwrap(board.types), changeCount: Number(board.changeCount)});
}
