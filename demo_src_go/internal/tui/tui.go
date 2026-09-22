package tui

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
	d "secretary_go_demo/internal/domain"
)

var tabs = []string{"对话", "任务", "审批", "记忆", "操作", "规则", "提醒", "日志"}

type item struct {
	id, kind, title string
	value           d.R
}
type snapshot struct {
	session, tasks                              d.R
	approvals, operations, rules, notifications []d.R
	events                                      []d.R
}
type command struct {
	path string
	body []byte
	done func()
}

// Widget and selection state belong exclusively to the tview event loop.
type UI struct {
	client                          *Client
	app                             *tview.Application
	pages                           *tview.Pages
	root, body, actions             *tview.Flex
	board                           *tview.List
	boardIDs                        []string
	boardSelected, boardSignature   string
	list                            *tview.List
	detail, header, footer          *tview.TextView
	compose                         *tview.TextArea
	ctx                             context.Context
	cancel                          context.CancelFunc
	updates                         chan func()
	refresh                         chan struct{}
	state                           snapshot
	events                          []d.R
	entries                         []item
	selected                        string
	tab                             int
	online, busy, modal, rebuilding bool
	pending                         *command
	focus                           []tview.Primitive
	buttons                         []*tview.Button
	detailText, chatText            string
	listSignature                   string
	loadedID                        string
	readGeneration                  int
}

