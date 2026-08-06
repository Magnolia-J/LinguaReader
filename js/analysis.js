/* =========================================================
 * LinguaReader Workspace · AI 分析引擎
 * 负责：类型识别、各模式分析、智能标签推荐。
 *
 * 设计说明：
 *  - 内置 CURATED_ANALYSES 为示例书籍的真实精读样例（联网词典/
 *    LLM 接入前即可演示完整格式）。
 *  - 任意划线走 generateScaffold()，产出与需求设定完全一致的
 *    结构骨架；接入真实 API 后（见 app.callRemoteAnalysis）
 *    可替换为完整分析。
 * ========================================================= */

/* ---------- 1. 类型识别 ---------- */
function detectType(text) {
  const t = (text || "").trim();
  if (!t) return "word";
  const tokens = t.split(/\s+/).filter(Boolean);
  const hasTerminal = /[.?!…。！？]$/.test(t);
  const sentenceCount = (t.match(/[.?!…。！？]/g) || []).length;
  const wordCount = tokens.length;

  if (wordCount <= 1) return "word";                       // A 单词
  if (wordCount <= 4 && sentenceCount === 0) return "phrase"; // B 短语
  if (sentenceCount >= 2 || t.includes("\n") && wordCount > 30) return "paragraph"; // E 段落
  if (hasTerminal || (wordCount > 4 && sentenceCount >= 1)) return "sentence";      // D 句子
  return "expression";                                     // C 固定表达
}

const TYPE_LABEL = {
  word: "A · 单词",
  phrase: "B · 短语",
  expression: "C · 固定表达",
  sentence: "D · 完整句子",
  paragraph: "E · 段落"
};

/* 智能标签全集 */
const ALL_TAGS = [
  "Vocabulary",
  "Sentence Pattern",
  "Native Expression",
  "Beautiful Sentence",
  "Writing Material",
  "Literary Analysis"
];

