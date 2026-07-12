package diag

import (
	"strings"
	"testing"

	"github.com/voocel/agentcore"
)

// TestRuntimeFindings_Classify 证明重复签名按形态分类、阈值升降级正确，
// 且运行时 Finding 全部 AutoNone（观察者纪律：只诊断不产 Action）。
func TestRuntimeFindings_Classify(t *testing.T) {
	rc := RuntimeCapture{
		Repeats: []RepeatStat{
			{Sig: "coordinator · err: InputValidationError", Count: 14}, // 错误循环 critical
			{Sig: "coordinator · subagent", Count: 45},                  // 正常高频工具 → 不产 Finding
			{Sig: "writer · save_plan (args invalid)", Count: 4},        // 参数无效 warning
		},
		StuckStep:  "writing.commit_ch07",
		StuckCount: 9, // 卡住 critical
		LogKinds:   map[string]int{"stream_idle": 4},
		LogErrors:  270, // 长跑累计，不应单独产 Finding
	}

	fs := runtimeFindings(&rc)
	sev := map[string]Severity{}
	for _, f := range fs {
		sev[f.Rule] = f.Severity
		if f.AutoLevel != AutoNone {
			t.Errorf("%s 应为 AutoNone（观察者纪律），got %s", f.Rule, f.AutoLevel)
		}
	}

	want := map[string]Severity{
		"RepeatedToolError": SevCritical,
		"ArgsInvalidLoop":   SevWarning,
		"StuckStep":         SevCritical,
		"StreamIdleStorm":   SevWarning,
	}
	for rule, w := range want {
		if sev[rule] != w {
			t.Errorf("%s: got %q want %q", rule, sev[rule], w)
		}
	}
	// 正常高频工具 / 日志累计 error 不应产 Finding（避免长跑误报）。
	if _, ok := sev["RepeatedToolCall"]; ok {
		t.Error("普通工具重复不应产 Finding")
	}
	if _, ok := sev["LogErrorBurst"]; ok {
		t.Error("日志 error 累计不应单独产 Finding")
	}
}

// TestRuntimeFindings_Quiet 证明无异常信号时不产任何运行时 Finding（零误报）。
func TestRuntimeFindings_Quiet(t *testing.T) {
	rc := RuntimeCapture{
		LogKinds:  map[string]int{"stream_idle": 1}, // 低于阈值
		LogErrors: 2,
	}
	if fs := runtimeFindings(&rc); len(fs) != 0 {
		t.Errorf("安静态不应产 Finding，got %d: %+v", len(fs), fs)
	}
}

func TestRuntimeFindings_RepeatedHostDispatch(t *testing.T) {
	texts := []string{
		"[Host 下达指令]\n下一步：调用 subagent(writer, \"写第 7 章\")\nagent: writer\ntask: \"写第 7 章\"\n理由：续写",
		"[Host 下达指令]\n下一步：调用 subagent(writer, \"写第 7 章\")\nagent: writer\ntask: \"写第 7 章\"\n理由：续写\n（注意：本指令为第 2 次下达——上次派发后路由事实未变化。）",
		"前缀变化\n[Host 下达指令]\n下一步：调用 subagent(writer, \"写第 7 章\")\nagent: writer\ntask: \"写第 7 章\"\n理由：续写\n（注意：本指令为第 3 次下达——上次派发后路由事实未变化。）",
	}
	tail := make([]SkelEvent, 0, len(texts))
	for _, text := range texts {
		tail = append(tail, redactMessage("coordinator", agentcore.Message{
			Role:    agentcore.RoleAssistant,
			Content: []agentcore.ContentBlock{agentcore.TextBlock(text)},
		}))
	}
	if tail[0].TextSha == tail[1].TextSha || tail[1].TextSha == tail[2].TextSha {
		t.Fatalf("test setup expected varied text hashes, got %+v", tail)
	}
	for i, ev := range tail {
		if !ev.HostDispatch || ev.HostDispatchKey == "" {
			t.Fatalf("event %d missing host dispatch key: %+v", i, ev)
		}
		if ev.HostDispatchKey != tail[0].HostDispatchKey {
			t.Fatalf("event %d key mismatch: %q vs %q", i, ev.HostDispatchKey, tail[0].HostDispatchKey)
		}
	}
	rc := RuntimeCapture{
		LogKinds: map[string]int{},
		Tail:     tail,
	}

	findings := runtimeFindings(&rc)
	var got *Finding
	for i := range findings {
		if findings[i].Rule == "RepeatedHostDispatch" {
			got = &findings[i]
			break
		}
	}
	if got == nil {
		t.Fatalf("expected RepeatedHostDispatch, got %+v", findings)
	}
	if got.AutoLevel != AutoNone || got.Category != CatFlow || got.Confidence != ConfHigh {
		t.Fatalf("unexpected classification: %+v", *got)
	}
	if got.Target != "runtime.flow" {
		t.Fatalf("target mismatch: %s", got.Target)
	}
	if !strings.Contains(got.Evidence, tail[0].HostDispatchKey) {
		t.Fatalf("evidence should include host dispatch key %q: %s", tail[0].HostDispatchKey, got.Evidence)
	}
}

func TestRuntimeFindings_RepeatedHostDispatchIgnoresPlainRepeatedText(t *testing.T) {
	repeatedSha := shortHash("coordinator repeated plain text")
	rc := RuntimeCapture{
		LogKinds: map[string]int{},
		Tail: []SkelEvent{
			{Agent: "coordinator", Role: "assistant", TextSha: repeatedSha, Redacted: 1},
			{Agent: "coordinator", Role: "assistant", TextSha: repeatedSha, Redacted: 1},
			{Agent: "coordinator", Role: "assistant", TextSha: repeatedSha, Redacted: 1},
		},
	}

	findings := runtimeFindings(&rc)
	for _, f := range findings {
		if f.Rule == "RepeatedHostDispatch" {
			t.Fatalf("plain repeated text should not produce RepeatedHostDispatch: %+v", findings)
		}
	}
}
