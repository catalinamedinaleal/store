'use strict';

import { StoreAPI } from '../api.js';
import { State } from '../state.js';

export async function loadPendingOrders(force = false) {
  if (!force && State.get().ordersLoadedOnce) return State.get().orders || [];
  const res = await StoreAPI.listSales('pending', true, 200);
  State.setOrders(Array.isArray(res?.items) ? res.items : []);
  State.set({ ordersLoadedOnce: true, ordersSource: 'api' }, { data: true });
  return State.get().orders || [];
}
