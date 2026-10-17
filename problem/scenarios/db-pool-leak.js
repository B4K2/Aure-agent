import { deployScenario } from './_deploy.js';

export default deployScenario({
  name: 'db-pool-leak',
  category: 'db exhaustion',
  summary: 'Deploy moves conn.release() into the catch block only — every successful order leaks a pool connection. After ~10 orders the whole site hangs.',
  symptoms: 'pg_pool_connections{state="waiting"} climbs, total pinned at PG_POOL_MAX, idle 0; requests time out site-wide; Postgres shows "idle in transaction"-free idle sessions.',
  fix: 'Roll back the deploy and restart (restart alone frees the pool but it leaks again).',
  commit: 'orders: release connection explicitly on rollback path',
  edits: [{
    file: 'server/index.js',
    find: `  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }`,
    replace: `  } catch (err) {
    await conn.query('ROLLBACK');
    conn.release();
    throw err;
  }`,
  }],
});
