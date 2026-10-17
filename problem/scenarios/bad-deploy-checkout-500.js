import { deployScenario } from './_deploy.js';

export default deployScenario({
  name: 'bad-deploy-checkout-500',
  category: 'bad deploy',
  summary: 'Deploy renames a column in the order INSERT; every checkout returns 500.',
  symptoms: 'POST /api/orders 500 ("column shipping_address does not exist" in server logs); orders_total flat; rest of site fine.',
  fix: 'Roll back the deploy (or fix the column name) and restart.',
  commit: 'orders: store address as shipping_address for new checkout form',
  edits: [{
    file: 'server/index.js',
    find: `'INSERT INTO orders (user_id, total, address) VALUES ($1, $2, $3) RETURNING id',`,
    replace: `'INSERT INTO orders (user_id, total, shipping_address) VALUES ($1, $2, $3) RETURNING id',`,
  }],
});
