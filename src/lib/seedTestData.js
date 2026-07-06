import { base44 } from './localDb';
import { supabase } from './supabaseClient';

const CELLS = ['Corte', 'Bordo', 'Usinagem', 'Marcenaria', 'Embalagem', 'Expedição'];
const SHIFTS = ['1º Turno', '2º Turno', '3º Turno'];

// Horários por turno (hora de início de cada intervalo)
const SHIFT_HOURS = {
  '1º Turno': [6, 7, 8, 9, 10, 11, 12, 13],
  '2º Turno': [14, 15, 16, 17, 18, 19, 20, 21],
  '3º Turno': [22, 23, 0, 1, 2, 3, 4, 5],
};

// Meta padrão por turno/célula (peças/hora)
const BASE_TARGET_PER_HOUR = {
  'Corte': 50,
  'Bordo': 45,
  'Usinagem': 60,
  'Marcenaria': 40,
  'Embalagem': 55,
  'Expedição': 50,
};

// Perfis de eficiência por célula (simulam comportamentos distintos)
const CELL_EFFICIENCY_PROFILES = {
  'Corte': { avg: 92, variance: 8 },
  'Bordo': { avg: 78, variance: 12 },
  'Usinagem': { avg: 85, variance: 10 },
  'Marcenaria': { avg: 65, variance: 20 },
  'Embalagem': { avg: 95, variance: 5 },
  'Expedição': { avg: 90, variance: 7 },
};

// Ocorrências típicas de parada (compatíveis com os motivos do formulário de ocorrências)
const DOWNTIME_REASONS = [
  'Falta de Material',
  'Manutenção Corretiva',
  'Manutenção Preventiva',
  'Setup / Troca',
  'Falta de Operador',
  'Qualidade / Refugo',
  'Falta de Energia',
  'Outros',
];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function generateEfficiency(cell, shift, hour) {
  const profile = CELL_EFFICIENCY_PROFILES[cell] || { avg: 80, variance: 10 };
  let base = profile.avg;

  const shiftHours = SHIFT_HOURS[shift];
  const hourIndex = shiftHours.indexOf(Number(hour));
  if (hourIndex === 0) base -= 10;
  if (hourIndex === 1) base -= 5;
  if (hourIndex === shiftHours.length - 1) base -= 5;

  const noise = (Math.random() - 0.5) * profile.variance * 2;
  const eff = clamp(base + noise, 30, 110);

  return Math.round(eff);
}

/**
 * Injeta entradas de produção no banco
 */
async function seedProductionEntries(daysBack = 10) {
  const entries = [];
  const occurrences = [];

  for (let day = 0; day < daysBack; day++) {
    const date = dateNDaysAgo(day);

    for (const shift of SHIFTS) {
      const hours = SHIFT_HOURS[shift];

      for (const cell of CELLS) {
        const baseTarget = BASE_TARGET_PER_HOUR[cell];
        const activeHours = hours.slice(0, randomBetween(5, 8));

        for (const hour of activeHours) {
          const eff = generateEfficiency(cell, shift, hour);
          const target = baseTarget + randomBetween(-5, 5);
          const produced = Math.round((target * eff) / 100);
          const scrap = eff < 70 ? randomBetween(2, 8) : randomBetween(0, 3);
          const downtime = eff < 65 ? randomBetween(10, 30) : (eff < 80 ? randomBetween(0, 10) : 0);
          const reason = downtime > 0 ? DOWNTIME_REASONS[randomBetween(0, DOWNTIME_REASONS.length - 1)] : '';
          const operatorName = `Operador ${randomBetween(1, 5)}`;

          entries.push({
            date,
            shift,
            cell,
            hour: String(hour),
            produced,
            target,
            scrap,
            downtime,
            notes: reason,
            operator: operatorName,
          });

          if (downtime > 0) {
            occurrences.push({
              date,
              shift,
              cell,
              reason: reason,
              downtime,
              operator: operatorName,
              notes: 'Parada registrada automaticamente pelo gerador de dados de teste.',
            });
          }
        }
      }
    }
  }

  // Insere entradas em lotes
  let count = 0;
  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    await Promise.all(batch.map(e => base44.entities.ProductionEntry.create(e)));
    count += batch.length;
  }

  // Insere ocorrências em lotes
  let occCount = 0;
  for (let i = 0; i < occurrences.length; i += 20) {
    const batch = occurrences.slice(i, i + 20);
    await Promise.all(batch.map(o => base44.entities.Occurrence.create(o)));
    occCount += batch.length;
  }

  return { entries: count, occurrences: occCount };
}

