/** Sentiment 도구 — AFINN 어휘 기반 감성 분석. */

import { Tool } from "./base.js";
import type { JsonSchema } from "./types.js";

// AFINN-165 축약 사전 (상위 200개 + 주요 감성어)
const AFINN: Record<string, number> = {
  abandon:-2,abandoned:-2,abuse:-3,abused:-3,accept:1,accepted:1,accomplish:2,accomplished:2,
  achievement:2,adore:3,adorable:3,advantage:2,adventure:2,afraid:-2,aggravate:-2,aggressive:-2,
  agree:1,amazing:4,anger:-3,angry:-3,annoy:-2,annoyed:-2,annoying:-2,anxious:-2,apologize:-1,
  appreciate:2,approval:2,approve:2,arrogant:-2,ashamed:-2,assault:-3,attract:1,attractive:2,
  awesome:4,awful:-3,bad:-3,ban:-2,bankrupt:-3,battle:-1,beaten:-2,beautiful:3,benefit:2,
  best:3,betray:-3,better:2,bias:-1,bitter:-2,blame:-2,bless:2,blessing:3,block:-1,bold:2,
  bore:-2,bored:-2,boring:-3,brave:2,break:-1,breakthrough:3,brilliant:4,broken:-2,
  calm:2,cancel:-1,capable:1,care:2,careful:2,careless:-2,celebrate:3,charm:3,cheat:-3,
  cheerful:2,clash:-2,clean:2,clever:2,collapse:-2,comfort:2,complain:-2,confident:2,
  confuse:-2,congratulate:2,conquer:2,content:2,cool:1,corrupt:-3,courage:2,crash:-2,
  crazy:-2,creative:2,crisis:-3,critical:-2,cruel:-3,crush:-1,cry:-1,cure:2,curious:1,
  damage:-3,danger:-2,dangerous:-3,dead:-3,death:-3,deceive:-3,defeat:-2,defend:2,
  delight:3,deny:-2,depress:-2,depressed:-2,deserve:2,desire:1,despair:-3,destroy:-3,
  determined:2,devastate:-3,difficult:-1,dirty:-2,disable:-2,disappoint:-2,disaster:-3,
  dislike:-2,dismiss:-2,disturb:-2,doubt:-1,dream:1,dull:-2,dumb:-3,eager:2,ease:2,
  easy:1,effective:2,efficient:2,elegant:2,embarrass:-2,emergency:-2,empower:2,
  encourage:2,enemy:-2,energetic:2,enjoy:2,enormous:1,enrage:-3,enthusiastic:3,
  error:-2,evil:-3,excellent:3,excite:3,excited:3,exciting:3,exclude:-1,exhaust:-2,
  fail:-2,failure:-2,fair:2,faith:2,fake:-3,famous:2,fantastic:4,fascinate:3,
  fault:-2,favorite:2,fear:-2,fight:-1,fine:2,fix:1,flaw:-2,fool:-2,forgive:1,
  fortunate:2,free:1,friendly:2,frighten:-2,frustrated:-2,fulfil:2,fun:4,
  funny:4,furious:-3,generous:2,genius:3,gentle:2,glad:3,gloom:-2,glory:2,
  good:3,gorgeous:3,grace:2,grand:3,grateful:3,great:3,greed:-3,grief:-2,
  grin:2,gross:-2,guilty:-3,happy:3,hard:-1,harm:-2,harmful:-2,harsh:-2,
  hate:-3,hatred:-3,heal:2,healthy:2,heartbreak:-3,help:2,helpful:2,
  hero:2,honest:2,honor:2,hope:2,hopeful:2,hopeless:-2,horrible:-3,
  hostile:-2,hug:2,humble:2,humor:2,hungry:-1,hurt:-2,idea:1,ideal:2,
  ignore:-1,ill:-2,illegal:-3,imagine:1,impress:3,improve:2,incredible:4,
  independent:2,inferior:-2,injustice:-3,innocence:2,innovative:2,
  insane:-2,inspire:2,insult:-2,interesting:2,invalid:-2,invite:1,
  irritate:-3,isolate:-1,jealous:-2,joke:2,joy:3,joyful:3,just:1,
  keen:1,kill:-3,kind:2,kiss:2,lack:-2,lame:-2,laugh:1,lazy:-1,
  leader:1,lie:-2,like:2,lively:2,lonely:-2,lose:-3,loser:-3,loss:-3,
  love:3,lovely:3,luck:3,lucky:3,mad:-3,magic:3,magnificent:3,
  manipulate:-3,marvelous:3,mean:-2,mercy:2,mess:-2,miracle:4,
  miserable:-3,miss:-1,mistake:-2,mock:-2,monster:-2,mourn:-2,
  murder:-3,nasty:-3,neat:2,negative:-2,neglect:-2,nervous:-2,
  nice:3,noble:2,nonsense:-2,nothing:-1,numb:-1,obsess:-2,
  offend:-2,ok:1,okay:1,opportunity:2,oppose:-1,outstanding:5,
  overcome:2,pain:-2,panic:-3,paradise:3,passion:1,patient:2,
  peace:2,peaceful:2,perfect:3,pity:-1,play:1,pleasant:3,
  please:1,pleasure:3,poison:-3,polite:2,poor:-2,popular:1,positive:2,
  poverty:-1,powerful:2,praise:3,pretty:1,pride:2,privilege:2,
  problem:-2,profit:2,progress:2,promise:1,proud:2,punish:-2,
  pure:2,rage:-3,reckless:-2,recommend:2,refuse:-2,regret:-2,
  reject:-2,relax:2,relief:2,remarkable:2,rescue:2,respect:2,
  responsible:2,restore:1,revenge:-2,reward:2,rich:2,ridiculous:-2,
  risk:-1,rob:-2,romantic:2,rotten:-3,rude:-2,ruin:-2,sad:-2,
  safe:1,satisfy:2,scare:-2,scary:-2,scream:-2,selfish:-3,
  shame:-2,shock:-2,sick:-2,silly:-2,simple:1,sin:-2,sincere:2,
  smart:1,smile:2,sorry:-1,special:2,splendid:3,steal:-2,
  strength:2,stress:-1,strong:2,struggle:-1,stupid:-3,succeed:3,
  success:2,suffer:-2,super:3,superb:5,support:2,surprise:1,
  survive:2,suspect:-1,sweet:2,terrible:-3,terrific:4,terror:-3,
  thank:2,thankful:2,threat:-2,thrill:3,thrive:3,tired:-2,
  together:1,top:2,torture:-4,tough:-1,toxic:-3,tragedy:-2,
  trap:-1,trauma:-3,treasure:2,tremendous:4,trick:-1,triumph:4,
  trouble:-2,true:2,trust:1,ugly:-3,unfair:-2,unfortunate:-2,
  unhappy:-2,unique:2,upset:-2,useful:2,useless:-2,valuable:2,
  victim:-3,victory:3,villain:-3,violence:-3,violent:-3,virtue:2,
  vital:2,vulnerable:-2,want:1,war:-2,warm:1,warn:-1,waste:-1,
  weak:-2,wealth:3,weird:-2,welcome:2,well:1,wicked:-2,win:4,
  wisdom:3,wise:2,wish:1,wonderful:4,worried:-3,worry:-3,
  worse:-3,worst:-3,worth:2,worthless:-3,wow:4,wrong:-2,yay:3,
};

