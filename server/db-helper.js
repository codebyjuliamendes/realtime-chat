
export function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export function queryOne(db, sql, params = []) {
  const rows = queryAll(db, sql, params);
  return rows[0] || null;
}

export function runSql(db, sql, params = []) {
  db.run(sql, params);
  return { changes: db.getRowsModified() };
}

export function runTransaction(db, callback) {
  db.run('BEGIN TRANSACTION');
  try {
    callback();
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}
