/* =========================================================
 * LinguaReader Workspace · 词形还原（Lemma / Lemmatization）
 * 轻量级、零依赖、纯前端。用于把查询到的词形变化（动词变位、
 * 名词复数等）识别为词典原型，避免同一单词的不同变位在知识库
 * 中产生重复词条。
 *
 * 用法：
 *   const lemma = lemmatize("vais", "fr");   // -> "aller"
 *   const lemma = lemmatize("books", "en");  // -> "book"
 *
 * 语言识别：en/english/英语 -> 英语规则；fr/french/法语 -> 法语
 * 规则 + 不规则表；其它语言（中文等）原样返回。
 *
 * 说明：自动原型识别为「辅助」功能，无法 100% 还原所有词形
 * （尤其法语时态 imparfait 等）；保存时仍会保留 originalForm，
 * 用户可在「设置」中关闭「按原型保存」恢复原始行为。
 * ========================================================= */
(function () {
  "use strict";

  /* 语言归一化 */
  function normLang(lang) {
    if (!lang) return null;
    var l = String(lang).toLowerCase().trim();
    if (l === "en" || l === "english" || l === "英语" || l === "eng") return "en";
    if (l === "fr" || l === "french" || l === "法语" || l === "fre") return "fr";
    return null;
  }

  /* ---------- 不规则词典（小写键 -> 原形小写） ---------- */
  var IRREG_EN = {
    // be
    "am": "be", "is": "be", "are": "be", "was": "be", "were": "be", "been": "be", "being": "be", "'s": "be",
    // have
    "has": "have", "had": "have", "having": "have", "'ve": "have",
    // do
    "does": "do", "did": "do", "done": "do", "doing": "do", "'d": "do",
    // go
    "went": "go", "goes": "go", "gone": "go", "going": "go",
    // get
    "got": "get", "gets": "get", "getting": "get", "gotten": "get",
    // make / take / come / see / eat
    "made": "make", "makes": "make", "making": "make",
    "took": "take", "takes": "take", "taken": "take", "taking": "take",
    "came": "come", "comes": "come", "coming": "come",
    "saw": "see", "sees": "see", "seen": "see", "seeing": "see",
    "ate": "eat", "eats": "eat", "eaten": "eat", "eating": "eat",
    // write / speak / break / choose / drive / fall / fly / forget / give / grow / know / lie / lead / meet / pay / run / say / sit / sing / sink / spend / stand / steal / swim / teach / throw / understand / wake / wear / win
    "wrote": "write", "writes": "write", "written": "write", "writing": "write",
    "spoke": "speak", "speaks": "speak", "spoken": "speak", "speaking": "speak",
    "broke": "break", "broken": "break",
    "chose": "choose", "chosen": "choose",
    "drove": "drive", "driven": "drive", "drove": "drive",
    "fell": "fall", "fallen": "fall",
    "flew": "fly", "flown": "fly",
    "forgot": "forget", "forgotten": "forget", "forgot": "forget",
    "gave": "give", "given": "give",
    "grew": "grow", "grown": "grow",
    "knew": "know", "known": "know",
    "lay": "lie", "lain": "lie", "laid": "lay",
    "led": "lead",
    "met": "meet",
    "paid": "pay",
    "ran": "run", "runs": "run", "running": "run",
    "said": "say", "says": "say",
    "sat": "sit", "sitting": "sit",
    "sang": "sing", "sung": "sing",
    "sank": "sink", "sunk": "sink",
    "spent": "spend",
    "stood": "stand",
    "stole": "steal", "stolen": "steal",
    "swam": "swim", "swum": "swim",
    "taught": "teach",
    "threw": "throw", "thrown": "throw",
    "understood": "understand",
    "woke": "wake", "woken": "wake",
    "wore": "wear", "worn": "wear",
    "won": "win",
    // 名词不规则复数
    "children": "child", "men": "man", "women": "woman", "feet": "foot", "teeth": "tooth",
    "mice": "mouse", "geese": "goose", "people": "person", "oxen": "ox",
    "leaves": "leaf", "wolves": "wolf", "selves": "self", "elves": "elf", "knives": "knife", "lives": "life", "wives": "wife",
    // 形容词比较级/最高级
    "better": "good", "best": "good", "worse": "bad", "worst": "bad",
    "farther": "far", "further": "far"
  };

  /* 法语高频不规则动词（覆盖核心动词全部常见变位） */
  var IRREG_FR = {
    // aller
    "vais": "aller", "vas": "aller", "va": "aller", "allons": "aller", "allez": "aller", "vont": "aller",
    "allais": "aller", "allait": "aller", "allions": "aller", "alliez": "aller", "allaient": "aller",
    "allai": "aller", "allas": "aller", "alla": "aller", "allâmes": "aller", "allâtes": "aller", "allèrent": "aller",
    "aille": "aller", "ailles": "aller", "aillons": "aller", "aillez": "aller", "aillent": "aller",
    "allasse": "aller", "allât": "aller", "allassions": "aller", "allassiez": "aller", "allassent": "aller",
    "allant": "aller",
    // être
    "suis": "être", "es": "être", "est": "être", "sommes": "être", "êtes": "être", "sont": "être",
    "étais": "être", "était": "être", "étions": "être", "étiez": "être", "étaient": "être",
    "fus": "être", "fut": "être", "fûmes": "être", "fûtes": "être", "furent": "être",
    "sois": "être", "soit": "être", "soyons": "être", "soyez": "être", "soient": "être",
    "fusse": "être", "fût": "être", "fussions": "être", "fussiez": "être", "fussent": "être",
    "étant": "être", "été": "être",
    // avoir
    "ai": "avoir", "as": "avoir", "a": "avoir", "avons": "avoir", "avez": "avoir", "ont": "avoir",
    "avais": "avoir", "avait": "avoir", "avions": "avoir", "aviez": "avoir", "avaient": "avoir",
    "eus": "avoir", "eut": "avoir", "eûmes": "avoir", "eûtes": "avoir", "eurent": "avoir",
    "aie": "avoir", "aies": "avoir", "ayons": "avoir", "ayez": "avoir", "aient": "avoir",
    "eusse": "avoir", "eût": "avoir", "eussions": "avoir", "eussiez": "avoir", "eussent": "avoir",
    "ayant": "avoir", "eu": "avoir",
    // faire
    "fais": "faire", "fait": "faire", "faisons": "faire", "faites": "faire", "font": "faire",
    "faisais": "faire", "faisait": "faire", "faisaient": "faire",
    "fis": "faire", "fit": "faire", "fîmes": "faire", "fîtes": "faire", "firent": "faire",
    "fasse": "faire", "fasses": "faire", "fassions": "faire", "fassiez": "faire", "fassent": "faire",
    "fisse": "faire", "fît": "faire", "fissions": "faire", "fissiez": "faire", "fissent": "faire",
    "faisant": "faire",
    // dire
    "dis": "dire", "dit": "dire", "disons": "dire", "dites": "dire", "disent": "dire",
    "disais": "dire", "disait": "dire", "disaient": "dire",
    "dise": "dire", "dises": "dire", "disions": "dire", "disiez": "dire",
    "diss": "dire", "dît": "dire", "dissions": "dire", "dissiez": "dire", "dissent": "dire",
    "disant": "dire",
    // vouloir / pouvoir / savoir / devoir
    "veux": "vouloir", "veut": "vouloir", "voulons": "vouloir", "voulez": "vouloir", "veulent": "vouloir",
    "voudrais": "vouloir", "voudra": "vouloir", "voudront": "vouloir",
    "peux": "pouvoir", "peut": "pouvoir", "pouvons": "pouvoir", "pouvez": "pouvoir", "peuvent": "pouvoir",
    "put": "pouvoir", "purent": "pouvoir", "pu": "pouvoir", "pouvant": "pouvoir",
    "sais": "savoir", "sait": "savoir", "savons": "savoir", "savez": "savoir", "savent": "savoir",
    "sache": "savoir", "saches": "savoir", "sachons": "savoir", "sachez": "savoir", "sachent": "savoir",
    "sus": "savoir", "sût": "savoir", "su": "savoir", "sachant": "savoir",
    "dois": "devoir", "doit": "devoir", "devons": "devoir", "devez": "devoir", "doivent": "devoir",
    "dus": "devoir", "dût": "devoir", "du": "devoir", "devant": "devoir"
  };

  /* ---------- 英语规则还原 ---------- */
  function isConsonant(ch) {
    return "bcdfghjklmnpqrstvwxz".indexOf(ch) >= 0;
  }
  function lemmatizeEn(w) {
    if (IRREG_EN[w]) return IRREG_EN[w];
    // 已是原形（无法判断是否，继续规则尝试）
    // 1. -ies -> y（cities -> city, studies -> study）
    if (/ies$/.test(w)) return w.slice(0, -3) + "y";
    // 2. -ves -> f（leaves -> leaf, knives -> knife）
    if (/ves$/.test(w)) return w.slice(0, -3) + "f";
    // 3. -ing（running -> run, making -> make, stopping -> stop）
    if (/ing$/.test(w)) {
      var s = w.slice(0, -3);
      if (s.length >= 2) {
        var last = s[s.length - 1], prev = s[s.length - 2];
        if (last === prev && isConsonant(last)) return s.slice(0, -1); // 双写还原
        if (last === "e") return s; // 哑音 e 还原（making -> make）
        return s;
      }
      return s;
    }
    // 4. -ed / -d（过去式 / 过去分词）
    if (/ied$/.test(w)) return w.slice(0, -3) + "y"; // tried -> try, studied -> study
    if (/ed$/.test(w)) {
      var s2 = w.slice(0, -2);
      if (s2.length >= 2) {
        var l2 = s2[s2.length - 1], p2 = s2[s2.length - 2];
        if (l2 === p2 && isConsonant(l2)) return s2.slice(0, -1); // 双写还原（stopped -> stop）
        return s2; // 哑音 e 还原（liked -> like）或规则（walked -> walk）
      }
      return s2;
    }
    // 5. -es（boxes -> box, watches -> watch, tomatoes -> tomato）
    if (/((s|sh|ch|x|z|o)es)$/.test(w)) return w.slice(0, -2);
    if (/es$/.test(w)) return w.slice(0, -1);
    // 6. -s（runs -> run, books -> book, cats -> cat）
    if (/(ss|us|is)$/.test(w)) return w; // 不处理（glass, us, is 等）
    if (/s$/.test(w)) return w.slice(0, -1);
    return w;
  }

  /* ---------- 法语规则还原（名词 / 形容词复数为主，动词靠不规则表） ---------- */
  function lemmatizeFr(w) {
    if (IRREG_FR[w]) return IRREG_FR[w];
    // -aux -> -al（animaux -> animal, chevaux -> cheval）
    if (/aux$/.test(w)) return w.slice(0, -3) + "al";
    // 名词 / 形容词复数去 -s（长度足够时；保护少量以 -as/-is/-os/-us/-ès 结尾的单数词，
    // 以及 -ss 避免 grass->glas 之类误伤）。livres/grandes 等正常复数去 -s 还原单数。
    if (/s$/.test(w) && w.length >= 4) {
      if (!/(as|is|os|us|ès|ss)$/.test(w)) {
        return w.slice(0, -1);
      }
    }
    return w;
  }

  /* ---------- 主入口 ---------- */
  function lemmatize(word, language) {
    if (!word) return word;
    var lang = normLang(language);
    if (!lang) return word; // 不支持的语言（中文等）原样返回
    var w = String(word).trim().toLowerCase().replace(/[.,;:!?'"()«»]/g, "");
    if (!w) return word;
    if (lang === "en") return lemmatizeEn(w);
    if (lang === "fr") return lemmatizeFr(w);
    return w;
  }

  // 暴露到全局（浏览器）与模块（Node，便于测试）
  if (typeof window !== "undefined") window.lemmatize = lemmatize;
  if (typeof module !== "undefined" && module.exports) module.exports = { lemmatize: lemmatize };
})();
