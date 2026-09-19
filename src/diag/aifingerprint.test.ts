import { describe, expect, it } from "vitest";
import { fingerprintScan, rewriteAmplitude } from "./aifingerprint.js";

const ROBOTIC = "他明白了。他明白了。他明白了。总之，这一切都已经结束。综上所述，他不得不说命运的安排自有深意。总之，他接受了现实。";
const NATURAL = "沈砚推开书局的门，雨声敲着屋檐。灯光昏黄，他忽然想起十年前的雨夜——父亲就是从这扇门走出去，再也没有回来。桌上的茶杯还温着，他却半天没动。";

describe("aifingerprint AI 痕迹自查", () => {
  it("scores robotic text higher than natural prose", () => {
    const robotic = fingerprintScan(ROBOTIC)!;
    const natural = fingerprintScan(NATURAL)!;
    expect(robotic.riskScore).toBeGreaterThan(natural.riskScore);
    expect(robotic.signals.parallelism).toBeGreaterThan(0);
    expect(robotic.signals.summaryCliche).toBeGreaterThan(natural.signals.summaryCliche);
    expect(natural.riskScore).toBeLessThan(50);
  });

  it("returns null for blank text", () => {
    expect(fingerprintScan("   ")).toBeNull();
  });

  it("computes rewrite amplitude with 30 percent compliance line", () => {
    const draft = "沈砚推开门走了进去，屋里很暗。他看了看四周，什么也没说。";
    const final = "沈砚推开书局的木门，门轴发出一声轻响。屋里灯火昏黄，苏晚伏在柜台上睡着了。他站在原地，很久没有出声。";
    const report = rewriteAmplitude(draft, final);
    expect(report.amplitude).toBeGreaterThanOrEqual(0.3);
    expect(report.compliant).toBe(true);
    const same = rewriteAmplitude(draft, draft);
    expect(same.amplitude).toBe(0);
    expect(same.compliant).toBe(false);
  });
});
