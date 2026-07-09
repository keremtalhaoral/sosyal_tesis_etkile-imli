/**
 * validate.js - Merkezi giriş doğrulama (Faz v2-03, ADR-003).
 *
 * DB CHECK kısıtları SON savunma hattıdır; bu katman kullanıcıya DOSTÇA ve erken hata verir
 * (transaction'a hiç girmeden). "Geçersiz durumu imkansız kıl" ilkesinin uygulama-seviyesi ayağı.
 * Her doğrulayıcı { ok: true, value } ya da { ok: false, error } döndürür.
 */

const { SLOTS } = require('./database');

const PAYMENT_TYPES = ['cash', 'card', 'online'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Rezervasyon girdisini doğrula. today: enjekte edilebilir (test için); üretimde bugünün tarihi.
const validateReservationInput = (body, { today = new Date().toISOString().slice(0, 10) } = {}) => {
  const b = body || {};

  if (!Number.isInteger(b.facilityId) || b.facilityId <= 0) {
    return { ok: false, error: 'facilityId pozitif tamsayı olmalı.' };
  }
  if (!DATE_RE.test(b.reserveDate || '')) {
    return { ok: false, error: 'reserveDate YYYY-AA-GG biçiminde olmalı.' };
  }
  if (b.reserveDate < today) {
    return { ok: false, error: 'Geçmiş bir tarihe rezervasyon yapılamaz.' };
  }
  if (!SLOTS.includes(b.reserveTime)) {
    return { ok: false, error: `reserveTime geçerli bir slot olmalı: ${SLOTS.join(', ')}` };
  }
  if (!Number.isInteger(b.guests) || b.guests <= 0) {
    return { ok: false, error: 'guests pozitif tamsayı olmalı.' };
  }
  const highchairCount = b.highchairCount === undefined ? 0 : b.highchairCount;
  if (!Number.isInteger(highchairCount) || highchairCount < 0) {
    return { ok: false, error: 'highchairCount negatif olmayan tamsayı olmalı.' };
  }
  if (highchairCount > b.guests) {
    return { ok: false, error: 'Bebe sandalyesi sayısı misafir sayısını aşamaz.' };
  }
  if (b.paymentType !== undefined && b.paymentType !== null && !PAYMENT_TYPES.includes(b.paymentType)) {
    return { ok: false, error: `paymentType şunlardan biri olmalı: ${PAYMENT_TYPES.join(', ')}` };
  }

  return {
    ok: true,
    value: {
      facilityId: b.facilityId,
      reserveDate: b.reserveDate,
      reserveTime: b.reserveTime,
      guests: b.guests,
      highchairCount,
      paymentType: b.paymentType ?? null
    }
  };
};

// Sipariş girdisini doğrula: reservationId, boş olmayan items[], her kalem geçerli, paymentType.
const validateOrderInput = (body) => {
  const b = body || {};
  if (!Number.isInteger(b.reservationId) || b.reservationId <= 0) {
    return { ok: false, error: 'reservationId pozitif tamsayı olmalı.' };
  }
  if (!Array.isArray(b.items) || b.items.length === 0) {
    return { ok: false, error: 'Sepet boş olamaz.' };
  }
  const items = [];
  for (const it of b.items) {
    if (!it || !Number.isInteger(it.menuItemId) || it.menuItemId <= 0) {
      return { ok: false, error: 'Geçersiz menü kalemi.' };
    }
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
      return { ok: false, error: 'Kalem adedi pozitif tamsayı olmalı.' };
    }
    items.push({ menuItemId: it.menuItemId, quantity: it.quantity });
  }
  if (!PAYMENT_TYPES.includes(b.paymentType)) {
    return { ok: false, error: `paymentType şunlardan biri olmalı: ${PAYMENT_TYPES.join(', ')}` };
  }
  return { ok: true, value: { reservationId: b.reservationId, items, paymentType: b.paymentType } };
};

module.exports = { validateReservationInput, validateOrderInput, SLOTS, PAYMENT_TYPES };
