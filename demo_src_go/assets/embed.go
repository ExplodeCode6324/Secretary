package assets

import "embed"

//go:embed *.json *.sql
var Files embed.FS
