'use strict';

import { StoreAPI } from '../api.js';
import { State } from '../state.js';

export async function loadMoves(query = '') {
  const res = await StoreAPI.listMoves(query, 200);
  State.set({ moves: Array.isArray(res?.items) ? res.items : [], movesLoaded: true }, { data: true });
  return State.get().moves || [];
}
