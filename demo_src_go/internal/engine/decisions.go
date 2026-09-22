package engine

import (
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/store"
)

func (a *App) expireDecisions() error {
	return a.Store.Update(func(t *store.Tx) error {
		for _, q := range t.List("DecisionRequest") {
			if q["state"] != "OPEN" || q["deadline"] == nil || a.Now().Before(d.Time(q["deadline"])) {
				continue
			}
			x := t.Get("Execution", d.S(q["execution_id"]))
			if x == nil || x["state"] != "WAIT_DECISION" {
				continue
			}
			q["state"] = "EXPIRED"
			x["state"] = "READY"
			waiting := []any{}
			for _, id := range d.A(x["waiting_request_ids"]) {
				if id != q["id"] {
					waiting = append(waiting, id)
				}
			}
			x["waiting_request_ids"] = waiting
			if err := t.Save(q); err != nil {
				return err
			}
			if err := t.Save(x); err != nil {
				return err
			}
			if _, err := t.Log("decision.expired", "SCHEDULER", a.scopeTx(t, d.S(x["id"])), d.S(q["id"]), d.R{"decision_request_id": q["id"], "deadline": q["deadline"], "answer": nil}); err != nil {
				return err
			}
			if err := a.feedbackTx(t, d.S(x["id"]), "PROGRESS", "普通工作决定已过期，没有收到有效回答；执行将重新评估，不视作批准。", nil); err != nil {
				return err
			}
		}
		return nil
	})
}
