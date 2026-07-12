package brand

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReleaseBrandContract(t *testing.T) {
	root := filepath.Join("..", "..")
	legacyExecutable := "ai" + "novel-cli"
	tests := []struct {
		path    string
		contain []string
		exclude []string
	}{
		{
			path: ".goreleaser.yml",
			contain: []string{
				"builds:\n  - id: synchronicle",
				"main: ./cmd/synchronicle",
				"binary: synchronicle",
				"archives:\n  - id: synchronicle-archive\n    ids:\n      - synchronicle",
				"owner: one-ea",
				"name: SynChronicle",
			},
			exclude: []string{"cmd/" + legacyExecutable},
		},
		{
			path: "Dockerfile",
			contain: []string{
				"/out/synchronicle",
				`ENTRYPOINT ["synchronicle"]`,
			},
			exclude: []string{"/out/" + legacyExecutable},
		},
		{
			path: "docker-compose.yml",
			contain: []string{
				"synchronicle:",
				"image: ghcr.io/one-ea/synchronicle:latest",
				"./config:/root/.synchronicle",
			},
			exclude: []string{
				"ghcr.io/voocel/" + legacyExecutable,
			},
		},
		{
			path:    filepath.Join(".github", "workflows", "docker.yml"),
			contain: []string{"images: ghcr.io/one-ea/synchronicle"},
		},
		{
			path:    filepath.Join(".github", "scripts", "gen-changelog.sh"),
			contain: []string{"SynChronicle"},
		},
	}

	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(root, test.path))
			if err != nil {
				t.Fatalf("read %s: %v", test.path, err)
			}

			content := string(data)
			for _, want := range test.contain {
				if !strings.Contains(content, want) {
					t.Errorf("%s does not contain %q", test.path, want)
				}
			}
			for _, unwanted := range test.exclude {
				if strings.Contains(content, unwanted) {
					t.Errorf("%s contains legacy value %q", test.path, unwanted)
				}
			}
		})
	}
}

func TestInstallerBrandContract(t *testing.T) {
	path := filepath.Join("..", "..", "scripts", "install.sh")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read installer: %v", err)
	}

	content := string(data)
	for _, want := range []string{
		`REPO="one-ea/SynChronicle"`,
		`BIN="synchronicle"`,
		"SYNCHRONICLE_INSTALL_DIR",
		"SYNCHRONICLE_VERSION",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("installer does not contain %q", want)
		}
	}
	legacyExecutable := "ai" + "novel-cli"
	for _, unwanted := range []string{
		"voocel/" + legacyExecutable,
		"AI" + "NOV" + "EL_",
	} {
		if strings.Contains(content, unwanted) {
			t.Errorf("installer contains legacy value %q", unwanted)
		}
	}
}

func TestDocumentationBrandContract(t *testing.T) {
	path := filepath.Join("..", "..", "README.md")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read README: %v", err)
	}

	content := string(data)
	for _, want := range []string{
		"# SynChronicle\n\n多智能体 AI 长篇创作引擎。SynChronicle 由 Coordinator 驱动 Architect、Writer 与 Editor 协作完成规划、写作、评审和持续演进，把一句创作需求推进为可恢复、可干预的完整长篇作品。",
		"go install github.com/one-ea/SynChronicle/cmd/synchronicle@latest",
		"synchronicle --version",
		"ghcr.io/one-ea/synchronicle:latest",
		"~/.synchronicle",
		"./.synchronicle",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("README does not contain %q", want)
		}
	}

	legacyExecutable := "ai" + "novel-cli"
	for _, unwanted := range []string{
		"github.com/voocel/" + legacyExecutable,
		"voocel/" + legacyExecutable,
		legacyExecutable,
		"ghcr.io/voocel/" + legacyExecutable,
	} {
		if strings.Contains(content, unwanted) {
			t.Errorf("README contains legacy value %q", unwanted)
		}
	}
}

func TestNoUnexpectedLegacyBrandReferences(t *testing.T) {
	root := filepath.Join("..", "..")
	violations, err := scanLegacyBrandReferences(root)
	if err != nil {
		t.Fatalf("scan repository: %v", err)
	}
	if len(violations) > 0 {
		t.Fatalf("unexpected legacy brand references:\n%s", strings.Join(violations, "\n"))
	}
}

func scanLegacyBrandReferences(root string) ([]string, error) {
	legacyExecutable := "ai" + "novel-cli"
	legacyProduct := "ai" + "novel"
	legacyConfig := "AI" + "NOV" + "EL_"
	legacyTerms := []string{
		"github.com/voocel/" + legacyExecutable,
		"ghcr.io/voocel/" + legacyExecutable,
		"cmd/" + legacyExecutable,
		legacyExecutable,
		legacyProduct,
		legacyConfig,
	}

	var violations []string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if relative == ".git" ||
				relative == ".worktrees" ||
				relative == "worktrees" {
				return filepath.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		if isKnownBinaryExtension(relative) {
			return nil
		}
		counts, binary, err := scanFile(path, legacyTerms)
		if err != nil {
			return err
		}
		if binary {
			return nil
		}
		for _, term := range legacyTerms {
			if counts[term] > 0 {
				violations = append(violations, fmt.Sprintf("%s contains %q", relative, term))
			}
		}
		return nil
	})
	return violations, err
}

