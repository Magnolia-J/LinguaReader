/* =========================================================
 * LinguaReader Workspace · 示例书籍数据
 * 文本为公有领域法文原版摘录，仅用于工作台演示。
 * ========================================================= */

const BOOKS = [
  {
    id: "madame-bovary",
    title: "Madame Bovary",
    author: "Gustave Flaubert",
    language: "fr",
    category: "小说",
    publish: { year: 1856, publisher: "Revue de Paris / Michel Lévy" },
    chapters: [
      {
        title: "Partie I · Chapitre 1",
        pages: "p. 1–3",
        paragraphs: [
          "Nous étions à l'étude quand le proviseur entra, suivi d'un nouveau habillé en bourgeois, et d'un garçon de classe qui portait un grand pupitre.",
          "C'était un paysan de la Haute-Normandie, de taille moyenne, de l'âge de douze ans environ, et dont la figure était plate et embarrassée.",
          "Il resta debout près de la porte, si loin qu'on l'eût pris pour un importun, sous l'encadrement verdâtre que la fenêtre dessinait sur son dos.",
          "Son bonnet, de forme ronde, lui donnait un air de paysan placide, et ses sabots épais annonçaient le travail de la terre.",
          "On aurait dit que le collège l'écrasait déjà, avec son silence et ses grandes murailles, comme un champ qu'on enferme."
        ]
      },
      {
        title: "Partie I · Chapitre 2",
        pages: "p. 11–13",
        paragraphs: [
          "Charles était un enfantdocile, qui jouait aux récréations, suivait la classe, dormait dans l'étude, et mangeait bien à la pension.",
          "Son père, Monsieur Bovary, homme de peu de parole, buvait seul le soir, et finissait par s'endormir contre le mur.",
          "Sa mère le gâtait davantage ; elle lui pardonnait ses caprices, lui cousait des chemises, et pleurait en secret sur son sort.",
          "Elle voulait en faire un savant, et commença par l'envoyer au collège, malgré les plaisanteries de son mari."
        ]
      }
    ]
  },
  {
    id: "le-petit-prince",
    title: "Le Petit Prince",
    author: "Antoine de Saint-Exupéry",
    language: "fr",
    category: "童话",
    publish: { year: 1943, publisher: "Éditions Gallimard" },
    chapters: [
      {
        title: "Chapitre 1",
        pages: "p. 3–5",
        paragraphs: [
          "Lorsque j'avais six ans j'avais vu une fois une magnifique image, dans un livre sur la forêt vierge qui s'appelait « Histoires vécues ».",
          "Ça représentait un serpent boa qui avalait un fauve. Voilà la copie du dessin.",
          "Dans le livre on disait : « Les serpents boas avalent leur proie tout entière, sans la mâcher. Ensuite ils ne peuvent plus bouger, et ils dorment pendant les six mois de leur digestion. »",
          "J'ai alors beaucoup réfléchi sur les aventures de la jungle, et, à mon tour, j'ai réussi, avec un crayon de couleur, à tracer mon premier dessin.",
          "Mon dessin numéro 1 était ainsi : un serpent boa qui digère un éléphant. J'ai montré mon chef-d'œuvre aux grandes personnes, et je leur ai demandé si mon dessin leur faisait peur."
        ]
      },
      {
        title: "Chapitre 2",
        pages: "p. 9–11",
        paragraphs: [
          "Le petit prince, qui commença par m'interroger, me dit : « Dessine-moi un mouton… »",
          "Comme j'avais toujours rêvé d'être un aviateur, j'essayai de lui expliquer la mécanique de mon moteur, mais il ne m'écoutait pas.",
          "Les grandes personnes ne comprennent jamais rien toutes seules, et c'est fatigant, pour les enfants, de toujours leur donner des explications.",
          "Mais, pour lui, j'ai dessiné un mouton, car c'était ce qu'il demandait ; et il l'a accepté comme une évidence du monde."
        ]
      }
    ]
  }
];

/* 当前阅读进度（演示）：书名 -> 章节索引 */
const BOOK_PROGRESS = {
  "madame-bovary": 0,
  "le-petit-prince": 0
};
