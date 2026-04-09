import { getClerk, isClerkConfigured, openClerkSignIn } from './clerk.js';
import { geocodeAddress } from './geocode.js';
import { fetchProfile, searchProviders, upsertProfile } from './profile.js';
import { isSupabaseConfigured, supabase } from './supabase.js';

/** @typedef {'patient' | 'doctor' | 'nurse' | 'physiotherapist'} UserRole */

/** When true, show intake forms again for users who already completed onboarding. */
let editingProfile = false;

/** @type {Record<string, unknown> | null} */
let lastProfile = null;

/**
 * First-time onboarding needs consent checkbox required; editing keeps it checked but not required.
 * @param {boolean} isEditingSavedProfile
 */
function setFormSectionTitles(profile) {
  const editingSaved =
    editingProfile && profile && /** @type {Record<string, unknown>} */ (profile).onboarding_completed;
  const pt = document.querySelector('#portal-state-patient-form h3');
  if (pt) {
    pt.textContent = editingSaved ? 'Edit your patient profile' : 'Patient intake';
  }
  const cl = document.querySelector('#portal-state-clinician-form h3');
  if (cl) {
    cl.textContent = editingSaved ? 'Edit your clinician profile' : 'Clinician profile';
  }
}

function setFormConsentForEdit(isEditingSavedProfile) {
  const patientForm = document.getElementById('portal-patient-form');
  const clinicianForm = document.getElementById('portal-clinician-form');
  if (patientForm instanceof HTMLFormElement) {
    const consent = patientForm.querySelector('input[name="location_consent"]');
    if (consent instanceof HTMLInputElement) {
      consent.required = !isEditingSavedProfile;
      if (isEditingSavedProfile) {
        consent.checked = true;
      }
    }
  }
  if (clinicianForm instanceof HTMLFormElement) {
    const consent = clinicianForm.querySelector('input[name="location_consent_clinician"]');
    if (consent instanceof HTMLInputElement) {
      consent.required = !isEditingSavedProfile;
      if (isEditingSavedProfile) {
        consent.checked = true;
      }
    }
  }
}

/**
 * @param {HTMLFormElement} form
 * @param {string} name
 */
function val(form, name) {
  const el = form.elements.namedItem(name);
  if (!el) return '';
  if (el instanceof RadioNodeList) {
    const checked = form.querySelector(`input[name="${name}"]:checked`);
    return checked ? String(checked.value) : '';
  }
  if (el instanceof HTMLInputElement && el.type === 'checkbox') {
    return el.checked;
  }
  return String(el.value || '').trim();
}

/**
 * @param {string} s
 */
function splitTags(s) {
  return s
    .split(/[,;\n]+/)
    .map(function (x) {
      return x.trim();
    })
    .filter(Boolean);
}

/**
 * @param {Record<string, unknown>} profile
 */
function patientExtrasFromForm(form) {
  return {
    emergency_contact: {
      name: String(val(form, 'emergency_name') || ''),
      phone: String(val(form, 'emergency_phone') || ''),
    },
    icu_discharge_date: String(val(form, 'icu_discharge_date') || ''),
    icu_status: String(val(form, 'icu_status') || ''),
    diagnoses_tags: splitTags(String(val(form, 'diagnoses_tags') || '')),
    diagnoses_notes: String(val(form, 'diagnoses_notes') || ''),
    care_setting: String(val(form, 'care_setting') || ''),
    active_problems: {
      oxygen: Boolean(form.querySelector('input[name="ap_oxygen"]')?.checked),
      tracheostomy: Boolean(form.querySelector('input[name="ap_trach"]')?.checked),
      wound_care: Boolean(form.querySelector('input[name="ap_wound"]')?.checked),
      dialysis: Boolean(form.querySelector('input[name="ap_dialysis"]')?.checked),
    },
    insurance_payer_type: String(val(form, 'insurance_payer') || ''),
    mobility_level: String(val(form, 'mobility_level') || ''),
    pt_goals: String(val(form, 'pt_goals') || ''),
    home_equipment: String(val(form, 'home_equipment') || ''),
    pt_precautions: String(val(form, 'pt_precautions') || ''),
    preferred_visit_notes: String(val(form, 'preferred_visit_notes') || ''),
    match_status: 'seeking',
  };
}

/**
 * @param {UserRole} clinicianRole
 */
