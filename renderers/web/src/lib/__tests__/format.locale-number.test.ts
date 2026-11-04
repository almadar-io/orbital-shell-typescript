import { describe, it, expect } from 'vitest';
import { formatValue } from '../../core';

describe('formatValue locale-aware numbers', () => {
  it.each([
    { locale: 'en', currency: 'USD', number: '1,234.5', percent: '45%', money: '$1,234.50', date: 'Sep 1, 2026' },
    { locale: 'de', currency: 'USD', number: '1.234,5', percent: '45\u00a0%', money: '1.234,50\u00a0$', date: '1. Sept. 2026' },
    { locale: 'sl', currency: 'EUR', number: '1234,5', percent: '45\u00a0%', money: '1234,50\u00a0€', date: '1. sep. 2026' },
    { locale: 'ar-SA', currency: 'SAR', number: '١٬٢٣٤٫٥', percent: '٤٥٪\u061c', money: '\u200f١٬٢٣٤٫٥٠\u00a0ر.س.\u200f', date: '١ سبتمبر ٢٠٢٦' },
  ])('freezes Node 24.14 Intl (ICU 78.2, CLDR 48) display for $locale', ({ locale, currency, number, percent, money, date }) => {
    expect(formatValue(1234.5, 'number', { locale })).toBe(number);
    expect(formatValue(45.4, 'percent', { locale })).toBe(percent);
    expect(formatValue(1234.5, 'currency', { locale, currency })).toBe(money);
    expect(formatValue('2026-09-01', 'date', { locale })).toBe(date);
  });

  it('number follows the given locale', () => {
    expect(formatValue(1234.5, 'number', { locale: 'en' })).toBe('1,234.5');
    expect(formatValue(1234.5, 'number', { locale: 'de' })).toBe('1.234,5');
  });

  it('currency is formatted by Intl for the locale', () => {
    expect(formatValue(1234.5, 'currency', { locale: 'en' })).toBe(new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(1234.5));
    expect(formatValue(1234.5, 'currency', { locale: 'de' })).toBe(new Intl.NumberFormat('de', { style: 'currency', currency: 'USD' }).format(1234.5));
  });

  it('percent keeps percent units (45 → 45%) with locale placement', () => {
    expect(formatValue(45, 'percent', { locale: 'en' })).toBe('45%');
    expect(formatValue(45.4, 'percent', { locale: 'de' })).toBe(new Intl.NumberFormat('de', { style: 'percent', maximumFractionDigits: 0 }).format(0.454));
  });

  it('control: strings pass through untouched', () => {
    expect(formatValue('N/A', 'currency', { locale: 'en' })).toBe('N/A');
    expect(formatValue('12', 'number', { locale: 'en' })).toBe('12');
  });

  it('currency follows the declared app currency', () => {
    expect(formatValue(1234.5, 'currency', { locale: 'ar-SA', currency: 'SAR' })).toBe(new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(1234.5));
    expect(formatValue(10, 'currency', { locale: 'sl', currency: 'EUR' })).toBe(new Intl.NumberFormat('sl', { style: 'currency', currency: 'EUR' }).format(10));
  });

  it('control: with no declared currency it is USD', () => {
    expect(formatValue(10, 'currency', { locale: 'en' })).toBe(new Intl.NumberFormat('en', { style: 'currency', currency: 'USD' }).format(10));
  });
});
