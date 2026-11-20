import { DurableObject } from 'cloudflare:workers';

export class PublicRecipeStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL,
        recipe TEXT NOT NULL, updated_at INTEGER NOT NULL
      )
    `);
  }

  async fetch(request) {
    const id = new URL(request.url).pathname.split('/')[2];
    if (request.method === 'GET') {
      if (!id) {
        const rows = this.sql.exec(
          'SELECT id, title, summary FROM recipes ORDER BY updated_at DESC, id'
        ).toArray();
        return Response.json(rows);
      }
      const [row] = this.sql.exec('SELECT recipe FROM recipes WHERE id = ?', id).toArray();
      return row ? new Response(row.recipe) : Response.json({ error: 'Recipe not found.' }, { status: 404 });
    }
    if (request.method === 'PUT') {
      const body = await request.text();
      const { title, summary = '' } = JSON.parse(body);
      this.sql.exec(`
        INSERT INTO recipes (id, title, summary, recipe, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, summary = excluded.summary,
          recipe = excluded.recipe, updated_at = excluded.updated_at
      `, id, title, summary, body, Date.now());
      return Response.json({ id });
    }
    if (request.method === 'DELETE') {
      this.sql.exec('DELETE FROM recipes WHERE id = ?', id);
      return Response.json({ id });
    }
    return Response.json({ error: 'This action is not supported.' }, { status: 405 });
  }
}
