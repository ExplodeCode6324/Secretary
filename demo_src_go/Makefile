.PHONY: build test check run
build:
	go build -o bin/secretary ./cmd/secretary
	go build -o bin/example-report ./programs/report.go
test:
	go test -race ./...
check:
	go vet ./...
run: build
	./scripts/start.sh
