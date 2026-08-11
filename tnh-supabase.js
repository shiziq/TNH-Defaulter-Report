/* ============================================================
   TNH SACCO — Supabase sync engine (shared by web + mobile apps)
   Drop-in: loads after the page, then transparently mirrors
   the three localStorage stores (debtors, payments, attachments)
   to Supabase tables with REALTIME sync between devices.

   Config: set these (or window.TNH_CONFIG) before this script runs.
   ============================================================ */
(function () {
  const CONFIG = window.TNH_CONFIG || {
    SUPABASE_URL: 'https://pzxuvuzaejdaracndkqe.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_X55Thn97viu4N7F-v0mF7Q_UfIYOK_I',
    TABLES: { debtors: 'debtors', payments: 'payments', attachments: 'attachments' },
    BUCKET: 'attachments',
    // localStorage keys the apps currently use:
    KEYS: {
      debtors: 'tnh_debt_records_v3',
      payments: 'tnh_payments_v1',
      attachments: 'tnh_attachments_v1'
    }
  };

  window.TNH = { ready: false, client: null, CONFIG, _subs: [], _onRemote: [] };

  // ---- Load Supabase JS from CDN (no build step) ----
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  async function init() {
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    } catch (e) {
      console.warn('[TNH] Supabase CDN failed — using localStorage only.', e);
      window.TNH.ready = false; return;
    }
    const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    window.TNH.client = sb;

    // ---- Mirror helpers ----
    async function pushDebtors() {
      const arr = JSON.parse(localStorage.getItem(CONFIG.KEYS.debtors) || '[]');
      for (const r of arr) {
        const row = { ...r, outstanding: Number(r.outstanding) || 0, loan_amount: Number(r.loan_amount) || 0, deposits: Number(r.deposits) || 0, updated_at: new Date().toISOString() };
        await sb.from(CONFIG.TABLES.debtors).upsert(row, { onConflict: 'id' });
      }
    }
    async function pushPayments() {
      const map = JSON.parse(localStorage.getItem(CONFIG.KEYS.payments) || '{}');
      for (const did of Object.keys(map)) {
        for (const p of map[did]) {
          await sb.from(CONFIG.TABLES.payments).upsert({ ...p, debtor_id: did }, { onConflict: 'id' });
        }
      }
    }
    async function pushAttachmentsMeta() {
      const map = JSON.parse(localStorage.getItem(CONFIG.KEYS.attachments) || '{}');
      for (const did of Object.keys(map)) {
        for (const a of map[did]) {
          if (a.synced) continue;
          await sb.from(CONFIG.TABLES.attachments).upsert({ id: a.id, debtor_id: did, name: a.name, size: a.size, type: a.type, storage_path: a.storage_path || null, added: a.added || new Date().toISOString() }, { onConflict: 'id' });
          a.synced = true;
        }
      }
      localStorage.setItem(CONFIG.KEYS.attachments, JSON.stringify(map));
    }

    async function pullDebtors() {
      const { data, error } = await sb.from(CONFIG.TABLES.debtors).select('*');
      if (error) { console.warn('[TNH] pull debtors failed', error); return; }
      localStorage.setItem(CONFIG.KEYS.debtors, JSON.stringify(data || []));
    }
    async function pullPayments() {
      const { data, error } = await sb.from(CONFIG.TABLES.payments).select('*');
      if (error) return;
      const map = {};
      (data || []).forEach(p => { (map[p.debtor_id] = map[p.debtor_id] || []).push(p); });
      localStorage.setItem(CONFIG.KEYS.payments, JSON.stringify(map));
    }
    async function pullAttachmentsMeta() {
      const { data, error } = await sb.from(CONFIG.TABLES.attachments).select('*');
      if (error) return;
      const map = {};
      (data || []).forEach(a => { (map[a.debtor_id] = map[a.debtor_id] || []).push(a); });
      localStorage.setItem(CONFIG.KEYS.attachments, JSON.stringify(map));
    }

    // ---- Public API ----
    window.TNH.syncNow = async function () {
      await pullDebtors(); await pullPayments(); await pullAttachmentsMeta();
      await pushDebtors(); await pushPayments(); await pushAttachmentsMeta();
      window.TNH._onRemote.forEach(fn => fn());
    };
    window.TNH.pushAll = async function () {
      await pushDebtors(); await pushPayments(); await pushAttachmentsMeta();
    };

    // Upload a file to Storage and attach metadata
    window.TNH.uploadAttachment = async function (debtorId, file, dataUrl) {
      const path = debtorId + '/' + Date.now() + '_' + file.name;
      const blob = await (await fetch(dataUrl)).blob();
      const { error } = await sb.storage.from(CONFIG.BUCKET).upload(path, blob, { upsert: true });
      if (error) throw error;
      const att = { id: Date.now().toString(), debtor_id: debtorId, name: file.name, size: file.size, type: file.type, storage_path: path, added: new Date().toISOString() };
      await sb.from(CONFIG.TABLES.attachments).upsert(att, { onConflict: 'id' });
      return att;
    };
    window.TNH.getAttachmentUrl = function (path) {
      return sb.storage.from(CONFIG.BUCKET).createSignedUrl(path, 3600).then(r => r.data?.signedUrl || null);
    };

    window.TNH.notifyOnRemote = function (fn) { window.TNH._onRemote.push(fn); };

    // ---- Realtime ----
    const channel = sb.channel('tnh-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: CONFIG.TABLES.debtors }, () => window.TNH.syncNow())
      .on('postgres_changes', { event: '*', schema: 'public', table: CONFIG.TABLES.payments }, () => window.TNH.syncNow())
      .on('postgres_changes', { event: '*', schema: 'public', table: CONFIG.TABLES.attachments }, () => window.TNH.syncNow())
      .subscribe();

    window.TNH._channel = channel;
    window.TNH.ready = true;

    // initial pull so this device sees others' data
    window.TNH.syncNow().then(() => window.TNH._onRemote.forEach(fn => fn()));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
