package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	d "secretary_go_demo/internal/domain"
	"secretary_go_demo/internal/engine"
	"secretary_go_demo/internal/model"
	"secretary_go_demo/internal/transport"
	"secretary_go_demo/internal/tui"
	"secretary_go_demo/internal/world"
	"strings"
	"syscall"
	"time"
)

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, "Secretary:", e)
		os.Exit(1)
	}
}
func run() error {
	args := os.Args[1:]
	command := "serve"
	if len(args) > 0 {
		command = args[0]
		args = args[1:]
	}
	c := engine.DefaultConfig()
	config := os.Getenv("SECRETARY_CONFIG")
	if config == "" {
		config = "configs/local.json"
	}
	if b, e := os.ReadFile(config); e == nil {
		if e = d.Decode(b, &c); e != nil {
			return e
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if v := os.Getenv("SECRETARY_DATA_ROOT"); v != "" {
		c.DataRoot = v
	}
	if v := os.Getenv("SECRETARY_WORKSPACE_ROOT"); v != "" {
		c.WorkspaceRoot = v
	}
	if v := os.Getenv("SECRETARY_LISTEN"); v != "" {
		c.Listen = v
	}
	if e := c.Validate(); e != nil {
		return e
	}
	host, _, e := net.SplitHostPort(c.Listen)
	if e != nil || host != "127.0.0.1" {
		return errors.New("demo listens on 127.0.0.1 only")
	}
	if command == "init" {
		if e = os.MkdirAll("configs", 0700); e != nil {
			return e
		}
		if _, e = os.Stat(config); os.IsNotExist(e) {
			b, _ := json.MarshalIndent(c, "", "  ")
			if e = os.WriteFile(config, append(b, '\n'), 0600); e != nil {
				return e
			}
		}
		_, e = transport.Token(c.DataRoot)
		if e != nil {
			return e
		}
		fmt.Println("Local configuration and Master token ready. Set SECRETARY_MAIN_API_KEY, SECRETARY_TASK_API_KEY and SECRETARY_PG_DSN through your private environment.")
		return nil
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if command == "tui" {
		raw, err := os.ReadFile(filepath.Join(c.DataRoot, "master.token"))
		if err != nil {
			return fmt.Errorf("start the local coordinator first: %w", err)
		}
		client, err := tui.NewClient(c.Listen, string(raw))
		if err != nil {
			return err
		}
		return tui.Run(ctx, client)
	}
	var repo *world.Repository
	dsn := os.Getenv("SECRETARY_PG_DSN")
	if dsn != "" {
		repo, e = world.Open(ctx, dsn)
		if e != nil {
			return e
		}
		defer repo.Close()
	}
	if command == "world" {
		if len(args) != 1 || args[0] != "migrate" {
			return errors.New("usage: secretary world migrate")
		}
		if repo == nil {
			return errors.New("SECRETARY_PG_DSN required")
		}
		return repo.Migrate(ctx)
	}
	client, e := model.New(c.Endpoint, os.Getenv("SECRETARY_MAIN_API_KEY"), os.Getenv("SECRETARY_TASK_API_KEY"))
	if e != nil {
		return e
	}
	var worldBackend engine.World
	if repo != nil {
		worldBackend = repo
	}
	app, e := engine.New(c, client, worldBackend)
	if e != nil {
		return e
	}
	defer app.Close()
	switch command {
	case "check-data":
		fmt.Printf("Verified journal, canonical record schemas and referenced objects; sequence=%d\n", app.Store.Sequence())
		return nil
	case "program":
		if len(args) < 2 {
			return errors.New("usage: secretary program import <json> | enable/disable <id>")
		}
		switch args[0] {
		case "import":
			b, e := os.ReadFile(args[1])
			if e != nil {
				return e
			}
			var spec d.R
			if e = d.Decode(b, &spec); e != nil {
				return e
			}
			reg, e := app.ImportProgram(spec)
			if e != nil {
				return e
			}
			fmt.Println(d.S(reg["id"]))
			return nil
		case "enable", "disable":
			return app.EnableProgram(args[1], args[0] == "enable")
		}
		return errors.New("invalid program action")
	case "serve":
		token, e := transport.Token(c.DataRoot)
		if e != nil {
			return e
		}
		handler := (&transport.Server{App: app, Token: token, Host: c.Listen}).Handler()
		server := &http.Server{Addr: c.Listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
		done := make(chan error, 1)
		go func() { done <- server.ListenAndServe() }()
		go app.Run(ctx)
		fmt.Printf("Secretary_go_demo local API: http://%s (interface: secretary tui)\nData: %s\nStop: Ctrl-C (state preserved)\n", c.Listen, filepath.Clean(c.DataRoot))
		select {
		case err := <-done:
			if !errors.Is(err, http.ErrServerClosed) {
				return err
			}
		case <-ctx.Done():
		}
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	default:
		if strings.Contains(command, "help") {
			fmt.Println("secretary tui | init | serve | check-data | world migrate | program import/enable/disable")
			return nil
		}
		return errors.New("unknown command")
	}
}
