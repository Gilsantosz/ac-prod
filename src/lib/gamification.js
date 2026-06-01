// Gamificação: pontos por meta batida + baixo refugo, ranking por % de atingimento
// e badges por sequência de dias batendo a meta.

const SCRAP_GOOD = 2; // % refugo abaixo do qual ganha bônus
const SCRAP_GREAT = 1;

// Agrupa entradas por equipe (célula + turno) e por dia.
function groupTeams(entries) {
  const teams = {};
  entries.forEach((e) => {
    if (!e.cell || !e.shift) return;
    const key = `${e.cell}__${e.shift}`;
    (teams[key] = teams[key] || { cell: e.cell, shift: e.shift, days: {} });
    const day = e.date || '—';
    const d = (teams[key].days[day] = teams[key].days[day] || { produced: 0, target: 0, scrap: 0 });
    d.produced += Number(e.produced) || 0;
    d.target += Number(e.target) || 0;
    d.scrap += Number(e.scrap) || 0;
  });
  return teams;
}

// Pontos de um dia: 100 se bateu a meta + bônus por baixo refugo + parcial proporcional.
function dayPoints(d) {
  if (d.target <= 0) return 0;
  const attain = d.produced / d.target;
  let pts = attain >= 1 ? 100 : Math.round(attain * 80);
  const scrapRate = d.produced > 0 ? (d.scrap / d.produced) * 100 : 0;
  if (attain >= 1 && scrapRate <= SCRAP_GREAT) pts += 30;
  else if (attain >= 1 && scrapRate <= SCRAP_GOOD) pts += 15;
  return pts;
}

// Maior sequência de dias consecutivos batendo a meta.
function bestStreak(days) {
  const sorted = Object.keys(days).sort();
  let streak = 0, best = 0;
  sorted.forEach((day) => {
    const d = days[day];
    const hit = d.target > 0 && d.produced >= d.target;
    streak = hit ? streak + 1 : 0;
    best = Math.max(best, streak);
  });
  return best;
}

function badgesForStreak(streak) {
  const list = [];
  if (streak >= 3) list.push({ label: 'Bronze', desc: '3 dias seguidos na meta', tier: 'bronze' });
  if (streak >= 5) list.push({ label: 'Prata', desc: '5 dias seguidos na meta', tier: 'silver' });
  if (streak >= 10) list.push({ label: 'Ouro', desc: '10 dias seguidos na meta', tier: 'gold' });
  return list;
}

// Ranking de equipes (célula+turno) para um conjunto de entradas.
export function buildLeaderboard(entries) {
  const teams = groupTeams(entries);
  const rows = Object.values(teams).map((t) => {
    const produced = Object.values(t.days).reduce((a, d) => a + d.produced, 0);
    const target = Object.values(t.days).reduce((a, d) => a + d.target, 0);
    const scrap = Object.values(t.days).reduce((a, d) => a + d.scrap, 0);
    const points = Object.values(t.days).reduce((a, d) => a + dayPoints(d), 0);
    const attainment = target > 0 ? Math.round((produced / target) * 1000) / 10 : 0;
    const scrapRate = produced > 0 ? Math.round((scrap / produced) * 1000) / 10 : 0;
    const streak = bestStreak(t.days);
    return {
      key: `${t.cell}__${t.shift}`,
      cell: t.cell,
      shift: t.shift,
      produced,
      target,
      attainment,
      scrapRate,
      points,
      streak,
      badges: badgesForStreak(streak),
    };
  });
  return rows.sort((a, b) => b.attainment - a.attainment || b.points - a.points);
}