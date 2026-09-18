/* 播种演示作品：node scripts/seed-demo.mjs <output_dir> */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dir = process.argv[2] ?? "output/novel";
const pad = (n) => String(n).padStart(2, "0");

const chapters = [
  { title: "潮汐来的那夜", core: "林晚在灯塔发现异常潮汐信号", hook: "信号里藏着一段重复了十七年的坐标", strand: "主线",
    text: "海雾漫上来的时候，林晚正把最后一页观测记录钉进夹板。\n\n灯塔的灯罩起了雾，她用袖口擦了擦，海面在图纸上洇开一小片墨迹。潮位比昨夜高了半米——这不该发生，弦月刚过，潮汐表上写着退。\n\n她盯着那串数字看了很久，不禁皱起了眉。无线电里忽然传来杂音，杂音底下埋着一个坐标，一遍，又一遍。\n\n同一组数字，重复了十七年。她翻出母亲的旧海图，图角上有一行铅笔字，字迹已经被摩挲得发亮。\n\n那是同一个坐标。" },
  { title: "十七年前的锚", core: "旧海图指向沉船与母亲的秘密", hook: "锚身上刻着林晚的名字", strand: "主线",
    text: "派出所的档案室积着灰，林晚借着手电的光翻到第十七卷。\n\n沉船记录只有一页：船名被水渍泡开，落款是一枚褪色的公章。管档案的老人说，那年打捞上来的只有一只锚，后来被镇上的船厂收走了。\n\n船厂早已废弃。锚就立在锈蚀的龙门吊下面，半人高，锚爪上缠着断裂的缆绳。\n\n她凑近了看，锚身内侧刻着一行小字。风把沙吹开的那一刻，她的呼吸停了半拍。\n\n那是她的名字，和她的生辰。" },
  { title: "守灯人", core: "老守灯人认出母亲留下的东西", hook: "他抽屉里锁着同一段坐标电文", strand: "感情",
    text: "老周守灯塔守了四十年，手指关节像被盐水泡过的木头。\n\n他给林晚倒了杯热茶，茶缸边缘磕出一个月牙形的缺口。听见“坐标”两个字的时候，他握缸的手紧了一下，茶水晃出来，烫在桌面上冒起一缕白汽。\n\n“你母亲，当年也问过一样的话。”\n\n他没有再说下去，只是起身去开抽屉。抽屉最里面压着一张电文纸，边角焦黄，字迹却清晰。\n\n林晚认得那串数字。和她记下的一模一样。" },
  { title: "退潮的账", core: "镇上拒绝打捞，账本指向更早的交易", hook: "账本里夹着母亲的照片", strand: "支线",
    text: "镇政府的人把申请表推回来，笔尖在“不予受理”上顿了顿。\n\n“那片海域，十七年前就划走了。”办事员的说法滴水不漏，玻璃窗上映着他领口洗旧的纽扣。\n\n林晚从档案袋里抽出半本手抄账——从旧货市场淘来的，据说出自当年船厂的会计。账目到某一年戛然而止，最后一页夹着一张照片。\n\n照片上是母亲，年轻得让林晚不敢认。母亲身后站着一个人，脸被折痕压掉了。\n\n账本边角有一行小字：余款两清，永不打捞。" },
  { title: "风暴前夜", core: "台风逼近，坐标海域出现灯光", hook: "沉船位置亮起了本不该存在的灯", strand: "主线",
    text: "台风预警挂在镇口的大喇叭上，重复第三遍的时候，风已经能掀动雨棚。\n\n林晚把海图铺在灯塔的工作台上，四角压着咖啡杯。坐标海域在图上只是一个墨点，可今夜，那个墨点亮了。\n\n渔民说是渔火。老周站在她身后，看了很久，缓缓地摇了摇头。\n\n“那地方，十七年没有船敢去。”\n\n灯是白的，一明一灭，像某种应答。林晚抓起了外套。" },
  { title: "出海", core: "林晚与老周冒风暴驶向坐标", hook: "声呐画出船的轮廓，桅杆是新的", strand: "主线",
    text: "浪从船头劈过来，老周的手稳得像舵轮长在了掌心。\n\n雨衣的帽子早被掀掉，林晚的头发贴在脸上，咸得发苦。GPS 在第三个浪头之后失灵，老周关掉屏幕，凭罗盘和岸上仅剩的一线灯火校准航向。\n\n“你母亲当年，也是这条路。”他吼着，声音被风撕成几截。\n\n声呐的绿线扫过海底，勾勒出一个轮廓。船身覆满贝壳，桅杆却直挺挺地立着。\n\n那根桅杆，太新了。" },
  { title: "水下十七年", core: "潜水探沉船，舱内物品与时间矛盾", hook: "舱内日历停在明年", strand: "主线",
    text: "水下的光只有手电的一束，浑浊像一整片流动的灰。\n\n林晚贴着船骸游进货舱，气瓶磕在门框上，发出闷响。舱里的东西摆放得整齐——整齐得不像沉船，倒像有人昨天刚离开。\n\n桌上有一本日历。她用潜水刀撬开被贝壳封住的纸页，手电照上去的那一瞬，她差点咬掉呼吸器。\n\n日历停在明年的一月。\n\n旁边压着一张字条，字迹是母亲的：别找了，回去。" },
];