function clinicianExtrasFromForm(form, clinicianRole) {
  const base = {
    license_type: String(val(form, 'license_type') || ''),
    license_jurisdiction: String(val(form, 'license_jurisdiction') || ''),
    npi_or_local_id: String(val(form, 'npi_or_local_id') || ''),
    post_icu_experience_years: Number(val(form, 'post_icu_years') || 0) || 0,
    availability_notes: String(val(form, 'availability_notes') || ''),
  };
  if (clinicianRole === 'nurse') {
    base.nurse_skills = {
      wound: Boolean(form.querySelector('input[name="ns_wound"]')?.checked),
      iv: Boolean(form.querySelector('input[name="ns_iv"]')?.checked),
      vitals: Boolean(form.querySelector('input[name="ns_vitals"]')?.checked),
      vent_trach: Boolean(form.querySelector('input[name="ns_vent"]')?.checked),
    };
  }
  if (clinicianRole === 'physiotherapist') {
    base.physio_emphasis = String(val(form, 'physio_emphasis') || '');
    base.modality = String(val(form, 'physio_modality') || '');
  }
  if (clinicianRole === 'doctor') {
    base.medical_specialty_detail = String(val(form, 'medical_specialty_detail') || '');
  }
  return base;
}

/**
 * @param {Record<string, unknown> | null} profile
 */
function showPortalPanels(profile) {
  const guest = document.getElementById('portal-state-guest');
  const roleStep = document.getElementById('portal-state-role');
  const patientForm = document.getElementById('portal-state-patient-form');
  const clinicianForm = document.getElementById('portal-state-clinician-form');
  const dashboard = document.getElementById('portal-state-dashboard');
  const submittedRo = document.getElementById('portal-submitted-readonly');
  const cfg = document.getElementById('portal-config-warning');

  [guest, roleStep, patientForm, clinicianForm, dashboard, cfg].forEach(function (el) {
    if (el) el.hidden = true;
  });
  if (submittedRo) submittedRo.hidden = true;

  if (!isSupabaseConfigured() || !supabase) {
    if (cfg) cfg.hidden = false;
    return;
  }

  const clerk = getClerk();
  if (!isClerkConfigured() || !clerk || !clerk.isSignedIn) {
    if (guest) guest.hidden = false;
    return;
  }

  if (!profile) {
    if (roleStep) roleStep.hidden = false;
    return;
  }

  const role = /** @type {UserRole} */ (profile.role);

  if (!profile.onboarding_completed) {
    setFormConsentForEdit(false);
    if (role === 'patient') {
      if (patientForm) patientForm.hidden = false;
    } else {
      if (clinicianForm) {
        clinicianForm.hidden = false;
        const hiddenRole = document.getElementById('portal-clinician-role');
        if (hiddenRole instanceof HTMLInputElement) {
          hiddenRole.value = role;
        }
        clinicianForm.querySelectorAll('[data-clinician-panel]').forEach(function (panel) {
          if (panel instanceof HTMLElement) {
            const r = panel.getAttribute('data-clinician-panel');
            panel.hidden = r !== role;
          }
        });
      }
    }
    setFormSectionTitles(profile);
    const editToolbar = document.getElementById('portal-edit-toolbar');
    if (editToolbar) editToolbar.hidden = true;
    return;
  }

  if (profile.onboarding_completed && editingProfile) {
    setFormConsentForEdit(true);
    if (role === 'patient') {
      if (patientForm) patientForm.hidden = false;
    } else {
      if (clinicianForm) {
        clinicianForm.hidden = false;
        const hiddenRole = document.getElementById('portal-clinician-role');
        if (hiddenRole instanceof HTMLInputElement) {
          hiddenRole.value = role;
        }
        clinicianForm.querySelectorAll('[data-clinician-panel]').forEach(function (panel) {
          if (panel instanceof HTMLElement) {
            const r = panel.getAttribute('data-clinician-panel');
            panel.hidden = r !== role;
          }
        });
      }
    }
    setFormSectionTitles(profile);
    const editToolbar = document.getElementById('portal-edit-toolbar');
    if (editToolbar) editToolbar.hidden = false;
    return;
  }

  if (dashboard) {
    dashboard.hidden = false;
    const detailsEl = document.getElementById('portal-submitted-details');
    if (submittedRo && detailsEl && profile) {
      submittedRo.hidden = false;
      detailsEl.innerHTML = buildSubmittedDetailsHtml(profile);
    }
    const dashPatient = document.getElementById('portal-dashboard-patient');
    const dashClinician = document.getElementById('portal-dashboard-clinician');
    if (dashPatient && dashClinician) {
      dashPatient.hidden = role !== 'patient';
      dashClinician.hidden = role === 'patient';
    }
    const editToolbar = document.getElementById('portal-edit-toolbar');
    if (editToolbar) editToolbar.hidden = true;
  }
}

