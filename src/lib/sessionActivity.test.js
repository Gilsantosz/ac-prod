import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessionActivity,
  getLastSessionActivity,
  isSessionInactive,
  recordSessionActivity,
  SESSION_INACTIVITY_MS,
} from '@/lib/sessionActivity';

describe('sessionActivity', () => {
  beforeEach(() => {
    clearSessionActivity();
  });

  it('mantém a sessão ativa antes de 30 minutos', () => {
    recordSessionActivity(1_000);

    expect(isSessionInactive(1_000 + SESSION_INACTIVITY_MS - 1)).toBe(false);
  });

  it('expira a sessão ao completar 30 minutos sem atividade', () => {
    recordSessionActivity(1_000);

    expect(isSessionInactive(1_000 + SESSION_INACTIVITY_MS)).toBe(true);
  });

  it('renova o prazo quando há nova atividade e limpa no logout', () => {
    recordSessionActivity(1_000);
    recordSessionActivity(20_000);

    expect(getLastSessionActivity()).toBe(20_000);
    expect(isSessionInactive(20_000 + SESSION_INACTIVITY_MS - 1)).toBe(false);

    clearSessionActivity();
    expect(getLastSessionActivity()).toBeNull();
    expect(isSessionInactive(99_999_999)).toBe(false);
  });
});