/* ---------- 2. 内置真实精读样例 ---------- */
const CURATED_ANALYSES = {
  "proviser": {
    mode: "vocabulary", category: "vocabulary", tags: ["Vocabulary"],
    data: {
      word: "proviser",
      defs: [
        { dict: "Le Robert", text: "n.m. — Directeur d'un collège (autrefois). Personne qui pourvoit à l'administration d'un établissement scolaire." },
        { dict: "Larousse", text: "n.m. — (Surtout au Canada) Directeur, proviseur d'un collège ou d'un lycée." }
      ],
      context: "此处指“中学校长”。Flaubert 用‘le proviseur entra’制造一种权威进入的瞬间，教室气氛随之收紧。",
      collocations: ["le proviseur du collège", "entrer suivi du proviseur", "le nouveau et le proviseur"],
      examples: [
        "Le proviseur fit un signe : le silence se fit. （校长示意，全场安静。）",
        "Il fut reçu par le proviseur en personne. （他受到了校长本人的接见。）"
      ],
      learningValue: true
    }
  },
  "importun": {
    mode: "vocabulary", category: "vocabulary", tags: ["Vocabulary", "Literary Analysis"],
    data: {
      word: "importun",
      defs: [
        { dict: "Le Robert", text: "adj. & n. — Qui arrive mal à propos, qui gêne ; personne encombrante ou dérangeante." },
        { dict: "CNRTL", text: "adj. — Qui survient à contretemps ; ennuyeux par sa présence." }
      ],
      context: "‘on l'eût pris pour un importun’——旁观者几乎把他当成‘不速之客 / 碍事的人’。一个词写出新生被孤立、格格不入的处境。",
      collocations: ["un importun", "paraître importun", "être importun à qn"],
      examples: [
        "Ne sois pas importun. （别讨人嫌。）",
        "Il se sentit importun parmi eux. （他觉得自己在他们中间是个多余的人。）"
      ],
      learningValue: true
    }
  },
  "magnifique": {
    mode: "vocabulary", category: "vocabulary", tags: ["Vocabulary", "Beautiful Sentence"],
    data: {
      word: "magnifique",
      defs: [
        { dict: "Le Robert", text: "adj. — Qui émerveille par sa beauté, sa grandeur, son éclat." },
        { dict: "Larousse", text: "adj. — D'une beauté qui inspire l'admiration." }
      ],
      context: "‘une magnifique image’——孩子眼中‘一幅绝美的画’。magnifique 承载了叙述者童年纯粹而热烈的审美惊艳。",
      collocations: ["une magnifique image", "un magnifique paysage", "un magnifique cadeau"],
      examples: [
        "Elle portait une robe magnifique. （她穿着一条华美的裙子。）",
        "C'est un magnifique exemple de courage. （这是勇敢的绝佳例证。）"
      ],
      learningValue: true
    }
  },
  "savant": {
    mode: "vocabulary", category: "vocabulary", tags: ["Vocabulary"],
    data: {
      word: "savant",
      defs: [
        { dict: "Le Robert", text: "adj. & n. — Qui possède beaucoup de connaissances ; (n.m.) personne érudite." },
        { dict: "CNRTL", text: "adj. — Qui a acquis une grande somme de connaissances." }
      ],
      context: "‘Elle voulait en faire un savant’——母亲想把他培养成‘学者’。savant 折射出外省中产对知识与社会晋升的想象。",
      collocations: ["un savant homme", "devenir savant", "un savant fou"],
      examples: [
        "C'est un savant distingué. （他是一位杰出的学者。）",
        "Il fait le savant. （他摆出一副博学样。）"
      ],
      learningValue: false
    }
  },
  "habillé en bourgeois": {
    mode: "phrase", category: "vocabulary", tags: ["Vocabulary"],
    data: {
      word: "habillé en bourgeois",
      defs: [
        { dict: "Le Robert", text: "loc. — Vêtu en homme de la bourgeoisie, par opposition à l'habit de collégien ou de paysan." }
      ],
      context: "‘suivi d'un nouveau habillé en bourgeois’——‘跟着一个穿便装（非校服）的新生’。bourgeois 在此指‘市民/中产打扮’，与寄宿生的制服形成对比，暗示阶级与身份。",
      collocations: ["un homme habillé en bourgeois", "se présenter habillé en bourgeois"],
      examples: [
        "Il arriva habillé en bourgeois, détonnant parmi les uniformes. （他穿着便装到场，在制服中格外扎眼。）"
      ],
      learningValue: true
    }
  },
  "on aurait dit que": {
    mode: "expression", category: "expressions", tags: ["Native Expression", "Sentence Pattern"],
    data: {
      expression: "on aurait dit que",
      meaning: "“人们仿佛觉得…… / 看上去好像……”。条件式过去时 + que 从句，表达一种不确定的、像比喻般的观感。",
      usage: "用于文学性描写，把主观印象包装成‘大家都会这么觉得’的客观画面；比‘il semblait que’更口语、更具代入感。",
      example: "On aurait dit que le collège l'écrasait déjà. （仿佛那所中学已经把他压垮了。）",
      similar: ["il semblait que", "on eût dit que (litt.)", "cela ressemblait à"]
    }
  },
  "dessine-moi un mouton": {
    mode: "expression", category: "expressions", tags: ["Native Expression", "Beautiful Sentence"],
    data: {
      expression: "Dessine-moi un mouton…",
      meaning: "“给我画一只羊……”——祈使句，却承载全书最核心的请求与纯真。",
      usage: "作为《小王子》的钥匙句，它以极简命令式开启一段跨星际的友谊；可作‘以最小请求开启对话’的修辞范式。",
      example: "Dessine-moi un mouton, dit-il simplement. （‘给我画一只羊吧’，他淡淡地说。）",
      similar: ["fais-moi…", "donne-moi… (impératif littéraire)"]
    }
  },
  "nous étions à l'étude quand le proviseur entra, suivi d'un nouveau habillé en bourgeois, et d'un garçon de classe qui portait un grand pupitre.": {
    mode: "sentence", category: "sentencePatterns", tags: ["Sentence Pattern", "Literary Analysis"],
    data: {
      sentence: "Nous étions à l'étude quand le proviseur entra, suivi d'un nouveau habillé en bourgeois, et d'un garçon de classe qui portait un grand pupitre.",
      translation: "我们正在自习，这时校长走了进来，身后跟着一个穿便装的新生，还有一个抱着张大讲桌的班长。",
      structure: [
        "主语：Nous（我们）",
        "谓语：étions（être 的直陈式未完成过去时，复数）",
        "表/补语：à l'étude（在自习）",
        "时间从句：quand le proviseur entra（当校长进来——复合过去时，打断背景）",
        "修饰成分：suivi d'un nouveau…（过去分词短语，修饰 proviseur，表‘被跟随’）",
        "并列定语：et d'un garçon de classe qui portait…（关系从句修饰 garçon）"
      ],
      grammar: "未完成过去时(étions) 铺陈持续背景，复合过去时(entra) 切入一次性事件——经典的‘背景+突发’叙事节奏。过去分词 suivi 作伴随状语，避免重复动词，使长句紧凑。作者以冷静旁观视角开场，不动声色地引入主角。",
      pattern: "Nous étions [背景] quand [人物] entra, suivi de [随从]. → 用‘背景+入场’句式开场，适合人物/场景引入。",
      writingUsage: "写场景开场时，用未完成过去时定调氛围，再用复合过去时让关键人物登场，胜过平铺直叙。"
    }
  },
  "les grandes personnes ne comprennent jamais rien toutes seules, et c'est fatigant, pour les enfants, de toujours leur donner des explications.": {
    mode: "sentence", category: "literary", tags: ["Beautiful Sentence", "Literary Analysis", "Writing Material"],
    data: {
      sentence: "Les grandes personnes ne comprennent jamais rien toutes seules, et c'est fatigant, pour les enfants, de toujours leur donner des explications.",
      translation: "大人们从来什么都自己弄不懂，而对孩子们来说，总得给他们解释个没完，真是累人。",
      structure: [
        "主语：Les grandes personnes",
        "谓语：ne comprennent…rien（否定+直陈式现在时）",
        "状语：jamais / toutes seules",
        "并列句：et c'est fatigant（无人称结构 c'est + adj.）",
        "逻辑主语：de toujours leur donner des explications（de+inf. 作真正主语）",
        "插入语：pour les enfants（对谁而言）"
      ],
      grammar: "用‘ne…rien’绝对否定强化批判语气；‘c'est + adj. + de inf.’是法语高频评价句式，把‘解释大人’的疲惫抽象成普遍真理。反讽口吻奠定全书对成人世界的疏离感。",
      pattern: "X ne [动词] jamais rien toutes seules, et c'est fatigant, pour Y, de… → 用反讽对比‘他者无能’与‘自我负担’，适合议论/抒情。",
      writingUsage: "以‘大人们不懂 / 孩子累’的二元反讽开篇，可迁移到任何‘代际/认知错位’主题的随笔。"
    }
  },
  "j'ai alors beaucoup réfléchi sur les aventures de la jungle": {
    mode: "sentence", category: "sentencePatterns", tags: ["Sentence Pattern"],
    data: {
      sentence: "J'ai alors beaucoup réfléchi sur les aventures de la jungle.",
      translation: "于是我对丛林里的种种奇遇想了很多。",
      structure: [
        "主语：Je",
        "谓语：ai réfléchi（compound past，已完成动作）",
        "状语：alors（于是）/ beaucoup（很多）",
        "补语：sur les aventures de la jungle（关于……）"
      ],
      grammar: "复合过去时叙述已完成的心理活动；réfléchir sur + 名词 表‘对…深思’，比 penser à 更正式、更有重量。",
      pattern: "J'ai beaucoup réfléchi sur [主题]. → 承接前文、引出思考的万能过渡句。",
      writingUsage: "在叙事中插入‘我对…想了很多’，自然完成从事件到内省的转折。"
    }
  }
};

