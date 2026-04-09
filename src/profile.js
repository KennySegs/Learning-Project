import { supabase } from './supabase.js';

/** @typedef {'patient' | 'doctor' | 'nurse' | 'physiotherapist'} UserRole */

/**
 * @param {string} userId
 * @returns {Promise<import('@supabase/supabase-js').PostgrestSingleResponse<Record<string, unknown>>>}
 */
export function fetchProfile(userId) {
  if (!supabase) {
    return Promise.resolve({ data: null, error: new Error('Supabase not configured') });
  }
  return supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
}

/**
 * @param {Record<string, unknown>} row
 */
export function upsertProfile(row) {
  if (!supabase) {
    return Promise.resolve({ data: null, error: new Error('Supabase not configured') });
  }
  return supabase.from('profiles').upsert(row, { onConflict: 'id' }).select().single();
}

/**
 * @param {number} lat
 * @param {number} lng
 * @param {UserRole} role
 * @param {number} [maxKm]
 */
export function searchProviders(lat, lng, role, maxKm = 50) {
  if (!supabase) {
    return Promise.resolve({ data: null, error: new Error('Supabase not configured') });
  }
  return supabase.rpc('search_providers', {
    p_lat: lat,
    p_lng: lng,
    p_role: role,
    p_max_km: maxKm,
  });
}
