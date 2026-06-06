/**
 * seedTestData.js
 * Gera dados de produção realistas para testes do sistema.
 * 10 dias de histórico, 3 turnos, 5 células, dados por hora.
 */

import { base44 } from './localDb';

const CELLS = ['Célula A', 'Célula B', 'Célula C', 'Célula D', 'Célula E'];
const SHIFTS = ['1º Turno', '2º Turno', '3º Turno'];

// Horários por turno (hora de início de cada intervalo)
const SHIFT_HOURS = {
  '1º Turno': [6, 7, 8, 9, 10, 11, 12, 13],
  '2º Turno': [14, 15, 16, 17, 18, 19, 20, 21],
  '3º Turno': [22, 23, 0, 1, 2, 3, 4, 5],
};

// Meta padrão por turno/célula (peças/hora)
const BASE_TARGET_PER_HOUR = {
  'Célula A': 50,
  'Célula B': 45,
  'Célula C': 60,
  'Célula D': 40,
  'Célula E': 55,
};

// Perfis de eficiência por célula (simulam comportamentos distintos)
const CELL_EFFICIENCY_PROFILES = {
  'Célula A': { avg: 92, variance: 8 },   // Alta performance
  'Célula B': { avg: 78, variance: 12 },  // Performance moderada
  'Célula C': { avg: 85, variance: 10 },  // Boa performance
  'Célula D': { avg: 65, variance: 20 },  // Performance baixa (com críticos)
  'Célula E': { avg: 95, variance: 5 },   // Excelente performance
};

// Ocorrências típicas de parada
const DOWNTIME_REASONS = [
  'Setup de máquina',
  'Manutenção preventiva',
  'Falta de material',
  'Ajuste de processo',
  'Troca de ferramenta',
];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Gera a string de data no formato yyyy-MM-dd para N dias atrás
 */
function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Gera eficiência baseada no perfil da célula, com variações por hora e turno
 */
function generateEfficiency(cell, shift, hour) {
  const profile = CELL_EFFICIENCY_PROFILES[cell];
  let base = profile.avg;

  // Penalidade no início do turno (aquecimento)
  const shiftHours = SHIFT_HOURS[shift];
  const hourIndex = shiftHours.indexOf(Number(hour));
  if (hourIndex === 0) base -= 10; // primeira hora mais baixa
  if (hourIndex === 1) base -= 5;  // segunda hora ainda aquecendo

  // Penalidade no final do turno (fadiga)
  if (hourIndex === shiftHours.length - 1) base -= 5;

  // Variação aleatória
  const noise = (Math.random() - 0.5) * profile.variance * 2;
  const eff = clamp(base + noise, 30, 110);

  return Math.round(eff);
}

/**
 * Injeta entradas de produção no banco
 */
async function seedProductionEntries(daysBack = 10) {
  const entries = [];

  for (let day = 0; day < daysBack; day++) {
    const date = dateNDaysAgo(day);

    for (const shift of SHIFTS) {
      const hours = SHIFT_HOURS[shift];

      for (const cell of CELLS) {
        const baseTarget = BASE_TARGET_PER_HOUR[cell];

        // Nem todo turno tem todos os horários (simula intervalos reais)
        const activeHours = hours.slice(0, randomBetween(5, 8));

        for (const hour of activeHours) {
          const eff = generateEfficiency(cell, shift, hour);
          const target = baseTarget + randomBetween(-5, 5);
          const produced = Math.round((target * eff) / 100);
          const scrap = eff < 70 ? randomBetween(2, 8) : randomBetween(0, 3);
          const downtime = eff < 65 ? randomBetween(10, 30) : (eff < 80 ? randomBetween(0, 10) : 0);
          const reason = downtime > 0 ? DOWNTIME_REASONS[randomBetween(0, DOWNTIME_REASONS.length - 1)] : '';

          entries.push({
            date,
            shift,
            cell,
            hour: String(hour),
            produced,
            target,
            scrap,
            downtime,
            downtime_reason: reason,
            operator: `Operador ${randomBetween(1, 5)}`,
          });
        }
      }
    }
  }

  // Insere em lotes de 20
  let count = 0;
  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    await Promise.all(batch.map(e => base44.entities.ProductionEntry.create(e)));
    count += batch.length;
  }

  return count;
}

/**
 * Injeta metas diárias por célula/turno
 */
async function seedDailyGoals(daysBack = 10) {
  const goals = [];

  for (let day = 0; day < daysBack; day++) {
    const date = dateNDaysAgo(day);

    for (const shift of SHIFTS) {
      for (const cell of CELLS) {
        const baseTarget = BASE_TARGET_PER_HOUR[cell];
        const hoursInShift = SHIFT_HOURS[shift].length;
        const dailyTarget = baseTarget * hoursInShift;

        goals.push({
          date,
          shift,
          cell,
          target: dailyTarget,
        });
      }
    }
  }

  let count = 0;
  for (const g of goals) {
    try {
      await base44.entities.DailyGoal.create(g);
      count++;
    } catch {
      // upsert pode falhar por conflito — ok
    }
  }

  return count;
}

/**
 * Injeta células no banco (se ainda não existirem)
 */
async function seedCells() {
  const existing = await base44.entities.Cell.list();
  const existingNames = existing.map(c => c.name);
  let count = 0;

  for (const name of CELLS) {
    if (!existingNames.includes(name)) {
      await base44.entities.Cell.create({
        name,
        active: true,
        hoursShift1: 8,
        hoursShift2: 8,
        hoursShift3: 8,
      });
      count++;
    }
  }

  return count;
}

/**
 * Função principal de seed — executa tudo em sequência
 * Retorna um resumo do que foi criado
 */
export async function runSeedTestData(daysBack = 10) {
  const results = { cells: 0, entries: 0, goals: 0, errors: [] };

  try {
    results.cells = await seedCells();
  } catch (e) {
    results.errors.push(`Células: ${e.message}`);
  }

  try {
    results.entries = await seedProductionEntries(daysBack);
  } catch (e) {
    results.errors.push(`Entradas: ${e.message}`);
  }

  try {
    results.goals = await seedDailyGoals(daysBack);
  } catch (e) {
    results.errors.push(`Metas: ${e.message}`);
  }

  return results;
}
