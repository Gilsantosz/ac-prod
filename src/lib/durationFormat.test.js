import { describe, it, expect } from 'vitest';
import { formatDuration, toTotalMinutes, toHoursAndMinutes } from './durationFormat';

describe('formatDuration', () => {
  it('formats 0 minutes as 0min', () => {
    expect(formatDuration(0)).toBe('0min');
  });

  it('formats 45 minutes as 45min', () => {
    expect(formatDuration(45)).toBe('45min');
  });

  it('formats 60 minutes as 1h', () => {
    expect(formatDuration(60)).toBe('1h');
  });

  it('formats 135 minutes as 2h 15min', () => {
    expect(formatDuration(135)).toBe('2h 15min');
  });

  it('formats 674 minutes as 11h 14min', () => {
    expect(formatDuration(674)).toBe('11h 14min');
  });
});

describe('toTotalMinutes', () => {
  it('converts 11 hours and 14 minutes into 674 minutes', () => {
    expect(toTotalMinutes(11, 14)).toBe(674);
  });

  it('converts 0 hours and 45 minutes into 45 minutes', () => {
    expect(toTotalMinutes(0, 45)).toBe(45);
  });

  it('converts 2 hours and 0 minutes into 120 minutes', () => {
    expect(toTotalMinutes(2, 0)).toBe(120);
  });

  it('clamps negative values and minutes over 59', () => {
    expect(toTotalMinutes(-2, 75)).toBe(59);
  });
});

describe('toHoursAndMinutes', () => {
  it('decomposes 674 minutes into 11 hours and 14 minutes', () => {
    expect(toHoursAndMinutes(674)).toEqual({ hours: 11, minutes: 14 });
  });

  it('decomposes 0 minutes into 0 hours and 0 minutes', () => {
    expect(toHoursAndMinutes(0)).toEqual({ hours: 0, minutes: 0 });
  });
});
