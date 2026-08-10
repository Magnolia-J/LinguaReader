/* =========================================================
 * LinguaReader Workspace · 词形还原（Lemma / Lemmatization）
 * 轻量级、零依赖、纯前端。用于把查询到的词形变化（动词变位、
 * 名词复数等）识别为词典原型，避免同一单词的不同变位在知识库
 * 中产生重复词条。
 *
 * 用法：
 *   const lemma = lemmatize("vais", "fr");   // -> "aller"
 *   const lemma = lemmatize("consentent", "fr"); // -> "consentir"
 *   const lemma = lemmatize("books", "en");  // -> "book"
 *
 * 语言识别：en/english/英语 -> 英语规则；fr/french/法语 -> 法语
 * 规则 + 不规则表 + 逆向变位还原；其它语言（中文等）原样返回。
 *
 * 说明：法语动词变位还原为「辅助」功能。我们采用三层策略：
 *   1) 不规则动词表 IRREG_FR（含 être/avoir/aller 及 -tir/-re/-ir
 *      等家族，由生成器批量构造高频变位）；
 *   2) 逆向变位还原 lemmatizeFrRegular：对常见动词词典 VERB_SET
 *      中的动词，剥离常见变位后缀并还原不定式，仅当还原结果确实
 *      落在动词词典中才采纳（避免把名词误判为动词）；
 *   3) 名词 / 形容词复数去 -s / -aux。
 *   保存时仍会保留 originalForm，用户可在「设置」中关闭「按原型
 *   保存」恢复原始行为。
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

  /* =========================================================
   * 法语不规则动词
   * 为减少手写错误、提高覆盖率，采用「家族生成器」批量构造高频
   * 变位，再并入少量完全显式列出的动词。
   * ========================================================= */

  // 把若干变位形式并入目标表（first-wins：同形优先归属先注册的根动词，
  // 避免 mettre/voir/ouvrir 等共享过去分词的动词被派生词覆盖）
  function addForms(map, inf, forms) {
    if (!Array.isArray(forms)) return;
    for (var i = 0; i < forms.length; i++) {
      if (forms[i] && !map.hasOwnProperty(forms[i])) map[forms[i]] = inf;
    }
  }

  /* -tir / -dormir / -servir 家族：partir, sortir, dormir, sentir,
   * servir, mentir, consentir …（present: Xs/Xs/Xt/Xons/Xez/Xent）
   * stem = 现在时单数去掉词尾 s 的词干（partir→par, dormir→dor,
   * servir→ser, mentir→men, sentir→sen）。3 人称为 stem + "t"。 */
  function genTir(stem, inf) {
    return [
      stem + "s", stem + "s", stem + "t", stem + "tons", stem + "tez", stem + "tent", // présent
      stem + "tais", stem + "tait", stem + "taient", stem + "tions", stem + "tiez",    // imparfait
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",         // futur
      stem + "tis", stem + "tit", stem + "tirent", stem + "tîmes", stem + "tîtes",     // passé simple
      stem + "te", stem + "tes", stem + "tent", stem + "tions", stem + "tiez",         // subjonctif présent
      stem + "t", stem + "tie", stem + "tis", stem + "ties"                            // participe passé
    ];
  }

  /* -ouvrir / -offrir / -souffrir 家族：ouvre/ouvre/ouvre…
   * 过去分词按动词推导：ouvrir→ouvert, offrir→offert, souffrir→souffert … */
  function genOuvrir(base, inf) {
    var pp = inf.slice(0, -3) + "ert";
    return [
      base + "e", base + "es", base + "e", base + "ons", base + "ez", base + "ent",
      base + "ais", base + "ait", base + "aient", base + "ions", base + "iez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      base + "is", base + "it", base + "irent", base + "îmes", base + "îtes",
      base + "e", base + "es", base + "ent", base + "ions", base + "iez",
      pp, pp + "e", pp + "s", pp + "es"
    ];
  }

  /* -mettre 家族：mets/mets/met/mettons… */
  function genMettre(stem, inf) {
    return [
      stem + "s", stem + "s", stem, stem + "tons", stem + "tez", stem + "tent",
      stem + "tais", stem + "tait", stem + "taient", stem + "tions", stem + "tiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "mis", "mit", "mirent", "mîmes", "mîtes",
      stem + "te", stem + "tes", stem + "tent", stem + "tions", stem + "tiez",
      "mis", "mise", "mis", "mises"
    ];
  }

  /* -prendre 家族：prends/prends/prend/prenons… */
  function genPrendre(sing, plur, inf) {
    return [
      sing + "s", sing + "s", sing, plur + "ons", plur + "ez", plur + "nent",
      sing + "ais", sing + "ait", sing + "aient", plur + "ions", plur + "iez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "pris", "prit", "prirent", "prîmes", "prîtes",
      sing + "e", sing + "es", plur + "nent", plur + "ions", plur + "iez",
      "pris", "prise", "pris", "prises"
    ];
  }

  /* -voir */
  function genVoir(inf) {
    return [
      "vois", "vois", "voit", "voyons", "voyez", "voient",
      "voyais", "voyait", "voyaient", "voyions", "voyiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "vis", "vit", "virent", "vîmes", "vîtes",
      "voie", "voies", "voient", "voyions", "voyiez",
      "vu", "vue", "vus", "vues"
    ];
  }
  /* -lire */
  function genLire(inf) {
    return [
      "lis", "lis", "lit", "lisons", "lisez", "lisent",
      "lisais", "lisait", "lisaient", "lisions", "lisiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "lus", "lut", "lurent", "lûmes", "lûtes",
      "lise", "lises", "lisent", "lisions", "lisiez",
      "lu", "lue", "lus", "lues"
    ];
  }
  /* -écrire */
  function genEcrire(inf) {
    return [
      "écris", "écris", "écrit", "écrivons", "écrivez", "écrivent",
      "écrivais", "écrivait", "écrivaient", "écrivions", "écriviez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "écrivis", "écrivit", "écrivirent", "écrivîmes", "écrivîtes",
      "écrive", "écrives", "écrivent", "écrivions", "écriviez",
      "écrit", "écrite", "écrits", "écrites"
    ];
  }
  /* -croire */
  function genCroire(inf) {
    return [
      "crois", "crois", "croit", "croyons", "croyez", "croient",
      "croyais", "croyait", "croyaient", "croyions", "croyiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "crus", "crut", "crurent", "crûmes", "crûtes",
      "croie", "croies", "croient", "croyions", "croyiez",
      "cru", "crue", "crus", "crues"
    ];
  }
  /* -boire */
  function genBoire(inf) {
    return [
      "bois", "bois", "boit", "buvons", "buvez", "boivent",
      "buvais", "buvait", "buvaient", "buvions", "buviez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "bus", "but", "burent", "bûmes", "bûtes",
      "boive", "boives", "boivent", "buvions", "buviez",
      "bu", "bue", "bus", "bues"
    ];
  }
  /* -conduire */
  function genConduire(inf) {
    return [
      "conduis", "conduis", "conduit", "conduisons", "conduisez", "conduisent",
      "conduisais", "conduisait", "conduisaient", "conduisions", "conduisiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "conduisis", "conduisit", "conduisirent", "conduisîmes", "conduisîtes",
      "conduise", "conduises", "conduisent", "conduisions", "conduisiez",
      "conduit", "conduite", "conduits", "conduites"
    ];
  }
  /* -naître */
  function genNaitre(inf) {
    var s = inf.replace(/naître$/, "naiss");
    return [
      "nais", "nais", "naît", s + "ons", s + "ez", s + "ent",
      "naissais", "naissait", "naissaient", "naissions", "naissiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "naquis", "naquit", "naquirent", "naquîmes", "naquîtes",
      "naisse", "naisses", "naissent", "naissions", "naissiez",
      "né", "née", "nés", "nées"
    ];
  }
  /* -mourir */
  function genMourir(inf) {
    return [
      "meurs", "meurs", "meurt", "mourons", "mourez", "meurent",
      "mourais", "mourait", "mouraient", "mourions", "mouriez",
      "mourrai", "mourras", "mourra", "mourrons", "mourrez", "mourront",
      "mourus", "mourut", "moururent", "mourûmes", "mourûtes",
      "meure", "meures", "meurent", "mourions", "mouriez",
      "mourant",
      "mort", "morte", "morts", "mortes"
    ];
  }
  /* -venir / -tenir */
  function genVenir(inf) {
    var stem = inf.replace(/(venir|tenir)$/, "");
    var presSing = (inf === "tenir") ? ["tiens", "tiens", "tient"] : ["viens", "viens", "vient"];
    var presPlur = stem + "enons", presPlur2 = stem + "enez", presPlur3 = stem + "iennent";
    return [
      presSing[0], presSing[1], presSing[2], presPlur, presPlur2, presPlur3,
      stem + "enais", stem + "enait", stem + "enaient", stem + "enions", stem + "eniez",
      stem + "iendrai", stem + "iendras", stem + "iendra", stem + "iendrons", stem + "iendrez", stem + "iendront",
      stem + "ins", stem + "int", stem + "inrent", stem + "înmes", stem + "întes",
      stem + "ienne", stem + "iennes", stem + "iennent", stem + "enions", stem + "eniez",
      "venu", "venue", "venus", "venues"
    ];
  }
  /* -connaître 家族：connais/connais/connaît… pp connu */
  function genConnaitre(inf) {
    var s = inf.replace(/aître$/, "aiss");
    return [
      "connais", "connais", "connaît", s + "ons", s + "ez", s + "ent",
      "connaissais", "connaissait", "connaissaient", "connaissions", "connaissiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "connus", "connut", "connurent", "connûmes", "connûtes",
      "connaisse", "connaisses", "connaissent", "connaissions", "connaissiez",
      "connu", "connue", "connus", "connues"
    ];
  }
  /* -paraître 家族：parus/parut… pp paru */
  function genParaitre(inf) {
    var s = inf.replace(/aître$/, "aiss");
    return [
      "pars", "pars", "paraît", s + "ons", s + "ez", s + "ent",
      "paraissais", "paraissait", "paraissaient", "paraissions", "paraissiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "parus", "parut", "parurent", "parûmes", "parûtes",
      "paraisse", "paraisses", "paraissent", "paraissions", "paraissiez",
      "paru", "parue", "parus", "parues"
    ];
  }
  /* -rire / -sourire */
  function genRire(inf) {
    var s = inf.replace(/rire$/, "r");
    return [
      "ris", "ris", "rit", s + "ions", s + "iez", s + "ient",
      "riais", "riait", "riaient", "riions", "riiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "ris", "rit", "rirent", "rîmes", "rîtes",
      "rie", "ries", "rient", "riions", "riiez",
      "ri", "rie", "ris", "ries"
    ];
  }
  /* -courir */
  function genCourir(inf) {
    return [
      "cours", "cours", "court", "courons", "courez", "courent",
      "courais", "courait", "couraient", "courions", "couriez",
      "courrai", "courras", "courra", "courrons", "courrez", "courront",
      "courus", "courut", "coururent", "courûmes", "courûtes",
      "coure", "coures", "courent", "courions", "couriez",
      "couru", "courue", "courus", "courues"
    ];
  }
  /* -fuir */
  function genFuir(inf) {
    return [
      "fuis", "fuis", "fuit", "fuyons", "fuyez", "fuient",
      "fuyais", "fuyait", "fuyaient", "fuyions", "fuyiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "fuis", "fuit", "fuirent", "fuîmes", "fuîtes",
      "fuie", "fuies", "fuient", "fuyions", "fuyiez",
      "fui", "fuie", "fuis", "fuies"
    ];
  }
  /* -vouloir */
  function genVouloir(inf) {
    return [
      "veux", "veux", "veut", "voulons", "voulez", "veulent",
      "voulais", "voulait", "voulaient", "voulions", "vouliez",
      "voudrai", "voudras", "voudra", "voudrons", "voudrez", "voudront",
      "voulus", "voulut", "voulurent", "voulûmes", "voulûtes",
      "veuille", "veuilles", "veuillent", "voulions", "vouliez",
      "voulu", "voulue", "voulus", "voulues"
    ];
  }
  /* -pouvoir */
  function genPouvoir(inf) {
    return [
      "peux", "peux", "peut", "pouvons", "pouvez", "peuvent",
      "pouvais", "pouvait", "pouvaient", "pouvions", "pouviez",
      "pourrai", "pourras", "pourra", "pourrons", "pourrez", "pourront",
      "pus", "put", "purent", "pûmes", "pûtes",
      "puisse", "puisses", "puissent", "pussions", "pussiez",
      "pu", "pue", "pus", "pues"
    ];
  }
  /* -savoir */
  function genSavoir(inf) {
    return [
      "sais", "sais", "sait", "savons", "savez", "savent",
      "savais", "savait", "savaient", "savions", "saviez",
      "saurai", "sauras", "saura", "saurons", "saurez", "sauront",
      "sus", "sut", "surent", "sûmes", "sûtes",
      "sache", "saches", "sachent", "sachions", "sachiez",
      "su", "sue", "sus", "sues"
    ];
  }
  /* -devoir */
  function genDevoir(inf) {
    return [
      "dois", "dois", "doit", "devons", "devez", "doivent",
      "devais", "devait", "devaient", "devions", "deviez",
      "devrai", "devras", "devra", "devrons", "devrez", "devront",
      "dus", "dut", "durent", "dûmes", "dûtes",
      "doive", "doives", "doivent", "devions", "deviez",
      "dû", "due", "dus", "dues"
    ];
  }
  /* -falloir */
  function genFalloir(inf) {
    return ["faut", "fallu", "fallue", "fallus", "fallues"];
  }
  /* -valoir */
  function genValoir(inf) {
    return [
      "vaux", "vaux", "vaut", "valons", "valez", "valent",
      "valais", "valait", "valaient", "valions", "valiez",
      "vaudrai", "vaudras", "vaudra", "vaudrons", "vaudrez", "vaudront",
      "valus", "valut", "valurent", "valûmes", "valûtes",
      "vaille", "vailles", "vaillent", "valions", "valiez",
      "valu", "valus", "valus", "valus"
    ];
  }
  /* -plaire */
  function genPlaire(inf) {
    return [
      "plais", "plais", "plaît", "plaisons", "plaisez", "plaisent",
      "plaisais", "plaisait", "plaisaient", "plaisions", "plaisiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "plus", "plut", "plurent", "plûmes", "plûtes",
      "plaise", "plaises", "plaisent", "plaisions", "plaisiez",
      "plu", "plue", "plus", "plues"
    ];
  }
  /* -taire */
  function genTaire(inf) {
    return [
      "tais", "tais", "tait", "taisons", "taisez", "taisent",
      "taisais", "taisait", "taisaient", "taisions", "taisiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      "tus", "tut", "turent", "tûmes", "tûtes",
      "taise", "taises", "taisent", "taisions", "taisiez",
      "tu", "tue", "tus", "tues"
    ];
  }
  /* -battre */
  function genBattre(inf) {
    var s = inf.replace(/battre$/, "batt");
    return [
      s + "s", s + "s", s, s + "ons", s + "ez", s + "ent",
      s + "ais", s + "ait", s + "aient", s + "ions", s + "iez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      s + "is", s + "it", s + "irent", s + "îmes", s + "îtes",
      s + "e", s + "es", s + "ent", s + "ions", s + "iez",
      "battu", "battue", "battus", "battues"
    ];
  }
  /* -asseoir（近似） */
  function genAsseoir(inf) {
    return [
      "assieds", "assieds", "assied", "asseyons", "asseyez", "asseyent",
      "asseyais", "asseyait", "asseyaient", "asseyions", "asseyiez",
      "assoirai", "assoiras", "assoira", "assoirons", "assoirez", "assoiront",
      "assis", "assit", "assirent", "assîmes", "assîtes",
      "asseye", "asseyes", "asseyent", "asseyions", "asseyiez",
      "assis", "assise", "assis", "assises"
    ];
  }
  /* -vaincre / -convaincre */
  function genVaincre(inf) {
    var s = inf.replace(/e$/, "");
    return [
      s + "c", s + "c", s, s + "quons", s + "quez", s + "quent",
      s + "quais", s + "quit", s + "quaient", s + "quions", s + "quiez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      s + "quis", s + "quit", s + "quirent", s + "quîmes", s + "quîtes",
      s + "que", s + "ques", s + "quent", s + "quions", s + "quiez",
      "vaincu", "vaincue", "vaincus", "vaincues"
    ];
  }
  /* -craindre / -peindre / -joindre / -plaindre 家族 */
  function genCraindre(inf) {
    var s = inf.replace(/dre$/, ""); // craign
    return [
      s + "s", s + "s", s, s + "ons", s + "ez", s + "ent",
      s + "ais", s + "ait", s + "aient", s + "ions", s + "iez",
      inf + "ai", inf + "as", inf + "a", inf + "ons", inf + "ez", inf + "ont",
      s + "is", s + "it", s + "irent", s + "îmes", s + "îtes",
      s + "e", s + "es", s + "ent", s + "ions", s + "iez",
      s + "t", s + "te", s + "ts", s + "tes"
    ];
  }

  /* 聚合所有不规则动词 */
  function buildIrregFr() {
    var m = {};
    // —— 完全显式列出的核心动词（已有的高频 9 族）——
    var CORE = {
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
      "disant": "dire"
    };
    var pairs = [
      ["être", CORE],
      // -re 规则动词显式（imparfait/futur 形似 -er，逆向还原会失败，需显式）
      ["prétendre", ["prétends","prétend","prétendent","prétendons","prétendez","prétendais","prétendait","prétendaient","prétendrai","prétendras","prétendra","prétendrons","prétendrez","prétendront","prétendit","prétendirent","prétende","prétendes","prétendent","prétendu","prétendue","prétendus","prétendues","prétendant"]],
      // -tir 家族
      ["partir", genTir("par", "partir")],
      ["démentir", genTir("démen", "démentir")],
      ["sortir", genTir("sor", "sortir")],
      ["dormir", genTir("dor", "dormir")],
      ["servir", genTir("ser", "servir")],
      ["mentir", genTir("men", "mentir")],
      ["sentir", genTir("sen", "sentir")],
      ["consentir", genTir("consen", "consentir")],
      ["ressentir", genTir("ressen", "ressentir")],
      ["pressentir", genTir("pressen", "pressentir")],
      // -ouvrir 家族
      ["ouvrir", genOuvrir("ouvr", "ouvrir")],
      ["offrir", genOuvrir("offr", "offrir")],
      ["souffrir", genOuvrir("souffr", "souffrir")],
      ["couvrir", genOuvrir("couvr", "couvrir")],
      ["découvrir", genOuvrir("découvr", "découvrir")],
      ["recouvrir", genOuvrir("recouvr", "recouvrir")],
      // -mettre 家族
      ["mettre", genMettre("met", "mettre")],
      ["remettre", genMettre("remet", "remettre")],
      ["promettre", genMettre("promet", "promettre")],
      ["permettre", genMettre("permet", "permettre")],
      ["transmettre", genMettre("transmet", "transmettre")],
      // -prendre 家族
      ["prendre", genPrendre("prend", "pren", "prendre")],
      ["comprendre", genPrendre("comprend", "compren", "comprendre")],
      ["surprendre", genPrendre("surprend", "surpren", "surprendre")],
      ["apprendre", genPrendre("apprend", "appren", "apprendre")],
      ["entreprendre", genPrendre("entreprend", "entreprend", "entreprendre")],
      // 其它不规则
      ["voir", genVoir("voir")],
      ["pourvoir", genVoir("pourvoir")],
      ["prévoir", genVoir("prévoir")],
      ["lire", genLire("lire")],
      ["élire", genLire("élire")],
      ["écrire", genEcrire("écrire")],
      ["décrire", genEcrire("décrire")],
      ["inscrire", genEcrire("inscrire")],
      ["prescrire", genEcrire("prescrire")],
      ["croire", genCroire("croire")],
      ["boire", genBoire("boire")],
      ["conduire", genConduire("conduire")],
      ["produire", genConduire("produire")],
      ["réduire", genConduire("réduire")],
      ["traduire", genConduire("traduire")],
      ["naître", genNaitre("naître")],
      ["renaître", genNaitre("renaître")],
      ["mourir", genMourir("mourir")],
      ["venir", genVenir("venir")],
      ["tenir", genVenir("tenir")],
      ["revenir", genVenir("revenir")],
      ["devenir", genVenir("devenir")],
      ["soutenir", genVenir("soutenir")],
      ["obtenir", genVenir("obtenir")],
      ["maintenir", genVenir("maintenir")],
      ["contenir", genVenir("contenir")],
      ["connaître", genConnaitre("connaître")],
      ["reconnaître", genConnaitre("reconnaître")],
      ["paraître", genParaitre("paraître")],
      ["apparaître", genParaitre("apparaître")],
      ["disparaître", genParaitre("disparaître")],
      ["rire", genRire("rire")],
      ["sourire", genRire("sourire")],
      ["courir", genCourir("courir")],
      ["fuir", genFuir("fuir")],
      ["vouloir", genVouloir("vouloir")],
      ["pouvoir", genPouvoir("pouvoir")],
      ["savoir", genSavoir("savoir")],
      ["devoir", genDevoir("devoir")],
      ["falloir", genFalloir("falloir")],
      ["valoir", genValoir("valoir")],
      ["équivaloir", genValoir("équivaloir")],
      ["plaire", genPlaire("plaire")],
      ["taire", genTaire("taire")],
      ["battre", genBattre("battre")],
      ["abattre", genBattre("abattre")],
      ["combattre", genBattre("combattre")],
      ["asseoir", genAsseoir("asseoir")],
      ["vaincre", genVaincre("vaincre")],
      ["convaincre", genVaincre("convaincre")],
      ["craindre", genCraindre("craindre")],
      ["peindre", genCraindre("peindre")],
      ["joindre", genCraindre("joindre")],
      ["plaindre", genCraindre("plaindre")],
      ["atteindre", genCraindre("atteindre")],
      ["éteindre", genCraindre("éteindre")],
      ["craindre", genCraindre("craindre")]
    ];
    // 先把 CORE 直接对象并入
    Object.keys(CORE).forEach(function (k) { m[k] = CORE[k]; });
    pairs.forEach(function (p) {
      if (p[0] === "être") return; // 已在 CORE
      addForms(m, p[0], p[1]);
    });
    return m;
  }

  var IRREG_FR = buildIrregFr();

  /* =========================================================
   * 常见法语动词词典（用于逆向变位还原的合法性校验）。
   * 仅当还原出的不定式落在集合内才采纳，避免名词被误判为动词。
   * ========================================================= */
  var COMMON_FR_VERBS = (
    "aimer,parler,donner,regarder,trouver,penser,rester,passer,porter,sembler,continuer," +
    "commencer,manger,aider,appeler,jeter,acheter,lever,geler,modeler,peler,essayer,envoyer,nettoyer,payer,balayer,étudier,marier,céder,posséder," +
    "travailler,chercher,montrer,occupier,rencontrer,retrouver,retenir,obtenir,devenir," +
    "demander,répondre,entendre,attendre,perdre,vendre,rendre,prendre,comprendre,apprendre," +
    "lire,écrire,descendre,defendre,étendre,confondre,répondre,fondre,mordre,tordre," +
    "finir,choisir,réfléchir,réussir,agir,rougir,jour,venir,tenir," +
    "peigner,flotter,détacher,revendiquer,aliéner,changer,nager," +
    "écouter,parcourir,courir,mourir,ouvrir,offrir,souffrir,partir,sortir,dormir,sentir,servir,mentir,consentir," +
    "vivre,suivre,voir,boire,croire,conduire,naître,connaître,paraître,rire,courir,fuir," +
    "vouloir,pouvoir,savoir,devoir,falloir,valoir,plaire,taire,battre,asseoir,vaincre,craindre,peindre,joindre,plaindre," +
    "pouvoir,falloir,valoir,plaire,taire,faire,dire,être,avoir,aller," +
    "désirer,espérer,préférer,espérer,régner,créer,prier,lier,crier,crier,varier," +
    "marier,pénétrer,opérer,déclarer,négliger,exiger,protéger,inquiéter,priver," +
    "étonner,émerveiller,effrayer,ennuyer,choyer,balayer,célébrer,promener,enlever,amener,emmener," +
    "obliger,partager,soulager,charger,loger,corriger,nourrir,punir,réunir," +
    "bâtir,guérir,rémunérer,établir,accomplir,remplir,rendre,perdre,vendre,attendre,entendre,défendre,prétendre,étendre,mordre," +
    "compter,monter,noter,chanter,constater,former,rassembler,considérer,détester,écarter," +
    "pleurer,rire,sourire,taire,voir,croire,boire,conduire,produire,réduire,traduire,décrire,inscrire,prescrire," +
    "reconnaître,disparaître,apparaître,renaître,mourir,devenir,revenir,soutenir,obtenir,maintenir,contenir," +
    "couvrir,découvrir,recouvrir,offrir,souffrir,ouvrir,admettre,permettre,promettre,remettre,transmettre,mettre," +
    "craindre,peindre,joindre,plaindre,atteindre,éteindre,vaincre,convaincre,battre,abattre,combattre," +
    "vouloir,pouvoir,savoir,devoir,falloir,valoir,équivaloir,plaire,taire," +
    "paraître,connaître,rire,sourire,courir,fuir,voir,boire,croire,conduire,naître,mourir,venir,tenir," +
    "consentir,ressentir,pressentir,servir,sentir,mentir,dormir,sortir,partir,consentir," +
    "falloir,valoir,plaire,taire,vouloir,pouvoir,savoir,devoir,être,avoir,aller,faire,dire"
  ).split(",").filter(Boolean);

  // 归一化（去变音符号、ç→c、œ→oe）用于词典匹配
  function normFr(s) {
    return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/ç/g, "c").replace(/œ/g, "oe").replace(/æ/g, "ae");
  }
  var VERB_SET_NORM = {};
  var NORM2CANON = {};
  COMMON_FR_VERBS.forEach(function (v) {
    var n = normFr(v);
    VERB_SET_NORM[n] = true;
    if (!NORM2CANON[n]) NORM2CANON[n] = v;
  });
  // 不规则动词的原形也并入词典（便于校验）
  Object.keys(IRREG_FR).forEach(function (k) {
    var inf = IRREG_FR[k];
    var n = normFr(inf);
    VERB_SET_NORM[n] = true;
    if (!NORM2CANON[n]) NORM2CANON[n] = inf;
  });

  /* 合法变位后缀（不含与名词高度重合的 -e / -es / -s，避免名词误判）。
   * 越长越优先剥离。 */
  var FR_SUFFIXES = {
    er: ["aient", "assions", "assiez", "assent", "èrent", "erais", "erons", "erez", "erai", "eras", "era", "ions", "iez", "ais", "ait", "ont", "ai", "as", "a", "ez", "ons", "é", "ée", "és", "ées", "ant", "rait", "rais", "ent", "es", "e", "ât", "âmes", "âtes", "asse", "asses"],
    ir: ["issent", "issons", "issez", "issais", "issait", "issaient", "isses", "isse", "ît", "irent", "îmes", "îtes", "irai", "iras", "ira", "irons", "irez", "iront", "issant", "i", "ie", "is", "ies", "ions", "iez", "it"],
    re: ["issent", "issons", "issez", "issais", "issait", "issaient", "isses", "isse", "ît", "irent", "îmes", "îtes", "aient", "ais", "ait", "ont", "rai", "ra", "ras", "rons", "rez", "ront", "is", "it", "ai", "as", "a", "ez", "ons", "t", "u", "ue", "us", "ues", "ions", "iez", "ent", "rait", "rais"]
  };
  // 排序：长后缀优先
  Object.keys(FR_SUFFIXES).forEach(function (g) {
    FR_SUFFIXES[g].sort(function (a, b) { return b.length - a.length; });
  });
  var FR_ENDING = { er: "er", ir: "ir", re: "re" };

  /* 逆向变位还原（仅当还原结果落在动词词典）
   * cand1 = 词干 + 不定式尾（er/ir/re）；cand2 = 词干本身（未来时等词干
   * 已是原形的情况，如 parleront -> parl）。两者都需落在动词词典，避免
   * 把名词误判为动词。对 manger/commencer 等词干保留 e 的动词，离线还原
   * 会失败（返回原形），由 AI lemma 路径兜底。 */
  function lemmatizeFrRegular(w) {
    for (var g in FR_SUFFIXES) {
      if (!FR_SUFFIXES.hasOwnProperty(g)) continue;
      var suffixes = FR_SUFFIXES[g];
      for (var i = 0; i < suffixes.length; i++) {
        var suf = suffixes[i];
        if (w.length > suf.length + 1 && w.slice(-suf.length) === suf) {
          var stem = w.slice(0, -suf.length);
          var cand1 = stem + FR_ENDING[g];
          var cn1 = normFr(cand1);
          if (VERB_SET_NORM[cn1] && NORM2CANON[cn1]) return NORM2CANON[cn1];
          var cn2 = normFr(stem);
          if (VERB_SET_NORM[cn2] && NORM2CANON[cn2]) return NORM2CANON[cn2];
        }
      }
    }
    return null;
  }

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

  /* ---------- 法语规则还原（不规则表 + 逆向变位 + 名词复数） ---------- */
  function lemmatizeFr(w) {
    if (IRREG_FR[w]) return IRREG_FR[w];
    // 逆向变位还原（动词）
    var reg = lemmatizeFrRegular(w);
    if (reg) return reg;
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
  if (typeof window !== "undefined") {
    window.lemmatize = lemmatize;
    window.lemmatizeFr = lemmatizeFr;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { lemmatize: lemmatize, lemmatizeFr: lemmatizeFr, IRREG_FR: IRREG_FR };
  }
})();
