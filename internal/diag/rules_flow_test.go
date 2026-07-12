package diag

import (
	"strings"
	"testing"

	"github.com/one-ea/SynChronicle/internal/domain"
)

func TestChapterGaps_FindsChapterGapRecoveryHint(t *testing.T) {
	snap := &Snapshot{
		Progress: &domain.Progress{
			Phase:             domain.PhaseWriting,
			Flow:              domain.FlowWriting,
			CompletedChapters: []int{1, 3},
		},
		RunMeta: &domain.RunMeta{},
	}

	findings := ChapterGaps(snap)
	if len(findings) != 1 {
		t.Fatalf("expected 1 finding, got %d: %+v", len(findings), findings)
	}
	f := findings[0]
	if f.Rule != "ChapterGaps" {
		t.Fatalf("rule mismatch: %s", f.Rule)
	}
	if f.Category != CatFlow || f.Severity != SevWarning || f.Confidence != ConfHigh || f.AutoLevel != AutoNone {
		t.Fatalf("unexpected classification: %+v", f)
	}
	if f.Target != "runtime.flow" {
		t.Fatalf("target mismatch: %s", f.Target)
	}
	for _, want := range []string{"missing=[2]", "completed=[1, 3]"} {
		if !strings.Contains(f.Evidence, want) {
			t.Fatalf("evidence %q missing %q", f.Evidence, want)
		}
	}
	for _, want := range []string{"meta/pending_commit.json", "meta/checkpoints.jsonl"} {
		if !strings.Contains(f.Suggestion, want) {
			t.Fatalf("suggestion %q missing %q", f.Suggestion, want)
		}
	}
}

func TestChapterGaps_QuietWithoutGap(t *testing.T) {
	snap := &Snapshot{Progress: &domain.Progress{CompletedChapters: []int{1, 2, 3}}}
	if findings := ChapterGaps(snap); len(findings) != 0 {
		t.Fatalf("expected no findings, got %+v", findings)
	}
}
