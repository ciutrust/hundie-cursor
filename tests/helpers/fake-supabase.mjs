// In-memory fake of the supabase-js query builder, supporting exactly the chained calls that
// importAccountPlan, filterRowsAgainstExisting, partition/update-by-external_id and
// stampRemovedTransactions make: from, select/single, insert, upsert (ignoreDuplicates), update,
// delete, eq/gte/lte/is/in/order/range. Exposes `.db` for assertions.

function project(row, cols) {
  if (!cols || cols === "*") return { ...row };
  const fields = cols.split(",").map((c) => c.trim());
  const out = {};
  for (const f of fields) out[f] = row[f];
  return out;
}

function matches(row, filters) {
  return filters.every((f) => {
    if (f.type === "eq") return row[f.col] === f.val;
    if (f.type === "gte") return row[f.col] >= f.val;
    if (f.type === "lte") return row[f.col] <= f.val;
    if (f.type === "is") return f.val === null ? row[f.col] == null : row[f.col] === f.val;
    if (f.type === "in") return f.vals.includes(row[f.col]);
    return true;
  });
}

export function makeFakeSupabase(initial = {}) {
  const db = {
    transactions: (initial.transactions ?? []).map((r) => ({ ...r })),
    classifications: (initial.classifications ?? []).map((r) => ({ ...r })),
    import_batches: (initial.import_batches ?? []).map((r) => ({ ...r })),
    raw_import_rows: (initial.raw_import_rows ?? []).map((r) => ({ ...r })),
  };
  // Seed any additional tables the caller provides (categories, entities,
  // classification_proposals, suggestion_events, ai_suggestions, ...).
  for (const [t, rows] of Object.entries(initial)) {
    if (!(t in db)) db[t] = (rows ?? []).map((r) => ({ ...r }));
  }
  const counters = {};
  const nextId = (table) => `${table}-${(counters[table] = (counters[table] ?? 0) + 1)}`;

  function execute(q) {
    const table = db[q._table] ?? (db[q._table] = []);
    if (q._op === "insert") {
      const payload = Array.isArray(q._payload) ? q._payload : [q._payload];
      const inserted = payload.map((p) => {
        const row = { ...p };
        if (row.id == null) row.id = nextId(q._table);
        db[q._table].push(row);
        return project(row, q._cols);
      });
      return { data: q._single ? (inserted[0] ?? null) : inserted, error: null };
    }
    if (q._op === "upsert") {
      const payload = Array.isArray(q._payload) ? q._payload : [q._payload];
      const conflict = (q._opts?.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean);
      const newRows = [];
      for (const p of payload) {
        const exists = table.some((r) => conflict.every((c) => r[c] === p[c]));
        if (exists) continue; // ignoreDuplicates: skip; .select() returns only new rows
        const row = { ...p };
        if (row.id == null) row.id = nextId(q._table);
        db[q._table].push(row);
        newRows.push(row);
      }
      return { data: newRows.map((r) => project(r, q._cols)), error: null };
    }
    if (q._op === "update") {
      const affected = table.filter((r) => matches(r, q._filters));
      for (const r of affected) Object.assign(r, q._payload);
      return { data: affected.map((r) => project(r, q._cols)), error: null };
    }
    if (q._op === "delete") {
      db[q._table] = table.filter((r) => !matches(r, q._filters));
      return { data: null, error: null };
    }
    // select
    let rows = table.filter((r) => matches(r, q._filters));
    if (q._order) {
      rows = [...rows].sort((a, b) =>
        a[q._order.col] > b[q._order.col] ? 1 : a[q._order.col] < b[q._order.col] ? -1 : 0,
      );
    }
    if (q._range) rows = rows.slice(q._range[0], q._range[1] + 1);
    const data = rows.map((r) => project(r, q._cols));
    return { data: q._single ? (data[0] ?? null) : data, error: null };
  }

  function from(tableName) {
    const q = {
      _table: tableName,
      _op: "select",
      _cols: "*",
      _payload: null,
      _opts: null,
      _filters: [],
      _single: false,
      _range: null,
      _order: null,
      select(cols) {
        this._cols = cols;
        return this;
      },
      insert(payload) {
        this._op = "insert";
        this._payload = payload;
        return this;
      },
      upsert(payload, opts) {
        this._op = "upsert";
        this._payload = payload;
        this._opts = opts;
        return this;
      },
      update(payload) {
        this._op = "update";
        this._payload = payload;
        return this;
      },
      delete() {
        this._op = "delete";
        return this;
      },
      eq(col, val) {
        this._filters.push({ type: "eq", col, val });
        return this;
      },
      gte(col, val) {
        this._filters.push({ type: "gte", col, val });
        return this;
      },
      lte(col, val) {
        this._filters.push({ type: "lte", col, val });
        return this;
      },
      is(col, val) {
        this._filters.push({ type: "is", col, val });
        return this;
      },
      in(col, vals) {
        this._filters.push({ type: "in", col, vals });
        return this;
      },
      order(col, opts) {
        this._order = { col, opts };
        return this;
      },
      range(a, b) {
        this._range = [a, b];
        return this;
      },
      single() {
        this._single = true;
        return this;
      },
      maybeSingle() {
        this._single = true;
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve()
          .then(() => execute(this))
          .then(resolve, reject);
      },
    };
    return q;
  }

  return { from, db };
}
