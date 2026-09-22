package tui

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

type Client struct {
	base, token string
	http        *http.Client
}
type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("HTTP %d: %s", e.Status, e.Message) }
func NewClient(address, token string) (*Client, error) {
	u, err := url.Parse("http://" + address)
	if err != nil || u.Hostname() != "127.0.0.1" || u.Port() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("TUI requires a 127.0.0.1 host:port")
	}
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("missing local Master token")
	}
	return &Client{u.String(), strings.TrimSpace(token), &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (c *Client) Call(ctx context.Context, path string, body []byte, out any) error {
	method := "GET"
	if body != nil {
		method = "POST"
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (32<<20)+1))
	if err != nil {
		return err
	}
	if len(raw) > 32<<20 {
		return fmt.Errorf("response exceeds terminal page limit")
	}
	if response.StatusCode != 200 {
		var v struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(raw, &v)
		if v.Error == "" {
			v.Error = http.StatusText(response.StatusCode)
		}
		return &HTTPError{response.StatusCode, safe(v.Error)}
	}
	if out == nil {
		var response any
		return json.Unmarshal(raw, &response)
	}
	return json.Unmarshal(raw, out)
}

// Never interpret model text as terminal controls or tview colour/region markup.
func safe(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, s)
}
func pretty(v any) string { b, _ := json.MarshalIndent(v, "", "  "); return safe(string(b)) }
