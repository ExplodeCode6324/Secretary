import {
  ProcessTerminal,
  TuiAltScreen,
  Text,
  VStack,
  ScrollView,
  matchesKey,
} from "@earendil-works/pi-tui";
import { DraftEditor, configureKeys } from "../src/tui/input.ts";
configureKeys();
const terminal = new ProcessTerminal(),
  tui = new TuiAltScreen(terminal);
const output = new Text(
  "原生输入预检（不连接 Core，不发送业务消息）\n请用系统中文输入法输入并确认候选，Enter 换行；Shift+Enter 提交只记次数。\n/T 后 Tab 或 Enter 仅补全，再 Shift+Enter 才计提交。Ctrl+C 退出。",
  1,
  1,
);
const editor = new DraftEditor(tui, () => "Main");
let count = 0;
const hint = new Text("提交次数 0", 1, 0);
editor.onExplicitSubmit = (raw) => {
  count++;
  hint.setText(`提交次数 ${count}；原文 ${JSON.stringify(raw)}`);
  tui.requestRender();
};
editor.onEdited = () => tui.requestRender();
tui.setLayoutRoot(
  new VStack([
    {
      component: new ScrollView(output, { primary: true, follow: "none" }),
      basis: 0,
      grow: 1,
      minSize: 1,
    },
    { component: editor, basis: "auto", maxSize: 10, minSize: 3 },
    { component: hint, basis: 1 },
  ]),
);
tui.setFocus(editor);
tui.addInputListener((data) => {
  if (matchesKey(data, "ctrl+c")) {
    clearInterval(timer);
    tui.stop();
    return { consume: true };
  }
});
const timer = setInterval(() => {
  output.setText(
    `原生输入预检（不连接 Core）\n后台刷新 ${new Date().toLocaleTimeString()}；输入应保持完整。\n中文候选确认不得增加提交次数；Enter 换行；Shift+Enter 提交。\nTab/菜单内Enter只补全；Ctrl+C退出。`,
  );
  tui.requestRender();
}, 500);
tui.start();
