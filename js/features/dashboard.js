'use strict';

import { StoreAPI } from '../api.js';
import { State } from '../state.js';

export async function loadDashboard() {
  const res = await StoreAPI.dashboard();
  State.setDashboard(res || null);
  return State.get().dashboard;
}