/**
 * @param {Record<string, unknown>} profile
 */
function buildSubmittedDetailsHtml(profile) {
  const pj = /** @type {Record<string, unknown>} */ (profile.profile_json || {});
  const role = String(profile.role || '');
  const rows = [];

  function row(label, value) {
    const v = value != null && String(value).trim() !== '' ? String(value) : '—';
    rows.push(
      '<div class="portal-readonly-row"><dt>' +
        escapeHtml(label) +
        '</dt><dd>' +
        escapeHtml(v) +
        '</dd></div>'
    );
  }

  row('Role', role);
  row('Full name', profile.full_name);
  row('Email', profile.email);
  row('Phone', profile.phone);
  row('Address', profile.address_line1);
  row('City', profile.city);
  row('State / region', profile.region);
  row('Postal code', profile.postal_code);
  row('Country', profile.country);
  if (profile.latitude != null && profile.longitude != null) {
    row(
      'Coordinates (matching)',
      String(profile.latitude) + ', ' + String(profile.longitude)
    );
  }
  row('Languages', Array.isArray(profile.languages) ? profile.languages.join(', ') : '');

  if (role === 'patient') {
    const ec = /** @type {{ name?: string; phone?: string }} */ (pj.emergency_contact || {});
    row('Emergency contact', [ec.name, ec.phone].filter(Boolean).join(' · ') || '—');
    row('ICU discharge date', pj.icu_discharge_date);
    row('ICU status', pj.icu_status);
    row('Diagnosis tags', Array.isArray(pj.diagnoses_tags) ? pj.diagnoses_tags.join(', ') : '');
    row('Clinical notes', pj.diagnoses_notes);
    row('Care setting', pj.care_setting);
    const ap = /** @type {Record<string, boolean> | undefined} */ (pj.active_problems);
    if (ap && typeof ap === 'object') {
      const tags = Object.keys(ap).filter(function (k) {
        return ap[k];
      });
      row('Active problems', tags.length ? tags.join(', ') : 'None selected');
    }
    row('Insurance / payer', pj.insurance_payer_type);
    row('Mobility level', pj.mobility_level);
    row('Rehab goals', pj.pt_goals);
    row('Home equipment', pj.home_equipment);
    row('Precautions', pj.pt_precautions);
    row('Preferred visit windows', pj.preferred_visit_notes);
    row('Telehealth OK', profile.telehealth_ok ? 'Yes' : 'No');
    row('In-person OK', profile.in_person_ok ? 'Yes' : 'No');
  } else {
    row('Service radius (km)', profile.service_radius_km);
    row('Accepting new patients', profile.accepting_new_patients ? 'Yes' : 'No');
    row('Telehealth', profile.telehealth_ok ? 'Yes' : 'No');
    row('In-person', profile.in_person_ok ? 'Yes' : 'No');
    row('Specialty tags', Array.isArray(profile.specialty_tags) ? profile.specialty_tags.join(', ') : '');
    row('License type', pj.license_type);
    row('License jurisdiction', pj.license_jurisdiction);
    row('NPI / local ID', pj.npi_or_local_id);
    row('Post-ICU experience (years)', pj.post_icu_experience_years);
    row('Availability notes', pj.availability_notes);
    if (role === 'doctor') {
      row('Specialty detail', pj.medical_specialty_detail);
    }
    if (role === 'physiotherapist') {
      row('Physio emphasis', pj.physio_emphasis);
      row('Modality', pj.modality);
    }
    if (role === 'nurse' && pj.nurse_skills && typeof pj.nurse_skills === 'object') {
      const ns = /** @type {Record<string, boolean>} */ (pj.nurse_skills);
      const tags = Object.keys(ns).filter(function (k) {
        return ns[k];
      });
      row('Nurse skills', tags.length ? tags.join(', ') : '—');
    }
  }

  return '<dl class="portal-readonly-dl">' + rows.join('') + '</dl>';
}