async function seedOperators() {
  const existing = await base44.entities.Operator.list();
  const existingNames = existing.map(o => o.name);
  let count = 0;

  const testOperators = [
    { name: 'Carlos Silva', registration: '00101', shift: '1º Turno', cells: ['Corte', 'Bordo'], active: true },
    { name: 'Marcos Souza', registration: '00102', shift: '2º Turno', cells: ['Bordo', 'Usinagem'], active: true },
    { name: 'Ana Costa', registration: '00103', shift: '3º Turno', cells: ['Corte', 'Marcenaria'], active: true },
    { name: 'Juliana Lima', registration: '00104', shift: '1º Turno', cells: ['Marcenaria', 'Embalagem'], active: true },
    { name: 'Roberto Alves', registration: '00105', shift: '2º Turno', cells: ['Usinagem', 'Expedição'], active: true },
  ];

  for (const op of testOperators) {
    if (!existingNames.includes(op.name)) {
      await base44.entities.Operator.create(op);
      count++;
    }
  }
  return count;
}

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
      // ignorar falha por conflito de chave
    }
  }

  return count;
}

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
 * Injeta lotes, peças, rotas, leituras, pacotes e remessas de teste consistentes (Chão de fábrica MES).
 * Importante: preserva os dados de coletas de histórico de testes existentes no banco.
 */
