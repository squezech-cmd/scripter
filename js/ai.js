// ============================================================
// AI brain for sock courtroom: evidence choice, speech, voting.
// ============================================================
import { EVIDENCE, STYLES, LINES, pick, fill, shuffle } from './data.js';

export function drawHand(deckId, count=5){
  const pool = shuffle(EVIDENCE);
  return pool.slice(0, count);
}

export function aiChooseCard(hand, side, deckBonus){
  // side: 'prosecutor' wants high persuasion, 'defense' same
  // Add small randomness + deck bonus influence
  const scored = hand.map(card=>{
    let score = card.persuasion + Math.random()*3;
    if(deckBonus === 'chaos') score += card.chaos * 0.4;
    if(deckBonus === 'logic' && card.type === 'document') score += 1.5;
    return { card, score };
  });
  scored.sort((a,b)=>b.score-a.score);
  return scored[0].card;
}

export function aiChooseStyle(card){
  // Prefer style matching card chaos
  const styles = Object.keys(STYLES);
  if(card.chaos >= 6) return pick(['chaos','emotion','bribe']);
  if(card.type === 'document') return pick(['logic','logic','emotion']);
  if(card.type === 'physical') return pick(['logic','emotion']);
  return pick(styles);
}

export function persuasionScore(card, styleId, deckId, charisma=5){
  const style = STYLES[styleId] || STYLES.logic;
  let base = card.persuasion * style.mult;
  // Deck bonuses (Scripter Addons)
  const deckBonusMap = { classic:{logic:2}, absurd:{chaos:2}, dark:{logic:1,emotion:1}, scifi:{chaos:2,bribe:1}, royal:{bribe:2}, emotion:{emotion:2} };
  const bonus = deckBonusMap[deckId] || {};
  if(bonus[styleId]) base += bonus[styleId];
  // Charisma adds a bit
  base += (charisma - 5) * 0.4;
  // Chaos style adds chaos meter but slightly less reliable
  base += style.chaos * 0.2;
  return Math.max(1, Math.round(base * 10) / 10);
}

export function generatePresentLine(card, styleId, vars){
  const tmpl = LINES.present[styleId] || LINES.present.logic;
  return fill(tmpl, { ...vars, card: `${card.emoji} «${card.name}» — ${card.desc}` });
}

export function aiVote(prosScore, defScore, jurorCharisma=5, chaos=0, streamerBias=0){
  // Returns true = guilty
  const diff = prosScore - defScore;
  const noise = (Math.random()-0.5) * 6;
  const chaosNoise = chaos > 70 ? (Math.random()-0.5)*4 : 0;
  const total = diff + noise + chaosNoise + streamerBias + (jurorCharisma-5)*0.3;
  return total > 0;
}

export function generateHeadline(vars){
  return fill(pick(LINES.headlines), vars);
}

export function streamerVote(prosScore, defScore){
  // Fake chat: weighted by scores + randomness
  const p = 50 + (prosScore-defScore)*4 + (Math.random()-0.5)*20;
  const guilty = Math.max(5, Math.min(95, Math.round(p)));
  return { guilty, innocent: 100-guilty };
}