export class SentimentTool extends Tool {
  readonly name = "sentiment";
  readonly category = "ai" as const;
  readonly description = "Sentiment analysis (AFINN lexicon): analyze, batch, compare, keywords, score_text.";
  readonly parameters: JsonSchema = {
    type: "object",
    properties: {
      action: { type: "string", enum: ["analyze", "batch", "compare", "keywords", "score_text"], description: "Operation" },
      text: { type: "string", description: "Input text" },
      texts: { type: "string", description: "JSON array of texts (batch/compare)" },
    },
    required: ["action"],
    additionalProperties: false,
  };

  protected async run(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action || "analyze");

    switch (action) {
      case "analyze": {
        const text = String(params.text || "");
        return JSON.stringify(this.analyze(text));
      }
      case "batch": {
        let texts: string[];
        try { texts = JSON.parse(String(params.texts || "[]")); } catch { return JSON.stringify({ error: "invalid texts JSON" }); }
        const results = texts.map((t, i) => ({ index: i, ...this.analyze(t) }));
        const avg = results.reduce((s, r) => s + r.score, 0) / (results.length || 1);
        return JSON.stringify({ count: results.length, average_score: Math.round(avg * 100) / 100, results });
      }
      case "compare": {
        let texts: string[];
        try { texts = JSON.parse(String(params.texts || "[]")); } catch { return JSON.stringify({ error: "invalid texts JSON" }); }
        if (texts.length < 2) return JSON.stringify({ error: "need at least 2 texts" });
        const scores = texts.map((t) => this.analyze(t));
        const most_positive = scores.reduce((max, s, i) => s.score > scores[max].score ? i : max, 0);
        const most_negative = scores.reduce((min, s, i) => s.score < scores[min].score ? i : min, 0);
        return JSON.stringify({ scores: scores.map((s, i) => ({ index: i, score: s.score, label: s.label })), most_positive, most_negative });
      }
      case "keywords": {
        const text = String(params.text || "");
        const words = text.toLowerCase().match(/\b\w+\b/g) || [];
        const positive: { word: string; score: number }[] = [];
        const negative: { word: string; score: number }[] = [];
        for (const w of words) {
          const score = AFINN[w];
          if (score !== undefined) {
            if (score > 0) positive.push({ word: w, score });
            else if (score < 0) negative.push({ word: w, score });
          }
        }
        positive.sort((a, b) => b.score - a.score);
        negative.sort((a, b) => a.score - b.score);
        return JSON.stringify({ positive, negative });
      }
      case "score_text": {
        const text = String(params.text || "");
        const words = text.toLowerCase().match(/\b\w+\b/g) || [];
        const scored = words.map((w) => ({ word: w, score: AFINN[w] ?? 0 })).filter((w) => w.score !== 0);
        return JSON.stringify({ word_scores: scored, total: scored.reduce((s, w) => s + w.score, 0) });
      }
      default:
        return JSON.stringify({ error: `unknown action: ${action}` });
    }
  }

  private analyze(text: string): { score: number; label: string; word_count: number; scored_words: number; comparative: number } {
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    let score = 0;
    let scored = 0;
    for (const w of words) {
      const s = AFINN[w];
      if (s !== undefined) { score += s; scored++; }
    }
    const comparative = words.length > 0 ? Math.round((score / words.length) * 10000) / 10000 : 0;
    const label = score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
    return { score, label, word_count: words.length, scored_words: scored, comparative };
  }
}