/* ---------- 3. 渲染辅助：把 data 转成 blocks ---------- */
function vocabToBlocks(d) {
  return [
    { title: "Word", html: `<strong>${d.word}</strong>` },
    { title: "Dictionary Definition", html: d.defs.map(x => `<div><b>${x.dict}</b>：${x.text}</div>`).join("") },
    { title: "Context Meaning", html: d.context },
    { title: "Collocations", html: `<ul>${d.collocations.map(c => `<li>${c}</li>`).join("")}</ul>` },
    { title: "Example Sentences", html: `<ul>${d.examples.map(e => `<li>${e}</li>`).join("")}</ul>` },
    { title: "Learning Value", html: d.learningValue ? "✅ <b>值得收藏</b>" : "➖ 可暂不收藏" }
  ];
}
function phraseToBlocks(d) { return vocabToBlocks(d); }
function expressionToBlocks(d) {
  return [
    { title: "Expression", html: `<strong>${d.expression}</strong>` },
    { title: "Meaning", html: d.meaning },
    { title: "Usage", html: d.usage },
    { title: "Example", html: d.example },
    { title: "Similar Expression", html: d.similar ? d.similar.join("；") : "—" }
  ];
}
function sentenceToBlocks(d) {
  return [
    { title: "Original Sentence", html: `<em>${d.sentence}</em>` },
    { title: "Natural Translation", html: d.translation },
    { title: "Sentence Structure", html: `<ul>${d.structure.map(s => `<li>${s}</li>`).join("")}</ul>` },
    { title: "Grammar Explanation", html: d.grammar },
    { title: "Transferable Pattern", html: `<code>${d.pattern}</code>` },
    { title: "Writing Usage", html: d.writingUsage }
  ];
}

