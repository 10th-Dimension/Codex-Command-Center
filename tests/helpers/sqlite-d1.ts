import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike } from "../../src/lib/telemetry/database";

// Real SQLite SQL/plan verification; does not emulate or claim billed D1 reads.
export class SqliteD1 implements D1DatabaseLike {
  readonly statements: { sql: string; values: unknown[] }[] = [];
  beforeExecute?: (sql: string, values: unknown[]) => Promise<void>;

  constructor(readonly sqlite = new DatabaseSync(":memory:"), migrate = true) {
    if (!migrate) return;
    const directory = new URL("../../migrations/", import.meta.url);
    for (const file of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
      this.sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
    }
  }

  prepare(sql: string): D1PreparedStatementLike {
    let values: unknown[] = [];
    const execute = async <T,>(read: boolean): Promise<D1ResultLike<T>> => {
      this.statements.push({ sql, values });
      await this.beforeExecute?.(sql, values);
      const statement = this.sqlite.prepare(sql);
      if (read) return { success: true, results: statement.all(...values as never[]) as T[] };
      return { success: true, meta: { changes: Number(statement.run(...values as never[]).changes) } };
    };
    const statement: D1PreparedStatementLike = {
      bind(...args) { values = args; return statement; },
      all: () => execute(true),
      run: () => execute(false),
    };
    return Object.assign(statement, { sql });
  }

  async batch<T>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]> {
    const results: D1ResultLike<T>[] = [];
    for (const statement of statements) {
      results.push(await (/^\s*(?:INSERT|UPDATE|DELETE)/i.test((statement as unknown as { sql?: string }).sql ?? "")
        ? statement.run<T>() : statement.all<T>()));
    }
    return results;
  }
}
