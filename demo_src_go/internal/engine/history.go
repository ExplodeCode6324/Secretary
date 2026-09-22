package engine

import (
	"context"
	"encoding/base64"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode"

	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/model"
)

type historyDocument struct {
	event d.R
	text  string
}

// Rebuildable search cache only: journal/object bytes remain the evidence authority.
// Index positions are append-only, and cursors bind a query to a fixed sequence.
type historyIndex struct {
	mu        sync.Mutex
	sequence  int64
	documents []historyDocument
	postings  map[string][]int
}
type historyCursor struct {
	Query    string `json:"query"`
	Sequence int64  `json:"sequence"`
	Offset   int    `json:"offset"`
	Kind     string `json:"kind,omitempty"`
}

var historyEntity = regexp.MustCompile(`[a-z0-9]+(?:[-_][a-z0-9]+)+`)

func historyTerms(text string) map[string]bool {
	terms := map[string]bool{}
	text = strings.ToLower(text)
	// Preserve short entity IDs such as P-A: individual one-letter tokens are
	// intentionally omitted, but the complete identifier is useful evidence.
	for _, entity := range historyEntity.FindAllString(text, -1) {
		terms[entity] = true
	}
	var ascii, han []rune
	flushASCII := func() {
		if len(ascii) > 1 {
			terms[string(ascii)] = true
		}
		ascii = nil
	}
	flushHan := func() {
		if len(han) == 1 {
			terms[string(han)] = true
		}
		for i := 0; i+1 < len(han); i++ {
			terms[string(han[i:i+2])] = true
		}
		han = nil
	}
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Han, r):
			flushASCII()
			han = append(han, r)
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			flushHan()
			ascii = append(ascii, r)
		default:
			flushASCII()
			flushHan()
		}
	}
	flushASCII()
	flushHan()
	return terms
}
func (a *App) updateHistory(ctx context.Context) error {
	h := &a.history
	if h.postings == nil {
		h.postings = map[string][]int{}
	}
	for _, ev := range a.Store.Events() {
		if d.N(ev["sequence"]) <= h.sequence {
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		// Exclude model-request copies, memory tool echoes and compaction outputs:
		// recursively indexing their quoted history would swamp original evidence.
		kind := d.S(ev["event_type"])
		text := ""
		switch kind {
		case "input.loaded", "task.context", "model.response", "feedback.delivered", "program.result":
			p, err := a.payload(ev)
			if err != nil {
				return err
			}
			switch kind {
			case "input.loaded":
				text = d.S(p["text"])
			case "model.response":
				text = model.Text(d.M(p["response"]))
			case "feedback.delivered":
				text = d.S(p["summary"])
			default:
				text = string(d.Bytes(p))
			}
		}
		if text != "" {
			position := len(h.documents)
			h.documents = append(h.documents, historyDocument{ev, text})
			for term := range historyTerms(text) {
				h.postings[term] = append(h.postings[term], position)
			}
		}
		h.sequence = d.N(ev["sequence"])
	}
	return nil
}

// searchHistory returns complete original payloads or explicitly marked references,
// never presents a keyword miss as proof that Master did not provide information.
func (a *App) searchHistory(ctx context.Context, args d.R, covered map[string]bool, maxBytes int) (d.R, error) {
	h := &a.history
	h.mu.Lock()
	defer h.mu.Unlock()
	if err := a.updateHistory(ctx); err != nil {
		return nil, err
	}
	query := d.S(args["query"])
	queryHash := d.Hash([]byte(query))
	cur := historyCursor{Query: queryHash, Sequence: h.sequence, Kind: d.S(args["event_type"])}
	if before := d.N(args["before_sequence"]); before > 0 && before < cur.Sequence {
		cur.Sequence = before
	}
	if value := d.S(args["cursor"]); value != "" {
		if len(value) > 512 {
			return nil, fmt.Errorf("invalid history cursor")
		}
		raw, err := base64.RawURLEncoding.DecodeString(value)
		if err != nil {
			return nil, fmt.Errorf("invalid history cursor")
		}
		if err = d.Decode(raw, &cur); err != nil || cur.Query != queryHash || cur.Sequence > h.sequence || cur.Offset < 0 {
			return nil, fmt.Errorf("history cursor/query mismatch")
		}
	}
	if cur.Kind != "" && cur.Kind != "input.loaded" {
		return nil, fmt.Errorf("unsupported history event filter")
	}
	limit := int(d.N(args["limit"]))
	if limit == 0 {
		limit = 10
	}
	if limit < 1 || limit > 30 {
		return nil, fmt.Errorf("history limit must be 1..30")
	}
	type match struct {
		position int
		score    float64
	}
	eligible := map[int]bool{}
	for i, doc := range h.documents {
		if d.N(doc.event["sequence"]) > cur.Sequence || cur.Kind != "" && doc.event["event_type"] != cur.Kind {
			continue
		}
		if covered != nil && (!covered[d.S(doc.event["event_id"])] || doc.event["event_type"] != "input.loaded") {
			continue
		}
		eligible[i] = true
	}
	scores := map[int]float64{}
	if query == "" {
		for i := range eligible {
			scores[i] = 0
		}
	} else {
		terms := []string{}
		for term := range historyTerms(query) {
			terms = append(terms, term)
		}
		sort.Strings(terms)
		for _, term := range terms {
			posting := h.postings[term]
			count := 0
			for _, i := range posting {
				if eligible[i] {
					count++
				}
			}
			weight := math.Log(1 + float64(len(eligible)+1)/float64(count+1))
			for _, i := range posting {
				if eligible[i] {
					scores[i] += weight
				}
			}
		}
	}
	matches := []match{}
	for position, score := range scores {
		matches = append(matches, match{position, score})
	}
	sort.Slice(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score > matches[j].score
		}
		return d.N(h.documents[matches[i].position].event["sequence"]) > d.N(h.documents[matches[j].position].event["sequence"])
	})
	if cur.Offset > len(matches) {
		return nil, fmt.Errorf("history cursor offset out of range")
	}
	records := []any{}
	next := cur.Offset
	used := 0
	for next < len(matches) && len(records) < limit {
		doc := h.documents[matches[next].position]
		raw, err := a.Store.Read(d.M(doc.event["payload"]))
		if err != nil {
			return nil, err
		}
		record := d.R{"event": doc.event, "original": string(raw), "ref": doc.event["payload"]}
		size := len(d.Bytes(record))
		if used+size > maxBytes {
			if len(records) > 0 {
				break
			}
			delete(record, "original")
			record["original_omitted"] = true
			record["reason"] = "read the ref with memory_read OBJECT; full record exceeds page budget"
			size = len(d.Bytes(record))
			if size > maxBytes {
				break
			}
		}
		used += size
		records = append(records, record)
		next++
	}
	var cursor any
	if next < len(matches) && next > cur.Offset {
		cursor = base64.RawURLEncoding.EncodeToString(d.Bytes(historyCursor{Query: queryHash, Sequence: cur.Sequence, Offset: next, Kind: cur.Kind}))
	}
	return d.R{"records": records, "query": query, "matched_count": len(matches), "omitted_count": len(matches) - cur.Offset - len(records), "limit": limit, "next_cursor": cursor, "snapshot_sequence": cur.Sequence, "index": "derived lexical index; original evidence retains actor, time and scope", "more_possible": next < len(matches), "search_limitations": "Lexical search is not exhaustive semantic recall. A miss does not mean information was never provided; retry entity IDs, names, aliases or read referenced events."}, nil
}
func (a *App) historicalRecall(loop string, covered map[string]bool, budget int) (d.R, error) {
	if len(covered) == 0 || budget < 2000 {
		return nil, nil
	}
	query := ""
	var before int64
	for _, ev := range a.Store.Events() {
		if ev["event_type"] == "input.loaded" && ev["correlation_id"] == loop {
			p, err := a.payload(ev)
			if err != nil {
				return nil, err
			}
			query += " " + d.S(p["text"])
			if before == 0 || d.N(ev["sequence"])-1 < before {
				before = d.N(ev["sequence"]) - 1
			}
		}
	}
	if strings.TrimSpace(query) == "" {
		return nil, nil
	}
	result, err := a.searchHistory(a.ctx, d.R{"query": query, "limit": 12, "event_type": "input.loaded", "before_sequence": before}, nil, budget)
	if err != nil {
		return nil, err
	}
	if len(d.A(result["records"])) == 0 {
		return nil, nil
	}
	return result, nil
}