func isKnownBinaryExtension(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".exe", ".dll", ".so", ".dylib", ".a", ".o", ".bin", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".tar":
		return true
	default:
		return false
	}
}

func scanFile(path string, patterns []string) (map[string]int, bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, false, err
	}
	defer file.Close()

	maxPattern := 1
	for _, pattern := range patterns {
		if len(pattern) > maxPattern {
			maxPattern = len(pattern)
		}
	}
	counts := make(map[string]int, len(patterns))
	buffer := make([]byte, 8<<10)
	var carry []byte
	for {
		n, readErr := file.Read(buffer)
		if n > 0 {
			chunk := buffer[:n]
			if strings.IndexByte(string(chunk), 0) >= 0 {
				return nil, true, nil
			}
			combined := append(append([]byte(nil), carry...), chunk...)
			content := string(combined)
			content = strings.ReplaceAll(content, "github.com/voocel/agentcore", "")
			content = strings.ReplaceAll(content, "github.com/voocel/litellm", "")
			limit := len(combined) - (maxPattern - 1)
			if readErr == io.EOF || limit < 0 {
				limit = 0
			}
			countPatternStarts(counts, content, patterns, limit)
			carry = append(carry[:0], combined[limit:]...)
		}
		if readErr == io.EOF {
			countPatternStarts(counts, string(carry), patterns, len(carry))
			return counts, false, nil
		}
		if readErr != nil {
			return nil, false, readErr
		}
	}
}

func countPatternStarts(counts map[string]int, content string, patterns []string, startLimit int) {
	for _, pattern := range patterns {
		for offset := 0; offset < startLimit; {
			index := strings.Index(content[offset:], pattern)
			if index < 0 || offset+index >= startLimit {
				break
			}
			counts[pattern]++
			offset += index + len(pattern)
		}
	}
}

func TestScanLegacyBrandReferences(t *testing.T) {
	legacyExecutable := "ai" + "novel-cli"
	largeAcrossBoundary := strings.Repeat("x", 8190) + legacyExecutable
	tests := []struct {
		name    string
		path    string
		content []byte
		want    bool
	}{
		{name: "legacy repository", path: "README.txt", content: []byte("github.com/voocel/" + legacyExecutable), want: true},
		{name: "legacy image", path: "compose.txt", content: []byte("ghcr.io/voocel/" + legacyExecutable), want: true},
		{name: "legacy command path", path: "build.txt", content: []byte("cmd/" + legacyExecutable), want: true},
		{name: "legacy executable", path: "usage.txt", content: []byte(legacyExecutable), want: true},
		{name: "historical spec", path: "docs/superpowers/specs/old.md", content: []byte(legacyExecutable), want: true},
		{name: "historical plan", path: "docs/superpowers/plans/old.md", content: []byte(legacyExecutable), want: true},
		{name: "root hidden worktree container", path: ".worktrees/branch/legacy.txt", content: []byte(legacyExecutable)},
		{name: "root worktree container", path: "worktrees/branch/legacy.txt", content: []byte(legacyExecutable)},
		{name: "nested hidden worktrees directory", path: "docs/.worktrees/legacy.txt", content: []byte(legacyExecutable), want: true},
		{name: "scanner source", path: "internal/brand/brand_test.go", content: []byte(legacyExecutable), want: true},
		{name: "task 7 report", path: ".superpowers/sdd/task-7-report.md", content: []byte(legacyExecutable), want: true},
		{name: "task 8 brief", path: ".superpowers/sdd/task-8-brief.md", content: []byte(legacyExecutable), want: true},
		{name: "task 1 brief", path: ".superpowers/sdd/task-1-brief.md", content: []byte(legacyExecutable), want: true},
		{name: "task 6 report", path: ".superpowers/sdd/task-6-report.md", content: []byte(legacyExecutable), want: true},
		{name: "progress scratch", path: ".superpowers/sdd/progress.md", content: []byte(legacyExecutable), want: true},
		{name: "review scratch", path: ".superpowers/sdd/review-old.diff", content: []byte(legacyExecutable), want: true},
		{name: "agentcore upstream", path: "go.mod", content: []byte("github.com/voocel/agentcore"), want: false},
		{name: "litellm upstream", path: "go.mod", content: []byte("github.com/voocel/litellm"), want: false},
		{name: "large text across chunk boundary", path: "large.txt", content: []byte(largeAcrossBoundary), want: true},
		{name: "binary extension", path: "artifact.exe", content: []byte(legacyExecutable)},
		{name: "binary content", path: "artifact", content: append([]byte(strings.Repeat("x", 9000)), append([]byte{0}, []byte(legacyExecutable)...)...)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, filepath.FromSlash(test.path))
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, test.content, 0o644); err != nil {
				t.Fatal(err)
			}

			violations, err := scanLegacyBrandReferences(root)
			if err != nil {
				t.Fatal(err)
			}
			if got := len(violations) > 0; got != test.want {
				t.Fatalf("violations = %v, want violation %v", violations, test.want)
			}
		})
	}
}