async function seedTraceabilityData() {
  const testLots = [
    { lot_code: 'LOTE-TESTE-101', customer_name: 'Residencial Alpha', order_number: 'PED-901', status: 'waiting_packaging', current_stage: 'Embalagem', planned_quantity: 42, approved_quantity: 42 },
    { lot_code: 'LOTE-TESTE-102', customer_name: 'Apartamento 302', order_number: 'PED-902', status: 'in_progress', current_stage: 'Usinagem', planned_quantity: 15, approved_quantity: 8 },
    { lot_code: 'LOTE-TESTE-103', customer_name: 'Consultório Med', order_number: 'PED-903', status: 'waiting_shipping', current_stage: 'Expedição', planned_quantity: 28, approved_quantity: 28 },
    { lot_code: 'LOTE-TESTE-104', customer_name: 'Cozinha Planejada B', order_number: 'PED-904', status: 'completed', current_stage: 'Concluído', planned_quantity: 10, approved_quantity: 10 }
  ];

  for (const l of testLots) {
    const { data: existingLot } = await supabase
      .from('production_lots')
      .select('id')
      .eq('lot_code', l.lot_code)
      .maybeSingle();

    let lotId = existingLot?.id;

    if (!lotId) {
      // 1. Cria Ordem de Produção
      const { data: order } = await supabase
        .from('production_orders')
        .insert({
          order_code: l.order_number,
          customer_name: l.customer_name,
          status: l.status === 'completed' ? 'shipped' : 'in_progress'
        })
        .select()
        .single();

      // 2. Cria Lote
      const { data: newLot } = await supabase
        .from('production_lots')
        .insert({
          order_id: order.id,
          production_order_id: order.id,
          lot_code: l.lot_code,
          status: l.status,
          current_status: l.status,
          current_stage: l.current_stage,
          planned_quantity: l.planned_quantity,
          approved_quantity: l.approved_quantity,
          customer_name: l.customer_name,
          order_number: l.order_number
        })
        .select()
        .single();

      lotId = newLot.id;

      // 3. Cria Rotas de Produção
      const steps = ['Corte', 'Bordo', 'Usinagem', 'Marcenaria', 'Embalagem', 'Expedição'];
      const routeInserts = steps.map((step, idx) => ({
        lot_id: lotId,
        step_order: idx + 1,
        step_name: step,
        cell_name: step,
        required: true
      }));
      await supabase.from('production_routes').insert(routeInserts);

      // 4. Cria Peças
      const pieceNames = ['Lateral Direita', 'Lateral Esquerda', 'Base Inferior', 'Tampo Superior', 'Prateleira Móvel', 'Frente Gaveta', 'Porta Giro'];
      const pieceInserts = [];
      
      for (let i = 1; i <= l.planned_quantity; i++) {
        const pieceName = pieceNames[(i - 1) % pieceNames.length];
        const suffix = String(i).padStart(3, '0');
        const pieceUid = `AC-${l.lot_code}-${suffix}`;

        pieceInserts.push({
          lot_id: lotId,
          piece_uid: pieceUid,
          piece_name: `${pieceName} (${suffix})`,
          material: i % 2 === 0 ? 'MDF Branco 18mm' : 'MDF Louro Freijó 15mm',
          color: i % 2 === 0 ? 'Branco' : 'Madeirado',
          width: i % 2 === 0 ? 600 : 450,
          length: i % 2 === 0 ? 1200 : 800,
          thickness: i % 2 === 0 ? 18 : 15,
          current_stage: l.current_stage,
          status: 'approved'
        });
      }
      
      const { data: createdPieces } = await supabase
        .from('production_pieces')
        .insert(pieceInserts)
        .select();

      // 5. Cria leituras (readings) de histórico correspondentes
      const readingsToInsert = [];
      const now = new Date();

      if (l.lot_code === 'LOTE-TESTE-101' || l.lot_code === 'LOTE-TESTE-103' || l.lot_code === 'LOTE-TESTE-104') {
        const completedStages = l.lot_code === 'LOTE-TESTE-101' 
          ? ['Corte', 'Bordo', 'Usinagem', 'Marcenaria']
          : l.lot_code === 'LOTE-TESTE-103'
            ? ['Corte', 'Bordo', 'Usinagem', 'Marcenaria', 'Embalagem']
            : ['Corte', 'Bordo', 'Usinagem', 'Marcenaria', 'Embalagem', 'Expedição'];

        createdPieces.forEach((piece) => {
          completedStages.forEach((stage, sIdx) => {
            const timeOffset = sIdx * 10;
            const readTime = new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000) + (timeOffset * 60 * 1000));
            
            readingsToInsert.push({
              lot_id: lotId,
              tag_id: crypto.randomUUID(),
              tag_value: piece.piece_uid,
              reader_type: 'keyboard_barcode',
              reader_name: 'Scanner Teclado',
              step_name: stage,
              cell_name: stage,
              operator: 'Carlos Silva',
              shift: '1º Turno',
              date: readTime.toISOString().slice(0, 10),
              hour: readTime.toTimeString().slice(0, 5),
              status: 'approved',
              event_type: 'approved_scan',
              quantity: 1,
              created_at: readTime.toISOString(),
              lot_code: l.lot_code,
              order_number: l.order_number,
              customer_name: l.customer_name,
              piece_code: piece.piece_uid
            });
          });
        });
      }

      if (l.lot_code === 'LOTE-TESTE-102') {
        createdPieces.forEach((piece, pIdx) => {
          if (pIdx < 8) {
            const readTime = new Date(now.getTime() - (60 * 60 * 1000));
            readingsToInsert.push({
              lot_id: lotId,
              tag_id: crypto.randomUUID(),
              tag_value: piece.piece_uid,
              reader_type: 'keyboard_barcode',
              reader_name: 'Scanner Teclado',
              step_name: 'Corte',
              cell_name: 'Corte',
              operator: 'Marcos Souza',
              shift: '2º Turno',
              date: readTime.toISOString().slice(0, 10),
              hour: readTime.toTimeString().slice(0, 5),
              status: 'approved',
              event_type: 'approved_scan',
              quantity: 1,
              created_at: readTime.toISOString(),
              lot_code: l.lot_code,
              order_number: l.order_number,
              customer_name: l.customer_name,
              piece_code: piece.piece_uid
            });
          }
        });
      }

      if (readingsToInsert.length > 0) {
        for (let idx = 0; idx < readingsToInsert.length; idx += 30) {
          await supabase.from('production_stage_readings').insert(readingsToInsert.slice(idx, idx + 30));
        }
      }

      // 6. Cria Pacotes (Volumes)
      if (l.lot_code === 'LOTE-TESTE-103' || l.lot_code === 'LOTE-TESTE-104') {
        const pkgInserts = [
          { lot_id: lotId, order_id: order.id, package_code: `VOL-${l.lot_code}-001`, volume_number: 1, status: 'closed', total_items: 15, closed_at: now.toISOString() },
          { lot_id: lotId, order_id: order.id, package_code: `VOL-${l.lot_code}-002`, volume_number: 2, status: 'closed', total_items: 13, closed_at: now.toISOString() }
        ];
        await supabase.from('packages').insert(pkgInserts);
      }

      // 7. Cria Remessas de Carga
      if (l.lot_code === 'LOTE-TESTE-104') {
        await supabase
          .from('shipments')
          .insert({
            order_id: order.id,
            lot_id: lotId,
            shipment_code: 'CARGA-TESTE-104',
            carrier: 'Transportadora Leo',
            vehicle: 'Caminhão Ford Cargo',
            driver: 'Antônio Santos',
            tracking_code: 'TRK-LEO-104',
            shipped_at: now.toISOString(),
            status: 'shipped'
          });
      }
    }
  }
}

export async function runSeedTestData(daysBack = 10) {
  const results = { cells: 0, entries: 0, occurrences: 0, goals: 0, operators: 0, errors: [] };

  try {
    results.cells = await seedCells();
  } catch (e) {
    results.errors.push(`Células: ${e.message}`);
  }

  try {
    results.operators = await seedOperators();
  } catch (e) {
    results.errors.push(`Operadores: ${e.message}`);
  }

  try {
    const seedRes = await seedProductionEntries(daysBack);
    results.entries = seedRes.entries;
    results.occurrences = seedRes.occurrences;
  } catch (e) {
    results.errors.push(`Entradas/Ocorrências: ${e.message}`);
  }

  try {
    results.goals = await seedDailyGoals(daysBack);
  } catch (e) {
    results.errors.push(`Metas: ${e.message}`);
  }

  try {
    await seedTraceabilityData();
  } catch (e) {
    results.errors.push(`Fluxos Rastreabilidade: ${e.message}`);
  }

  return results;
}