/**
 * @param {Record<string, unknown>} profile
 */
function fillPatientForm(profile) {
  const form = document.getElementById('portal-patient-form');
  if (!(form instanceof HTMLFormElement)) return;
  const pj = /** @type {Record<string, unknown>} */ (profile.profile_json || {});
  const ec = /** @type {{ name?: string; phone?: string }} */ (pj.emergency_contact || {});

  const set = function (name, value) {
    const el = form.elements.namedItem(name);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      el.value = value;
    }
  };

  set('full_name', String(profile.full_name || ''));
  set('phone', String(profile.phone || ''));
  set('email', String(profile.email || ''));
  set('address_line1', String(profile.address_line1 || ''));
  set('city', String(profile.city || ''));
  set('region', String(profile.region || ''));
  set('postal_code', String(profile.postal_code || ''));
  set('country', String(profile.country || 'NG'));
  set('languages', (profile.languages || []).join(', '));
  set('emergency_name', ec.name || '');
  set('emergency_phone', ec.phone || '');
  set('icu_discharge_date', String(pj.icu_discharge_date || ''));
  set('icu_status', String(pj.icu_status || ''));
  set('diagnoses_tags', (pj.diagnoses_tags || []).join(', '));
  set('diagnoses_notes', String(pj.diagnoses_notes || ''));
  set('care_setting', String(pj.care_setting || ''));
  set('insurance_payer', String(pj.insurance_payer_type || ''));
  set('mobility_level', String(pj.mobility_level || ''));
  set('pt_goals', String(pj.pt_goals || ''));
  set('home_equipment', String(pj.home_equipment || ''));
  set('pt_precautions', String(pj.pt_precautions || ''));
  set('preferred_visit_notes', String(pj.preferred_visit_notes || ''));

  const ap = pj.active_problems;
  if (ap && typeof ap === 'object') {
    const o = /** @type {Record<string, boolean>} */ (ap);
    const map = {
      oxygen: 'ap_oxygen',
      tracheostomy: 'ap_trach',
      wound_care: 'ap_wound',
      dialysis: 'ap_dialysis',
    };
    Object.keys(map).forEach(function (k) {
      const name = map[/** @type {keyof typeof map} */ (k)];
      const inp = form.querySelector(`input[name="${name}"]`);
      if (inp instanceof HTMLInputElement) inp.checked = Boolean(o[k]);
    });
  }
}

/**
 * @param {Record<string, unknown>} profile
 */
function fillClinicianForm(profile) {
  const form = document.getElementById('portal-clinician-form');
  if (!(form instanceof HTMLFormElement)) return;
  const role = String(profile.role || '');
  const pj = /** @type {Record<string, unknown>} */ (profile.profile_json || {});

  const set = function (name, value) {
    const el = form.elements.namedItem(name);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      el.value = value;
    }
  };

  set('full_name', String(profile.full_name || ''));
  set('phone', String(profile.phone || ''));
  set('email', String(profile.email || ''));
  set('address_line1', String(profile.address_line1 || ''));
  set('city', String(profile.city || ''));
  set('region', String(profile.region || ''));
  set('postal_code', String(profile.postal_code || ''));
  set('country', String(profile.country || 'NG'));
  set('service_radius_km', String(profile.service_radius_km ?? '25'));
  set('languages', (profile.languages || []).join(', '));
  set('specialty_tags', (profile.specialty_tags || []).join(', '));
  const acc = form.querySelector('input[name="accepting_new_patients"]');
  if (acc instanceof HTMLInputElement) acc.checked = Boolean(profile.accepting_new_patients);
  const th = form.querySelector('input[name="telehealth_ok"]');
  if (th instanceof HTMLInputElement) th.checked = Boolean(profile.telehealth_ok);
  const ip = form.querySelector('input[name="in_person_ok"]');
  if (ip instanceof HTMLInputElement) ip.checked = Boolean(profile.in_person_ok);

  set('license_type', String(pj.license_type || ''));
  set('license_jurisdiction', String(pj.license_jurisdiction || ''));
  set('npi_or_local_id', String(pj.npi_or_local_id || ''));
  set('post_icu_years', String(pj.post_icu_experience_years ?? ''));
  set('availability_notes', String(pj.availability_notes || ''));
  set('medical_specialty_detail', String(pj.medical_specialty_detail || ''));
  set('physio_emphasis', String(pj.physio_emphasis || ''));
  set('physio_modality', String(pj.modality || ''));

  if (pj.nurse_skills && typeof pj.nurse_skills === 'object') {
    const o = /** @type {Record<string, boolean>} */ (pj.nurse_skills);
    const map = { wound: 'ns_wound', iv: 'ns_iv', vitals: 'ns_vitals', vent_trach: 'ns_vent' };
    Object.keys(map).forEach(function (k) {
      const name = map[/** @type {keyof typeof map} */ (k)];
      const inp = form.querySelector(`input[name="${name}"]`);
      if (inp instanceof HTMLInputElement) inp.checked = Boolean(o[k]);
    });
  }
}