func New(c *Client) *UI {
	ctx, cancel := context.WithCancel(context.Background())
	u := &UI{client: c, app: tview.NewApplication(), pages: tview.NewPages(), ctx: ctx, cancel: cancel, updates: make(chan func(), 64), refresh: make(chan struct{}, 1)}
	u.header = tview.NewTextView().SetDynamicColors(false)
	u.footer = tview.NewTextView().SetDynamicColors(false)
	u.board = tview.NewList().ShowSecondaryText(true)
	u.board.SetBorder(true).SetTitle(" Task 看板 · Ctrl+T ")
	u.board.SetChangedFunc(func(i int, _, _ string, _ rune) {
		if !u.rebuilding && i >= 0 && i < len(u.boardIDs) {
			u.boardSelected = u.boardIDs[i]
		}
	})
	u.board.SetSelectedFunc(func(int, string, string, rune) { u.openBoardTask() })
	u.list = tview.NewList().ShowSecondaryText(true)
	u.list.SetBorder(true).SetTitle(" 选择 ")
	u.list.SetChangedFunc(func(i int, _, _ string, _ rune) {
		if !u.rebuilding && i >= 0 && i < len(u.entries) {
			if u.selected != u.entries[i].id {
				u.readGeneration++
				u.loadedID = ""
			}
			u.selected = u.entries[i].id
			u.showItem(false)
		}
	})
	u.list.SetSelectedFunc(func(int, string, string, rune) { u.showItem(true) })
	u.detail = tview.NewTextView().SetDynamicColors(false).SetScrollable(true).SetWrap(true).SetWordWrap(true)
	u.detail.SetBorder(true)
	u.compose = tview.NewTextArea().SetPlaceholder("Master，描述目标… Enter 换行，Ctrl+S 发送").SetMaxLength(1 << 20)
	u.compose.SetBorder(true).SetTitle(" 输入 · Enter 换行 / Ctrl+S 发送 ")
	u.actions = tview.NewFlex()
	u.body = tview.NewFlex()
	shortcuts := tview.NewTextView().SetText(" F1 主会话   F2 Tasks   F3 审批   F4 记忆   F5 操作   F6 规则   F7 提醒   F8 日志").SetDynamicColors(false)
	u.root = tview.NewFlex().SetDirection(tview.FlexRow).AddItem(u.header, 2, 0, false).AddItem(shortcuts, 1, 0, false).AddItem(u.body, 0, 1, true).AddItem(u.actions, 3, 0, false).AddItem(u.footer, 2, 0, false)
	u.pages.AddPage("main", u.root, true, true)
	u.app.SetRoot(u.pages, true).EnableMouse(true).EnablePaste(true)
	u.app.SetInputCapture(u.key)
	u.switchTab(0)
	u.footer.SetText("Ctrl+T 任务看板 · Enter 任务详情 · Esc 返回 · Tab 切焦点 · Ctrl+S 发送 · Ctrl+C 退出")
	return u
}
func (u *UI) post(f func()) {
	select {
	case u.updates <- f:
		u.app.QueueEvent(tcell.NewEventKey(tcell.KeyF64, 0, tcell.ModNone))
	case <-u.ctx.Done():
	}
}
func (u *UI) Run() error { defer u.cancel(); go u.poll(); return u.app.Run() }
func Run(ctx context.Context, c *Client) error {
	u := New(c)
	go func() {
		select {
		case <-ctx.Done():
			u.app.Stop()
			u.cancel()
		case <-u.ctx.Done():
		}
	}()
	return u.Run()
}
func (u *UI) key(e *tcell.EventKey) *tcell.EventKey {
	if e.Key() == tcell.KeyF64 {
		for {
			select {
			case f := <-u.updates:
				f()
			default:
				return nil
			}
		}
	}
	if e.Key() == tcell.KeyCtrlC {
		if u.modal {
			u.closeModal()
		} else {
			u.confirm("退出终端界面", "后台继续运行，任务与已保存资料保留。未发送的输入会丢失；提交状态未知时可留在界面用 Ctrl+R 重试同一请求。", func() { u.cancel(); u.app.Stop() })
		}
		return nil
	}
	if e.Key() == tcell.KeyEscape && u.modal {
		u.closeModal()
		return nil
	}
	if u.modal {
		return e
	}
	if e.Key() == tcell.KeyEscape && u.tab != 0 {
		u.switchTab(0)
		u.app.SetFocus(u.board)
		return nil
	}
	if e.Key() == tcell.KeyCtrlT {
		if u.tab != 0 {
			u.switchTab(0)
		}
		u.app.SetFocus(u.board)
		return nil
	}
	if e.Key() >= tcell.KeyF1 && e.Key() <= tcell.KeyF8 {
		u.switchTab(int(e.Key() - tcell.KeyF1))
		return nil
	}
	if e.Key() == tcell.KeyCtrlS {
		if u.tab == 0 {
			u.send()
		}
		return nil
	}
	if e.Key() == tcell.KeyCtrlR {
		if u.pending != nil {
			u.dispatch()
		} else {
			u.wake()
		}
		return nil
	}
	if e.Key() == tcell.KeyTab || e.Key() == tcell.KeyBacktab {
		u.cycle(e.Key() == tcell.KeyBacktab)
		return nil
	}
	return e
}
func (u *UI) cycle(back bool) {
	for i, p := range u.focus {
		if p.HasFocus() {
			if back {
				i--
			} else {
				i++
			}
			u.app.SetFocus(u.focus[(i+len(u.focus))%len(u.focus)])
			return
		}
	}
	if len(u.focus) > 0 {
		u.app.SetFocus(u.focus[0])
	}
}
func (u *UI) wake() {
	select {
	case u.refresh <- struct{}{}:
	default:
	}
}
func (u *UI) poll() {
	timer := time.NewTicker(time.Second)
	defer timer.Stop()
	var cursor int64
	for {
		var s snapshot
		var err error
		for _, q := range []struct {
			path string
			out  any
		}{{"/v1/session", &s.session}, {"/v1/tasks", &s.tasks}, {"/v1/approvals", &s.approvals}, {"/v1/operations", &s.operations}, {"/v1/rules", &s.rules}, {"/v1/notifications", &s.notifications}} {
			if err = u.client.Call(u.ctx, q.path, nil, q.out); err != nil {
				break
			}
		}
		next := cursor
		if err == nil {
			for page := 0; page < 10; page++ {
				var batch struct {
					Events []d.R `json:"events"`
					Next   int64 `json:"next"`
				}
				err = u.client.Call(u.ctx, fmt.Sprintf("/v1/events?after=%d", next), nil, &batch)
				if err != nil {
					break
				}
				if len(batch.Events) > 0 && batch.Next <= next {
					err = errors.New("event cursor made no progress")
					break
				}
				s.events = append(s.events, batch.Events...)
				next = batch.Next
				if len(batch.Events) < 100 {
					break
				}
			}
		}
		if err != nil {
			message := safe(err.Error())
			u.post(func() {
				u.online = false
				u.header.SetText("Secretary / TUI · 连接中断（保留当前视图）\n" + message)
			})
		} else {
			cursor = next
			u.post(func() { u.apply(s) })
		}
		select {
		case <-u.ctx.Done():
			return
		case <-timer.C:
		case <-u.refresh:
		}
	}
}
func (u *UI) apply(s snapshot) {
	u.online = true
	u.state = s
	u.events = append(u.events, s.events...)
	if len(u.events) > 5000 {
		u.events = u.events[len(u.events)-5000:]
	}
	run := d.M(s.session["runtime"])
	world := "未连接"
	if run["world_available"] == true {
		world = "已连接"
	}
	approvals, decisions, notices := 0, 0, 0
	for _, r := range s.approvals {
		if d.M(r["request"])["state"] == "PENDING" {
			approvals++
		}
	}
	for _, v := range d.A(s.tasks["decisions"]) {
		if d.M(v)["state"] == "OPEN" {
			decisions++
		}
	}
	for _, r := range s.notifications {
		if r["state"] != "SENT" {
			notices++
		}
	}
	u.header.SetText(safe(fmt.Sprintf("Secretary / TUI · Master · %s · World Model %s · %d 个执行者\n待审批 %d · 待决定 %d · 未读提醒 %d   %s", d.S(d.M(s.session["session"])["state"]), world, d.N(run["workers"]), approvals, decisions, notices, d.S(run["error"]))))
	if u.tab == 0 {
		u.renderChat()
		u.renderBoard()
	} else {
		u.renderList()
	}
}
func (u *UI) switchTab(n int) {
	u.readGeneration++
	u.loadedID = ""
	u.tab = n
	u.selected = ""
	u.listSignature = ""
	u.detailText = ""
	u.body.Clear()
	if n == 0 {
		left := tview.NewFlex().SetDirection(tview.FlexRow).AddItem(u.detail, 0, 1, false).AddItem(u.compose, 7, 0, true)
		u.body.AddItem(left, 0, 7, true).AddItem(u.board, 0, 3, false)
		u.detail.SetTitle(" 主会话 · 最近 5000 条事件内的对话 ")
		u.renderChat()
		u.renderBoard()
		u.setActions()
		u.app.SetFocus(u.compose)
	} else {
		u.body.AddItem(u.list, 34, 0, true).AddItem(u.detail, 0, 1, false)
		u.detail.SetTitle(" " + tabs[n] + "详情 · Esc 返回主会话 ")
		u.renderList()
		u.app.SetFocus(u.list)
	}
}
func (u *UI) renderBoard() {
	goals := d.M(u.state.tasks["goals"])
	type row struct{ id, title, status string }
	var rows []row
	executed := map[string]bool{}
	for _, v := range d.A(u.state.tasks["executions"]) {
		x := d.M(v)
		id := d.S(x["task_id"])
		executed[id] = true
		rows = append(rows, row{"execution:" + d.S(x["id"]), d.S(goals[id]), d.S(x["state"]) + " · " + short(d.S(x["id"]))})
	}
	for _, v := range d.A(u.state.tasks["plans"]) {
		p := d.M(v)
		id := d.S(p["id"])
		if !executed[id] {
			rows = append(rows, row{"plan:" + id, d.S(goals[id]), d.S(p["state"]) + " · " + d.S(d.M(p["trigger"])["kind"])})
		}
	}
	var sig strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&sig, "%s\x00%s\x00%s\n", r.id, r.title, r.status)
	}
	if sig.String() == u.boardSignature && u.board.GetItemCount() > 0 {
		return
	}
	u.boardSignature = sig.String()
	u.rebuilding = true
	u.board.Clear()
	u.boardIDs = nil
	index := 0
	for i, r := range rows {
		u.boardIDs = append(u.boardIDs, r.id)
		u.board.AddItem(tview.Escape(safe(r.title)), tview.Escape(safe(r.status)), 0, nil)
		if r.id == u.boardSelected {
			index = i
		}
	}
	if len(rows) == 0 {
		u.board.AddItem("暂无任务", "与 Secretary 对话以委派任务", 0, nil)
		u.boardSelected = ""
	} else {
		u.boardSelected = rows[index].id
		u.board.SetCurrentItem(index)
	}
	u.rebuilding = false
}
func (u *UI) openBoardTask() {
	id := u.boardSelected
	if id == "" {
		return
	}
	u.switchTab(1)
	for i, e := range u.entries {
		if e.id == id {
			u.list.SetCurrentItem(i)
			u.showItem(true)
			u.app.SetFocus(u.detail)
			return
		}
	}
	u.footer.SetText("任务已不在当前列表，请刷新。")
}
func (u *UI) renderChat() {
	var b strings.Builder
	b.WriteString("Master，欢迎回来。聊天中的同意不会批准操作；请在审批页单独确认。\n\n")
	for _, entry := range u.events {
		ev, p := d.M(entry["event"]), d.M(entry["payload"])
		switch ev["event_type"] {
		case "input.accepted":
			fmt.Fprintf(&b, "Master  %s\n%s\n\n", d.S(ev["occurred_at"]), d.S(p["text"]))
		case "model.response":
			if ev["stream"] == "MAIN" {
				var text strings.Builder
				for _, v := range d.A(d.M(p["response"])["output"]) {
					m := d.M(v)
					if m["type"] == "message" {
						for _, v := range d.A(m["content"]) {
							part := d.M(v)
							if part["type"] == "output_text" {
								text.WriteString(d.S(part["text"]))
							}
						}
					}
				}
				if text.Len() > 0 {
					fmt.Fprintf(&b, "Secretary\n%s\n\n", text.String())
				}
			}
		}
	}
	value := safe(b.String())
	if value != u.chatText || u.detail.GetText(false) != value {
		u.chatText = value
		u.detail.SetText(value).ScrollToEnd()
	}
}
func (u *UI) renderList() {
	var entries []item
	add := func(kind, title string, r d.R) {
		entries = append(entries, item{kind + ":" + d.S(r["id"]), kind, title, r})
	}
	switch u.tab {
	case 1:
		for _, v := range d.A(u.state.tasks["plans"]) {
			r := d.M(v)
			add("plan", d.S(d.M(u.state.tasks["goals"])[d.S(r["id"])]), r)
		}
		for _, v := range d.A(u.state.tasks["executions"]) {
			r := d.M(v)
			add("execution", "执行 "+short(d.S(r["id"])), r)
		}
		for _, v := range d.A(u.state.tasks["decisions"]) {
			r := d.M(v)
			if r["state"] == "OPEN" {
				add("decision", d.S(r["question"]), r)
			}
		}
	case 2:
		for _, r := range u.state.approvals {
			q := d.M(r["request"])
			if q["state"] == "PENDING" || q["state"] == "APPROVED" {
				entry := item{"approval:" + d.S(q["id"]), "approval", d.S(d.M(q["action"])["action"]), r}
				entries = append(entries, entry)
			}
		}
	case 3:
		entries = []item{{"consciousness", "memory", "Consciousness 工作记忆", d.M(u.state.session["consciousness"])}, {"world", "world", "World Model 长期事实", nil}}
	case 4:
		for _, r := range u.state.operations {
			add("operation", d.S(d.M(r["action"])["action"]), r)
		}
	case 5:
		for _, r := range u.state.rules {
			add("rule", strings.Join(stringsFrom(r["actions"]), ", "), r)
		}
	case 6:
		for _, r := range u.state.notifications {
			add("notice", d.S(r["text"]), r)
		}
	case 7:
		for i := len(u.events) - 1; i >= 0; i-- {
			r := u.events[i]
			ev := d.M(r["event"])
			entries = append(entries, item{d.S(ev["event_id"]), "event", d.S(ev["event_type"]), r})
		}
	}
	signature := pretty(entriesForSignature(entries))
	u.entries = entries
	if signature != u.listSignature {
		selected := u.selected
		u.rebuilding = true
		u.list.Clear()
		index := 0
		for i, e := range entries {
			r := e.value
			if e.kind == "approval" {
				r = d.M(r["request"])
			}
			u.list.AddItem(tview.Escape(safe(e.title)), tview.Escape(safe(d.S(r["state"])+" "+short(d.S(r["id"])))), 0, nil)
			if e.id == selected {
				index = i
			}
		}
		u.rebuilding = false
		u.listSignature = signature
		if len(entries) > 0 {
			if u.selected != entries[index].id {
				u.readGeneration++
				u.loadedID = ""
			}
			u.selected = entries[index].id
			u.list.SetCurrentItem(index)
		} else {
			u.selected = ""
		}
		u.showItem(false)
	}
}
func entriesForSignature(items []item) []any {
	out := []any{}
	for _, e := range items {
		out = append(out, []any{e.id, e.title, e.value})
	}
	return out
}
func short(s string) string {
	if len(s) > 8 {
		return s[:8]
	}
	return s
}
func stringsFrom(v any) []string {
	var out []string
	for _, x := range d.A(v) {
		out = append(out, d.S(x))
	}
	return out
}
func (u *UI) current() *item {
	for i := range u.entries {
		if u.entries[i].id == u.selected {
			return &u.entries[i]
		}
	}
	return nil
}
func (u *UI) showItem(open bool) {
	e := u.current()
	if e == nil {
		u.detail.SetText("暂无记录。")
		u.setActions()
		return
	}
	if u.loadedID != "" && u.loadedID != e.id {
		u.loadedID = ""
		u.readGeneration++
	}
	if !open && u.loadedID == e.id {
		u.setActions()
		return
	}
	if e.kind == "world" {
		if open {
			u.read("/v1/world", e.id)
		} else {
			u.detail.SetText("按 Enter 或选择「检索事实」，查看带来源的长期事实。")
		}
	} else if open && e.kind == "execution" {
		u.read("/v1/task-detail?execution_id="+url.QueryEscape(d.S(e.value["id"])), e.id)
	} else {
		value := pretty(e.value)
		if value != u.detailText {
			u.detailText = value
			u.detail.SetText(value).ScrollToBeginning()
		}
	}
	u.setActions()
}
func (u *UI) read(path, identity string) {
	u.readGeneration++
	generation := u.readGeneration
	u.footer.SetText("正在读取…")
	go func() {
		var result any
		err := u.client.Call(u.ctx, path, nil, &result)
		u.post(func() {
			if u.selected != identity || generation != u.readGeneration {
				return
			}
			if err != nil {
				u.footer.SetText(safe(err.Error()))
				return
			}
			u.loadedID = identity
			u.detailText = pretty(result)
			if strings.HasPrefix(identity, "execution:") {
				r := d.M(result)
				x := d.M(r["execution"])
				u.detailText = safe(fmt.Sprintf("执行状态：%s\n任务：%s\n保留状态：%s\n\n", d.S(x["state"]), d.S(d.M(u.state.tasks["goals"])[d.S(x["task_id"])]), d.S(x["retention_state"]))) + u.detailText
			}
			u.detail.SetText(u.detailText).ScrollToBeginning()
			u.footer.SetText("已读取；任务详情访问会刷新保留时间。")
		})
	}()
}
func (u *UI) setActions() {
	focusedLabel := ""
	for _, b := range u.buttons {
		if b.HasFocus() {
			focusedLabel = b.GetLabel()
		}
	}
	u.actions.Clear()
	u.buttons = nil
	add := func(label string, fn func()) {
		b := tview.NewButton(label).SetSelectedFunc(fn)
		u.buttons = append(u.buttons, b)
		u.actions.AddItem(b, 0, 1, false)
	}
	if u.tab == 0 {
		add("发送 Ctrl+S", u.send)
		add("继续保存的进度", func() { u.mutate("/v1/retry", d.R{}, nil) })
		add("整理工作记忆", func() { u.mutate("/v1/maintenance", d.R{}, nil) })
	}
	if u.tab == 3 {
		add("整理工作记忆", func() { u.mutate("/v1/maintenance", d.R{}, nil) })
		add("检索事实", func() {
			u.edit("检索 World Model", "", func(text string) { u.selected = "world"; u.read("/v1/world?q="+url.QueryEscape(text), "world") })
		})
	}
	if u.tab == 5 {
		add("新建持续规则", func() {
			u.edit("持续授权规则 JSON", `{"actions":["file.write"],"resource_prefixes":["请填写明确路径"],"parameter_constraints":{"type":"object","properties":{"path":{"const":"指定文件.txt"}},"required":["path"]},"expires_at":"请填写 UTC RFC3339"}`, u.saveRule)
		})
	}
	if e := u.current(); e != nil {
		r := e.value
		switch e.kind {
		case "approval":
			q := d.M(r["request"])
			if q["state"] == "PENDING" {
				add("批准这一次", func() { u.approve(r, "APPROVE") })
				add("拒绝", func() { u.approve(r, "REJECT") })
			} else {
				add("撤销批准", func() { u.approve(r, "REVOKE") })
			}
		case "plan":
			if r["state"] == "ACTIVE" {
				add("暂停计划", func() { u.control(r, "PAUSE_PLAN", nil) })
			}
			if r["state"] == "PAUSED" {
				add("恢复计划", func() { u.control(r, "RESUME_PLAN", nil) })
			}
			if r["state"] != "CLOSED" {
				add("结束计划", func() { u.control(r, "CLOSE_PLAN", nil) })
			}
		case "execution":
			id := e.id
			add("读取详情", func() { u.read("/v1/task-detail?execution_id="+url.QueryEscape(d.S(r["id"])), id) })
			if !strings.Contains("|SUCCEEDED|FAILED|CANCELLED|EXPIRED|RESULT_UNKNOWN|", "|"+d.S(r["state"])+"|") {
				add("请求取消", func() { u.control(r, "CANCEL_EXECUTION", nil) })
			}
		case "decision":
			add("回答普通决定", func() {
				u.edit("普通工作决定（不授予权限）\n"+d.S(r["question"]), "", func(text string) {
					for _, v := range d.A(u.state.tasks["executions"]) {
						x := d.M(v)
						if x["id"] == r["execution_id"] {
							u.control(x, "ANSWER_DECISION", d.R{"decision_request_id": r["id"], "answer": text})
							return
						}
					}
					u.footer.SetText("执行已不在当前列表，请刷新后再试。")
				})
			})
		case "operation":
			if r["state"] == "RESULT_UNKNOWN" && d.M(r["action"])["action"] == "file.write" {
				add("只读核验文件", func() { u.mutate("/v1/reconcile", d.R{"operation_id": r["id"]}, nil) })
			}
		case "notice":
			if r["state"] != "SENT" {
				add("确认已读", func() { u.mutate("/v1/notifications/ack", d.R{"id": r["id"]}, nil) })
			}
		case "rule":
			add("编辑 / 停用规则", func() {
				id := d.S(r["id"])
				go func() {
					var result d.R
					err := u.client.Call(u.ctx, "/v1/rule-detail?id="+url.QueryEscape(id), nil, &result)
					u.post(func() {
						if u.tab != 5 || u.selected != "rule:"+id {
							return
						}
						if err != nil {
							u.footer.SetText(safe(err.Error()))
							return
						}
						rule := d.M(result["rule"])
						args := d.R{"id": rule["id"], "expected_revision": rule["revision"], "state": rule["state"], "actions": rule["actions"], "resource_prefixes": rule["resource_prefixes"], "parameter_constraints": result["parameter_constraints"], "expires_at": rule["expires_at"]}
						u.edit("编辑规则 · state=DISABLED 可停用", pretty(args), u.saveRule)
					})
				}()
			})
		}
	}
	add("刷新 / 重试", func() {
		if u.pending != nil {
			u.dispatch()
		} else {
			u.wake()
		}
	})
	u.focus = nil
	if u.tab == 0 {
		u.focus = append(u.focus, u.compose, u.board, u.detail)
	} else {
		u.focus = append(u.focus, u.list, u.detail)
	}
	for _, b := range u.buttons {
		u.focus = append(u.focus, b)
		if focusedLabel != "" && b.GetLabel() == focusedLabel && !u.modal {
			u.app.SetFocus(b)
			focusedLabel = ""
		}
	}
	if focusedLabel != "" && !u.modal {
		u.app.SetFocus(u.list)
	}
}
func (u *UI) approve(entry d.R, decision string) {
	q := d.M(entry["request"])
	body := d.Empty("ApprovalCommand")
	body["request_id"] = d.ID()
	body["authorization_id"] = q["id"]
	body["expected_revision"] = q["revision"]
	body["display_hash"] = q["display_hash"]
	body["decision"] = decision
	u.confirm("确认授权决定 · "+decision, pretty(entry["display"]), func() { u.mutate("/v1/approvals/decisions", body, nil) })
}
func (u *UI) control(r d.R, action string, extra d.R) {
	args := d.R{"action": action, "target_id": r["id"], "expected_revision": r["revision"]}
	for k, v := range extra {
		args[k] = v
	}
	body := d.R{"request_id": d.ID(), "args": args}
	u.confirm("确认任务操作", pretty(args), func() { u.mutate("/v1/task-control", body, nil) })
}
func (u *UI) saveRule(text string) {
	var args d.R
	if err := d.Decode([]byte(text), &args); err != nil {
		u.footer.SetText("规则 JSON 无效：" + safe(err.Error()))
		return
	}
	u.confirm("确认持续授权范围", pretty(args), func() { u.mutate("/v1/rules", d.R{"request_id": d.ID(), "args": args}, nil) })
}
func (u *UI) send() {
	text := u.compose.GetText()
	if strings.TrimSpace(text) == "" {
		return
	}
	u.mutate("/v1/inputs", d.R{"request_id": d.ID(), "text": text}, func() {
		if u.compose.GetText() == text {
			u.compose.SetText("", true)
		}
	})
}
func (u *UI) mutate(path string, body any, done func()) {
	if u.pending != nil {
		u.footer.SetText("上次提交尚未确认。Ctrl+R 使用原 request_id 重试；不会发送新命令。")
		return
	}
	if !u.online {
		u.footer.SetText("连接不可用，输入已保留。连接恢复后再提交。")
		return
	}
	u.pending = &command{path, d.Bytes(body), done}
	u.dispatch()
}
func (u *UI) dispatch() {
	if u.busy || u.pending == nil {
		return
	}
	u.busy = true
	cmd := u.pending
	u.footer.SetText("正在提交；收到持久化回执后确认…")
	go func() {
		err := u.client.Call(u.ctx, cmd.path, cmd.body, nil)
		u.post(func() {
			u.busy = false
			if err != nil {
				var he *HTTPError
				if errors.As(err, &he) && he.Status >= 400 && he.Status < 500 {
					u.pending = nil
					u.footer.SetText("请求被拒绝，输入保留：" + safe(err.Error()))
				} else {
					u.footer.SetText("提交状态未知；Ctrl+R 重试同一请求：" + safe(err.Error()))
				}
				return
			}
			u.pending = nil
			if cmd.done != nil {
				cmd.done()
			}
			u.footer.SetText("已确认保存。F1–F8 切页 · Tab 切焦点 · Ctrl+C 退出界面")
			u.wake()
		})
	}()
}
func (u *UI) closeModal() {
	u.modal = false
	u.pages.RemovePage("dialog")
	if u.tab == 0 {
		u.app.SetFocus(u.compose)
	} else {
		u.app.SetFocus(u.list)
	}
}
func (u *UI) dialog(title string, content tview.Primitive, done func()) {
	u.modal = true
	buttons := tview.NewFlex()
	cancel := tview.NewButton("返回").SetSelectedFunc(u.closeModal)
	confirm := tview.NewButton("确认").SetSelectedFunc(func() { u.closeModal(); done() })
	buttons.AddItem(cancel, 0, 1, false).AddItem(confirm, 0, 1, false)
	box := tview.NewFlex().SetDirection(tview.FlexRow).AddItem(content, 0, 1, true).AddItem(buttons, 3, 0, false)
	box.SetBorder(true).SetTitle(tview.Escape(safe(" " + title + " · Tab 切到按钮 / Esc 返回 ")))
	box.SetInputCapture(func(e *tcell.EventKey) *tcell.EventKey {
		if e.Key() == tcell.KeyTab || e.Key() == tcell.KeyBacktab {
			choices := []tview.Primitive{content, cancel, confirm}
			for i, p := range choices {
				if p.HasFocus() {
					if e.Key() == tcell.KeyBacktab {
						i += 2
					} else {
						i++
					}
					u.app.SetFocus(choices[i%3])
					return nil
				}
			}
		}
		return e
	})
	u.pages.AddPage("dialog", box, true, true)
	u.app.SetFocus(content)
}
func (u *UI) confirm(title, text string, done func()) {
	view := tview.NewTextView().SetDynamicColors(false).SetScrollable(true).SetWrap(true).SetText(safe(text))
	u.dialog(title, view, done)
}
func (u *UI) edit(title, text string, done func(string)) {
	editor := tview.NewTextArea().SetText(text, true)
	u.dialog(title, editor, func() { done(editor.GetText()) })
}