/* ---------- 4. 主入口 ---------- */
function analyze(text, ctx) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  const type = detectType(t);
  const key = t.toLowerCase();

  // 命中内置样例
  const hit = CURATED_ANALYSES[t] || CURATED_ANALYSES[key];
  if (hit) {
    const blocks = ({
      vocabulary: vocabToBlocks,
      phrase: phraseToBlocks,
      expression: expressionToBlocks,
      sentence: sentenceToBlocks
    })[hit.mode](hit.data);
    return {
      raw: t, type, typeLabel: TYPE_LABEL[type], mode: hit.mode,
      curated: true, blocks,
      tags: hit.tags, record: hit
    };
  }

  // 未命中：生成结构骨架（演示用，接入 LLM 后替换）
  return generateScaffold(t, type, ctx);
}

/* ---------- 5. 骨架生成（演示 / 待接入 LLM） ---------- */
function generateScaffold(t, type, ctx) {
  const book = (ctx && ctx.bookTitle) ? `来源：《${ctx.bookTitle}》` : "";
  const page = (ctx && ctx.page) ? ` ${ctx.page}` : "";
  const src = book + page;

  let blocks, tags, category, record;

  if (type === "word" || type === "phrase") {
    category = "vocabulary";
    tags = ["Vocabulary"];
    blocks = [
      { title: "Word", html: `<strong>${t}</strong>` },
      { title: "Dictionary Definition", html: `<span class="ai-curated">（接入 Oxford / Cambridge / Le Robert / Larousse 等词典 API 后显示权威释义）</span>` },
      { title: "Context Meaning", html: "（接入 LLM 后生成当前语境释义）" },
      { title: "Collocations", html: "<ul><li>（高频搭配，待生成）</li></ul>" },
      { title: "Example Sentences", html: "<ul><li>（自然例句，待生成）</li></ul>" },
      { title: "Learning Value", html: "（由 AI 判断是否值得收藏）" }
    ];
    record = { mode: "vocabulary", category, tags, data: { word: t, defs: [], context: "", collocations: [], examples: [], learningValue: true } };
  } else if (type === "expression") {
    category = "expressions";
    tags = ["Native Expression"];
    blocks = [
      { title: "Expression", html: `<strong>${t}</strong>` },
      { title: "Meaning", html: "（待生成）" },
      { title: "Usage", html: "（待生成）" },
      { title: "Example", html: "（待生成）" },
      { title: "Similar Expression", html: "（待生成）" }
    ];
    record = { mode: "expression", category, tags, data: { expression: t, meaning: "", usage: "", example: "", similar: [] } };
  } else if (type === "sentence") {
    category = "sentencePatterns";
    tags = ["Sentence Pattern"];
    blocks = [
      { title: "Original Sentence", html: `<em>${t}</em>` },
      { title: "Natural Translation", html: "（接入 LLM 后生成自然译文）" },
      { title: "Sentence Structure", html: "<ul><li>主语 / 谓语 / 宾语 / 修饰 / 从句（待分析）</li></ul>" },
      { title: "Grammar Explanation", html: "（时态 / 从句 / 语态等，待生成）" },
      { title: "Transferable Pattern", html: "<code>（可迁移句型，待提取）</code>" },
      { title: "Writing Usage", html: "（写作迁移建议，待生成）" }
    ];
    record = { mode: "sentence", category, tags, data: { sentence: t, translation: "", structure: [], grammar: "", pattern: "", writingUsage: "" } };
  } else {
    category = "writingMaterials";
    tags = ["Writing Material"];
    blocks = [
      { title: "Paragraph", html: `<em>${t.slice(0, 160)}${t.length > 160 ? "…" : ""}</em>` },
      { title: "Summary & Rhetoric", html: "（段落主旨、修辞与情感效果，待生成）" },
      { title: "Author Style", html: "（作者风格标记，待生成）" }
    ];
    record = { mode: "paragraph", category, tags, data: { text: t } };
  }

  if (src) blocks.push({ title: "Source", html: src, kind: "source" });

  // 主动提醒（表达/句子）
  if (type === "expression" || type === "sentence") {
    blocks.unshift({ title: "reminder", html: "💡 这是值得收藏的表达 / 句型。", kind: "reminder" });
  }

  return {
    raw: t, type, typeLabel: TYPE_LABEL[type], mode: category,
    curated: false, blocks, tags, record
  };
}
