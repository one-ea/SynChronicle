package brand

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRepositoryIdentity(t *testing.T) {
	root := filepath.Join("..", "..")
	data, err := os.ReadFile(filepath.Join(root, "go.mod"))
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}

	firstLine, _, _ := strings.Cut(string(data), "\n")
	if want := "module github.com/one-ea/SynChronicle"; firstLine != want {
		t.Fatalf("module line = %q, want %q", firstLine, want)
	}

	if _, err := os.Stat(filepath.Join(root, "cmd", "synchronicle", "main.go")); err != nil {
		t.Fatalf("stat cmd/synchronicle/main.go: %v", err)
	}
}
