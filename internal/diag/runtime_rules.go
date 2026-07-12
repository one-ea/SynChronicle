package diag

import (
	"fmt"
	"strings"

	"github.com/one-ea/SynChronicle/internal/store"
)

// 运行时检测阈值。
const (
	repeatCritical           = 8 // 近端重复达到此次数升为 critical
	streamIdleWarn           = 3 // stream_idle 累计告警阈值
	repeatedHostDispatchWarn = 3 // 连续相同 Host 派发结构键告警阈值
)

// RuntimeRuleFunc 是运行时诊断规则的统一签名（对应创作侧的 RuleFunc）。
// 入参是脱敏聚合后的 RuntimeCapture，产出报告型 Finding——全部 AutoNone，
// 只诊断、不产 Action（观察者纪律，见 architecture.md §2.3）。
type RuntimeRuleFunc func(rc *RuntimeCapture) []Finding

var runtimeRules = []RuntimeRuleFunc{
	repeatedErrors,
	stuckStep,
	streamIdleStorm,
	repeatedHostDispatch,
}

// runtimeFindings 跑全部运行时规则。
func runtimeFindings(rc *RuntimeCapture) []Finding {
	var out []Finding
	for _, rule := range runtimeRules {
		out = append(out, rule(rc)...)
	}
	return out
}

// Diagnose 是 /diag 的完整诊断入口：创作诊断 + 运行时信号 + 运行时检测，
// 返回合并后的 Report 与原始 RuntimeCapture（供导出复用，避免重复抓取）。
// 运行时 Finding 仅并入 Findings 供展示，不改 Actions——保持纯观察。
func Diagnose(s *store.Store) (Report, RuntimeCapture) {
	rep := Analyze(s)
	rc := CaptureRuntime(s)
	rep.Findings = append(rep.Findings, runtimeFindings(&rc)...)
	sortFindings(rep.Findings)
	return rep, rc
}

// repeatedErrors 只把"近端反复出现的错误 / 参数无效"判成 Finding。
// 不碰普通工具重复——subagent/novel_context/read_chapter 等在长跑里天然
// 高频，累计次数不是循环信号；真正的"反复而不推进"由 stuckStep 兜住。
func repeatedErrors(rc *RuntimeCapture) []Finding {
	var out []Finding
	for _, r := range rc.Repeats {
		var rule, title, sugg string
		switch {
		case strings.Contains(r.Sig, " · err: "):
			rule = "RepeatedToolError"
			title = "工具反复报同一错误"
			sugg = "近端同一工具反复返回同一错误，多为模型参数不合规或工具契约不符；查 agentcore 工具校验 / prompt 参数约定（参见 #34）。"
		case strings.Contains(r.Sig, "(args invalid)"):
			rule = "ArgsInvalidLoop"
			title = "参数反复无法解析"
			sugg = "模型发来的参数无法解析却不断重试；看 agentcore 是否对该类型做了宽松强转（参见 #34）。"
		default:
			continue // 普通工具重复不产 Finding
		}
		sev := SevWarning
		if r.Count >= repeatCritical {
			sev = SevCritical
		}
		out = append(out, Finding{
			Rule:       rule,
			Category:   CatFlow,
			Severity:   sev,
			Confidence: ConfHigh,
			AutoLevel:  AutoNone,
			Target:     "runtime.flow",
			Title:      title,
			Evidence:   fmt.Sprintf("`%s` ×%d", r.Sig, r.Count),
			Suggestion: sugg,
		})
	}
	return out
}

// stuckStep 检测 checkpoint 连续停在同一 step。
func stuckStep(rc *RuntimeCapture) []Finding {
	if rc.StuckStep == "" {
		return nil
	}
	sev := SevWarning
	if rc.StuckCount >= repeatCritical {
		sev = SevCritical
	}
	return []Finding{{
		Rule:       "StuckStep",
		Category:   CatFlow,
		Severity:   sev,
		Confidence: ConfHigh,
		AutoLevel:  AutoNone,
		Target:     "runtime.flow",
		Title:      "checkpoint 停滞在同一 step",
		Evidence:   fmt.Sprintf("连续停在 `%s` ×%d", rc.StuckStep, rc.StuckCount),
		Suggestion: "同一 step 反复写入而不推进；结合上面的重复签名定位是哪个子代理卡住。",
	}}
}

// streamIdleStorm 检测流式中断频发（#32）。
func streamIdleStorm(rc *RuntimeCapture) []Finding {
	n := rc.LogKinds["stream_idle"]
	if n < streamIdleWarn {
		return nil
	}
	return []Finding{{
		Rule:       "StreamIdleStorm",
		Category:   CatFlow,
		Severity:   SevWarning,
		Confidence: ConfHigh,
		AutoLevel:  AutoNone,
		Target:     "runtime.provider",
		Title:      "流式中断频发（stream_idle）",
		Evidence:   fmt.Sprintf("stream_idle ×%d", n),
		Suggestion: "上游长时间不吐 token 被 watchdog 误杀；慢思考模型调大 streamIdleTimeout，或排查 provider 连接稳定性（参见 #32）。",
	}}
}

// repeatedHostDispatch 检测 coordinator 近端连续生成同一 Agent+Task 的 Host 派发。
func repeatedHostDispatch(rc *RuntimeCapture) []Finding {
	if len(rc.Tail) < repeatedHostDispatchWarn {
		return nil
	}
	last := ""
	count := 0
	for i := len(rc.Tail) - 1; i >= 0; i-- {
		ev := rc.Tail[i]
		if ev.Agent != "coordinator" || ev.Role != "assistant" || !ev.HostDispatch || ev.HostDispatchKey == "" {
			continue
		}
		if last == "" {
			last = ev.HostDispatchKey
			count = 1
			continue
		}
		if ev.HostDispatchKey != last {
			break
		}
		count++
	}
	if count < repeatedHostDispatchWarn {
		return nil
	}
	return []Finding{{
		Rule:       "RepeatedHostDispatch",
		Category:   CatFlow,
		Severity:   SevWarning,
		Confidence: ConfHigh,
		AutoLevel:  AutoNone,
		Target:     "runtime.flow",
		Title:      "Host 重复下达同一流程指令",
		Evidence:   fmt.Sprintf("同一 Host 指令结构键 `%s` 连续出现 ×%d", last, count),
		Suggestion: "检查 Flow Router 指令是否被 Coordinator 执行后仍未推进状态；重点核对对应工具是否写入 progress 和 checkpoint。",
	}}
}