const completed = chapters.map((_unused, index) => index + 1);
const wordCounts = Object.fromEntries(chapters.map((chapter, index) => [String(index + 1), [...chapter.text.replace(/\s/g, "")].length]));

await mkdir(join(dir, "meta"), { recursive: true });
await mkdir(join(dir, "chapters"), { recursive: true });
await mkdir(join(dir, "summaries"), { recursive: true });
await mkdir(join(dir, "reviews"), { recursive: true });
await mkdir(join(dir, "drafts"), { recursive: true });

await writeFile(join(dir, "meta", "progress.json"), JSON.stringify({
  novel_name: "十七年的坐标", phase: "writing", current_chapter: 8, total_chapters: 12,
  completed_chapters: completed, total_word_count: Object.values(wordCounts).reduce((a, b) => a + b, 0),
  chapter_word_counts: wordCounts, in_progress_chapter: 0, flow: "writing",
  strand_history: ["感情", "支线", "主线", "主线", "主线", "主线", "主线", "主线"], hook_history: chapters.map((chapter) => "悬念"), pending_rewrites: [],
}, null, 2));

await writeFile(join(dir, "meta", "compass.json"), JSON.stringify({
  ending_direction: "林晚揭开十七年前的真相，与母亲和解。", open_threads: ["母亲的旧海图与铅笔字", "锚身上的名字与生辰"],
}));

await writeFile(join(dir, "outline.json"), JSON.stringify(chapters.map((chapter, index) => ({
  chapter: index + 1, title: chapter.title, core_event: chapter.core, hook: chapter.hook, scenes: [],
}))));

for (let index = 0; index < chapters.length; index += 1) {
  const chapter = chapters[index];
  await writeFile(join(dir, "chapters", `${pad(index + 1)}.md`), `# 第${index + 1}章 ${chapter.title}\n\n${chapter.text}`);
  await writeFile(join(dir, "summaries", `${pad(index + 1)}.json`), JSON.stringify({
    chapter: index + 1, summary: chapter.core, characters: ["林晚", "老周"], key_events: [chapter.hook],
  }));
  if (index < 3) {
    await writeFile(join(dir, "reviews", `${pad(index + 1)}.json`), JSON.stringify({
      chapter: index + 1, scope: "chapter", issues: [],
      dimensions: [
        { dimension: "consistency", score: 86 + index, verdict: "accept", comment: "设定自洽" },
        { dimension: "character", score: 84 + index, verdict: "accept", comment: "人物行为合理" },
        { dimension: "pacing", score: 80 + index, verdict: "accept" },
        { dimension: "continuity", score: 82 + index, verdict: "accept" },
        { dimension: "foreshadow", score: 78 + index, verdict: "polish", comment: "伏笔密度可再收紧" },
        { dimension: "hook", score: 88 + index, verdict: "accept", comment: "章末钩子有力" },
        { dimension: "aesthetic", score: 75 + index, verdict: "polish", comment: "部分句式偏模板" },
      ],
      verdict: index === 2 ? "polish" : "accept", summary: index === 2 ? "情绪段落略有堆叠，建议精简。" : "达标，可提交。",
      affected_chapters: [],
    }));
  }
}

console.log(`seeded ${chapters.length} chapters to ${dir}`);
