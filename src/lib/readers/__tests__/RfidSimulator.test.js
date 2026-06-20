import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processProductionReading } from '@/lib/traceabilityService';
import FutureRfidAdapter from '@/lib/readers/FutureRfidAdapter';
import RfidSimulator from '@/lib/readers/RfidSimulator';
import { productionItemsFixture } from '@/test/fixtures/traceabilityFixtures';
import { createTraceabilityTestRepository } from '@/test/utils/createTraceabilityTestRepository';

const serviceNow = new Date('2026-06-19T11:00:00.000Z');

function createSimulator(options = {}) {
  const repository = options.repository || createTraceabilityTestRepository();
  const processor = vi.fn((payload) => processProductionReading(payload, { repository, now: serviceNow }));
  const adapter = new FutureRfidAdapter({ processor });
  let timestamp = serviceNow.getTime();
  const simulator = new RfidSimulator({
    adapter,
    now: () => timestamp,
    debounceMs: 2000,
    readerId: 'RFID-PORTAL-01',
    stationName: 'Portal Corte',
    cellName: 'Corte',
    ...options,
  });
  return { simulator, repository, processor, advance: (ms) => { timestamp += ms; } };
}

describe('RfidSimulator', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gera e processa uma leitura EPC unitária', async () => {
    const { simulator, processor } = createSimulator();
    const result = await simulator.read(simulator.generateEpc(1));
    expect(result.status).toBe('approved');
    expect(processor).toHaveBeenCalledOnce();
  });

  it('bloqueia leitura repetida sem criar segunda baixa', async () => {
    const { simulator, processor } = createSimulator();
    const [first, second] = await simulator.readRepeated(productionItemsFixture[0].rfidEpc);
    expect(first.status).toBe('approved');
    expect(second.status).toBe('duplicated');
    expect(processor).toHaveBeenCalledOnce();
  });

  it('processa leitura em massa removendo EPCs repetidos', async () => {
    const { simulator, processor } = createSimulator();
    const epcs = [
      productionItemsFixture[0].rfidEpc,
      productionItemsFixture[1].rfidEpc,
      productionItemsFixture[1].rfidEpc,
      productionItemsFixture[2].rfidEpc,
    ];
    const results = await simulator.readMany(epcs);
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.success)).toBe(true);
    expect(processor).toHaveBeenCalledTimes(3);
  });

  it('retorna código não localizado para EPC desconhecido', async () => {
    const { simulator } = createSimulator();
    const result = await simulator.read('EPC-TEST-999999999999');
    expect(result.status).toBe('not_found');
  });

  it('bloqueia EPC lido em célula errada', async () => {
    const { simulator } = createSimulator();
    const result = await simulator.readInWrongCell(productionItemsFixture[0].rfidEpc, 'Expedição');
    expect(result.status).toBe('wrong_cell');
  });

  it('libera o EPC depois do tempo de debounce', async () => {
    const { simulator, advance, processor } = createSimulator();
    await simulator.read(productionItemsFixture[0].rfidEpc);
    advance(2500);
    await simulator.read(productionItemsFixture[0].rfidEpc, { cellName: 'Marcenaria' });
    expect(processor).toHaveBeenCalledTimes(2);
  });

  it('registra RFID fixo ou portátil', async () => {
    const fixed = createSimulator();
    await fixed.simulator.read(productionItemsFixture[0].rfidEpc);
    expect(fixed.processor.mock.calls[0][0].readerType).toBe('rfid_fixed');

    const handheld = createSimulator({ readerType: 'rfid_handheld' });
    await handheld.simulator.read(productionItemsFixture[0].rfidEpc);
    expect(handheld.processor.mock.calls[0][0].readerType).toBe('rfid_handheld');
  });

  it('envia readerId, estação e célula ao serviço', async () => {
    const { simulator, processor } = createSimulator();
    await simulator.read(productionItemsFixture[0].rfidEpc);
    expect(processor.mock.calls[0][0]).toMatchObject({
      readerId: 'RFID-PORTAL-01',
      stationName: 'Portal Corte',
      cellName: 'Corte',
    });
  });
});
