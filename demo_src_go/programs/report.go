// A deliberately small independently authored registration example.
// Build this file as an executable; it has no effects beyond JSON stdout.
package main

import (
	"encoding/json"
	"os"
	"time"
)

func main() {
	var args struct {
		Title string `json:"title"`
	}
	if json.NewDecoder(os.Stdin).Decode(&args) != nil || args.Title == "" {
		os.Exit(2)
	}
	json.NewEncoder(os.Stdout).Encode(map[string]any{"title": args.Title, "generated_at": time.Now().UTC().Format(time.RFC3339Nano), "status": "complete"})
}