/**
 * @param {HTMLElement} el
 * @param {string} html
 */
function setResults(el, html) {
  el.innerHTML = html;
}

export async function initPortal() {
  const portalSection = document.getElementById('care-portal');
  if (!portalSection) {
    return;
  }

  const guest = document.getElementById('portal-state-guest');
  const signInBtn = document.getElementById('portal-signin-btn');
  const roleStep = document.getElementById('portal-state-role');
  const patientForm = document.getElementById('portal-patient-form');
  const clinicianForm = document.getElementById('portal-clinician-form');
  const matchOut = document.getElementById('portal-match-results');
  const findDoctor = document.getElementById('portal-find-doctor');
  const findPhysio = document.getElementById('portal-find-physio');
  const matchMaxKm = document.getElementById('portal-match-max-km');

  async function refresh() {
    const clerk = getClerk();
    if (!isSupabaseConfigured() || !supabase) {
      lastProfile = null;
      editingProfile = false;
      showPortalPanels(null);
      return;
    }
    if (!clerk || !clerk.isSignedIn || !clerk.user) {
      lastProfile = null;
      editingProfile = false;
      showPortalPanels(null);
      return;
    }

    const uid = clerk.user.id;
    const email =
      clerk.user.primaryEmailAddress?.emailAddress ||
      clerk.user.emailAddresses?.[0]?.emailAddress ||
      '';

    const { data: profile, error } = await fetchProfile(uid);
    if (error && error.code !== 'PGRST116') {
      console.error('[portal] profile load', error);
    }

    const p = profile && !error ? /** @type {Record<string, unknown>} */ (profile) : null;

    lastProfile = p;
    if (!p) {
      editingProfile = false;
    }

    if (p && !p.email && email) {
      p.email = email;
    }
    if (p && clerk.user && !p.full_name) {
      p.full_name = clerk.user.fullName || '';
    }

    if (p) {
      fillPatientForm(p);
      fillClinicianForm(p);
    }

    showPortalPanels(p);

    const dashName = document.getElementById('portal-dashboard-summary');
    if (dashName && p) {
      dashName.textContent = String(p.full_name || p.email || 'Your profile');
    }
  }

  if (signInBtn) {
    signInBtn.addEventListener('click', function () {
      const clerk = getClerk();
      if (clerk) {
        openClerkSignIn(clerk);
      } else {
        window.alert(
          'Sign-in is not available yet.\n\n' +
            'Add VITE_CLERK_PUBLISHABLE_KEY (or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) to your .env file, ' +
            'restart the dev server (npm run dev), then try again.'
        );
      }
    });
  }

  if (guest && !isClerkConfigured()) {
    guest.querySelector('p')?.insertAdjacentText(
      'beforeend',
      ' Add VITE_CLERK_PUBLISHABLE_KEY to enable sign-in.'
    );
  }

  roleStep?.querySelectorAll('[data-pick-role]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      const clerk = getClerk();
      if (!clerk?.user || !supabase) return;
      const role = btn.getAttribute('data-pick-role');
      if (!role || !['patient', 'doctor', 'nurse', 'physiotherapist'].includes(role)) return;

      const email =
        clerk.user.primaryEmailAddress?.emailAddress ||
        clerk.user.emailAddresses?.[0]?.emailAddress ||
        '';

      const { error } = await upsertProfile({
        id: clerk.user.id,
        email,
        role,
        profile_json: {},
        onboarding_completed: false,
      });

      if (error) {
        console.error('[portal] role upsert', error);
        alert('Could not save your role. Ensure Supabase is linked to Clerk (JWT template "supabase").');
        return;
      }

      await refresh();
    });
  });

  patientForm?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const clerk = getClerk();
    if (!clerk?.user || !(patientForm instanceof HTMLFormElement)) return;

    const consent = patientForm.querySelector('input[name="location_consent"]');
    if (consent instanceof HTMLInputElement && !consent.checked) {
      alert('Please confirm location use for matching to continue.');
      return;
    }

    const email =
      clerk.user.primaryEmailAddress?.emailAddress ||
      clerk.user.emailAddresses?.[0]?.emailAddress ||
      '';

    const geo = await geocodeAddress({
      line1: String(val(patientForm, 'address_line1') || ''),
      city: String(val(patientForm, 'city') || ''),
      region: String(val(patientForm, 'region') || ''),
      postal_code: String(val(patientForm, 'postal_code') || ''),
      country: String(val(patientForm, 'country') || ''),
    });

    let lat = geo ? geo.lat : null;
    let lng = geo ? geo.lng : null;
    if (
      (lat == null || lng == null) &&
      lastProfile &&
      typeof lastProfile.latitude === 'number' &&
      typeof lastProfile.longitude === 'number'
    ) {
      lat = lastProfile.latitude;
      lng = lastProfile.longitude;
    }

    const profileJson = patientExtrasFromForm(patientForm);

    const row = {
      id: clerk.user.id,
      email,
      role: 'patient',
      full_name: String(val(patientForm, 'full_name') || ''),
      phone: String(val(patientForm, 'phone') || ''),
      address_line1: String(val(patientForm, 'address_line1') || ''),
      city: String(val(patientForm, 'city') || ''),
      region: String(val(patientForm, 'region') || ''),
      postal_code: String(val(patientForm, 'postal_code') || ''),
      country: String(val(patientForm, 'country') || 'NG'),
      latitude: lat,
      longitude: lng,
      location_consent_at: consent instanceof HTMLInputElement && consent.checked ? new Date().toISOString() : null,
      languages: splitTags(String(val(patientForm, 'languages') || 'English')),
      specialty_tags: [],
      telehealth_ok: Boolean(patientForm.querySelector('input[name="telehealth_ok"]')?.checked),
      in_person_ok: Boolean(patientForm.querySelector('input[name="in_person_ok"]')?.checked),
      accepting_new_patients: false,
      profile_json: profileJson,
      onboarding_completed: true,
    };

    const { error } = await upsertProfile(row);
    if (error) {
      console.error('[portal] patient save', error);
      alert('Could not save profile. Check Clerk + Supabase JWT setup.');
      return;
    }

    editingProfile = false;
    await refresh();
  });

  clinicianForm?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const clerk = getClerk();
    if (!clerk?.user || !(clinicianForm instanceof HTMLFormElement)) return;

    const hiddenRole = document.getElementById('portal-clinician-role');
    const roleStr = hiddenRole instanceof HTMLInputElement ? hiddenRole.value : 'doctor';
    const clinicianRole = /** @type {UserRole} */ (roleStr);

    const consent = clinicianForm.querySelector('input[name="location_consent_clinician"]');
    if (consent instanceof HTMLInputElement && !consent.checked) {
      alert('Please confirm location use for matching to continue.');
      return;
    }

    const email =
      clerk.user.primaryEmailAddress?.emailAddress ||
      clerk.user.emailAddresses?.[0]?.emailAddress || '';

    const geo = await geocodeAddress({
      line1: String(val(clinicianForm, 'address_line1') || ''),
      city: String(val(clinicianForm, 'city') || ''),
      region: String(val(clinicianForm, 'region') || ''),
      postal_code: String(val(clinicianForm, 'postal_code') || ''),
      country: String(val(clinicianForm, 'country') || ''),
    });

    let lat = geo ? geo.lat : null;
    let lng = geo ? geo.lng : null;
    if (
      (lat == null || lng == null) &&
      lastProfile &&
      typeof lastProfile.latitude === 'number' &&
      typeof lastProfile.longitude === 'number'
    ) {
      lat = lastProfile.latitude;
      lng = lastProfile.longitude;
    }

    const tags =
      clinicianRole === 'doctor'
        ? splitTags(String(val(clinicianForm, 'specialty_tags') || ''))
        : splitTags(String(val(clinicianForm, 'specialty_tags') || ''));

    const row = {
      id: clerk.user.id,
      email,
      role: clinicianRole,
      full_name: String(val(clinicianForm, 'full_name') || ''),
      phone: String(val(clinicianForm, 'phone') || ''),
      address_line1: String(val(clinicianForm, 'address_line1') || ''),
      city: String(val(clinicianForm, 'city') || ''),
      region: String(val(clinicianForm, 'region') || ''),
      postal_code: String(val(clinicianForm, 'postal_code') || ''),
      country: String(val(clinicianForm, 'country') || 'NG'),
      latitude: lat,
      longitude: lng,
      location_consent_at: consent instanceof HTMLInputElement && consent.checked ? new Date().toISOString() : null,
      service_radius_km: Number(val(clinicianForm, 'service_radius_km') || 25) || 25,
      accepting_new_patients: Boolean(clinicianForm.querySelector('input[name="accepting_new_patients"]')?.checked),
      telehealth_ok: Boolean(clinicianForm.querySelector('input[name="telehealth_ok"]')?.checked),
      in_person_ok: Boolean(clinicianForm.querySelector('input[name="in_person_ok"]')?.checked),
      languages: splitTags(String(val(clinicianForm, 'languages') || 'English')),
      specialty_tags: tags,
      profile_json: clinicianExtrasFromForm(clinicianForm, clinicianRole),
      onboarding_completed: true,
    };

    const { error } = await upsertProfile(row);
    if (error) {
      console.error('[portal] clinician save', error);
      alert('Could not save profile. Check Clerk + Supabase JWT setup.');
      return;
    }

    editingProfile = false;
    await refresh();
  });

  document.getElementById('portal-edit-profile')?.addEventListener('click', function () {
    if (!lastProfile) return;
    editingProfile = true;
    showPortalPanels(lastProfile);
  });

  document.getElementById('portal-cancel-edit')?.addEventListener('click', function () {
    editingProfile = false;
    void refresh();
  });

  async function runMatch(role) {
    if (!matchOut) return;
    const clerk = getClerk();
    if (!clerk?.user) return;

    const { data: profile } = await fetchProfile(clerk.user.id);
    const p = profile && typeof profile === 'object' ? /** @type {Record<string, unknown>} */ (profile) : null;
    const lat = p?.latitude;
    const lng = p?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      setResults(matchOut, '<p class="portal-error">Save an address that can be geocoded first, or try again later.</p>');
      return;
    }

    const maxKm = matchMaxKm instanceof HTMLInputElement ? Number(matchMaxKm.value) || 50 : 50;

    const { data, error } = await searchProviders(lat, lng, role, maxKm);
    if (error) {
      console.error('[portal] search', error);
      setResults(matchOut, '<p class="portal-error">Search failed. Check database function and RLS.</p>');
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      setResults(
        matchOut,
        '<p class="portal-muted">No providers in range yet. Try increasing max distance or check back later.</p>'
      );
      return;
    }

    const html = [
      '<ul class="portal-match-list">',
      ...rows.map(function (r) {
        const row = /** @type {Record<string, unknown>} */ (r);
        const name = String(row.full_name || 'Provider');
        const km = row.distance_km != null ? Number(row.distance_km).toFixed(1) : '?';
        const city = String(row.city || '');
        const specs = Array.isArray(row.specialty_tags) ? row.specialty_tags.join(', ') : '';
        return `<li><strong>${escapeHtml(name)}</strong> — ${km} km${city ? ` · ${escapeHtml(city)}` : ''}${specs ? `<br/><span class="portal-muted">${escapeHtml(specs)}</span>` : ''}</li>`;
      }),
      '</ul>',
    ].join('');
    setResults(matchOut, html);
  }

  findDoctor?.addEventListener('click', function () {
    runMatch('doctor');
  });
  findPhysio?.addEventListener('click', function () {
    runMatch('physiotherapist');
  });

  const clerk = getClerk();
  if (clerk) {
    clerk.addListener(function () {
      refresh().catch(function (err) {
        console.error('[portal] refresh', err);
      });
    });
  }

  await refresh();
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
